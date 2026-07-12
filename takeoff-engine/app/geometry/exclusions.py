from __future__ import annotations

import math
import re

from shapely.geometry import LineString, Point, Polygon
from shapely.geometry import box as shp_box
from shapely.ops import unary_union
from shapely.strtree import STRtree

from app.geometry.linework import polygon_to_rings
from app.schemas.core import VectorPath
from app.schemas.detection import ExclusionRegion
from app.schemas.ocr import OCRSpan

_ETR_RE = re.compile(r"\b(?:E\.?\s*T\.?\s*R\.?|EXISTING\s+TO\s+REMAIN)\b", re.IGNORECASE)
_SF_RE = re.compile(r"\b\d+(?:,\d{3})*\s*SF\b", re.IGNORECASE)


def _span_center(span: OCRSpan) -> tuple[float, float]:
    return ((span.bbox[0] + span.bbox[2]) / 2, (span.bbox[1] + span.bbox[3]) / 2)


def _is_gray(color: str) -> bool:
    if not color.startswith("#") or len(color) != 7:
        return False
    try:
        r = int(color[1:3], 16)
        g = int(color[3:5], 16)
        b = int(color[5:7], 16)
    except ValueError:
        return False
    avg = (r + g + b) / 3
    return 35 <= avg <= 235 and max(r, g, b) - min(r, g, b) <= 35


def _polygon_from_path(vp: VectorPath) -> Polygon | None:
    polys = _polygons_from_path(vp)
    return polys[0] if polys else None


def _polygons_from_path(vp: VectorPath) -> list[Polygon]:
    """EVERY closed ring of the path, hole-aware — CAD exports batch many wall
    bands into one fill object (all separate polygons), while hatch backdrops
    are one giant outer ring whose inner rings are HOLES (the in-scope areas).
    A ring contained inside an already-kept ring is a hole, not a region."""
    rings: list[Polygon] = []
    for sub in vp.points:
        if len(sub) < 4:
            continue
        ring = list(sub)
        if ring[0] != ring[-1]:
            if math.dist(ring[0], ring[-1]) > 1.0:
                continue
            ring[-1] = ring[0]
        poly = Polygon(ring)
        if poly.is_valid and not poly.is_empty and poly.area > 25:
            rings.append(poly)
    if len(rings) <= 1:
        return rings
    rings.sort(key=lambda p: p.area, reverse=True)
    outers: list[tuple[Polygon, list[Polygon]]] = []
    for ring in rings:
        probe = ring.representative_point()
        parent = next((o for o, _ in outers if o.contains(probe)), None)
        if parent is None:
            outers.append((ring, []))
        else:
            for outer, holes in outers:
                if outer is parent:
                    holes.append(ring)
                    break
    out: list[Polygon] = []
    for outer, holes in outers:
        if not holes:
            out.append(outer)
            continue
        poly = Polygon(
            outer.exterior.coords,
            [hole.exterior.coords for hole in holes],
        )
        if not poly.is_valid:
            poly = poly.buffer(0)
        if isinstance(poly, Polygon) and not poly.is_empty:
            out.append(poly)
        else:
            out.append(outer)
    return out


def _exclusion(sheet_id: str, reason: str, poly: Polygon, source_ids: list[str], confidence: float) -> ExclusionRegion:
    exterior, holes = polygon_to_rings(poly)
    return ExclusionRegion(
        sheet_id=sheet_id,
        reason=reason,
        bbox=tuple(float(v) for v in poly.bounds),
        exterior=exterior,
        holes=holes,
        source_ids=source_ids,
        confidence=confidence,
    )


def _span_region(span: OCRSpan, pad_x: float = 72.0, pad_y: float = 48.0) -> Polygon:
    x0, y0, x1, y1 = span.bbox
    return Polygon([
        (x0 - pad_x, y0 - pad_y),
        (x1 + pad_x, y0 - pad_y),
        (x1 + pad_x, y1 + pad_y),
        (x0 - pad_x, y1 + pad_y),
    ])


def _is_local_to_span(poly: Polygon, span: OCRSpan) -> bool:
    x0, y0, x1, y1 = poly.bounds
    sx0, sy0, sx1, sy1 = span.bbox
    width = x1 - x0
    height = y1 - y0
    span_width = max(1.0, sx1 - sx0)
    span_height = max(1.0, sy1 - sy0)
    return (
        poly.area <= 80_000
        or (width <= max(300.0, span_width * 12.0) and height <= max(240.0, span_height * 14.0))
    )


def _has_near_scope_area_label(poly: Polygon, spans: list[OCRSpan], pad: float = 24.0) -> bool:
    regions = [poly.buffer(pad), shp_box(*poly.bounds).buffer(pad)]
    for span in spans:
        if _ETR_RE.search(span.text) or not _SF_RE.search(span.text):
            continue
        pt = Point(*_span_center(span))
        if any(region.contains(pt) for region in regions):
            return True
    return False


def _scope_label_faces(poly: Polygon, spans: list[OCRSpan], faces: list[Polygon], pad: float = 24.0) -> list[Polygon]:
    if not faces:
        return []
    region = shp_box(*poly.bounds).buffer(pad)
    out: list[Polygon] = []
    seen: set[int] = set()
    for span in spans:
        if _ETR_RE.search(span.text) or not _SF_RE.search(span.text):
            continue
        pt = Point(*_span_center(span))
        if not region.contains(pt):
            continue
        containing = [
            face
            for face in faces
            if face.contains(pt) and face.intersection(region).area >= 0.5 * face.area
        ]
        if not containing:
            continue
        face = min(containing, key=lambda f: f.area)
        key = id(face)
        if key not in seen:
            seen.add(key)
            out.append(face)
    return out


def _line_segments(vector_paths: list[VectorPath]) -> list[tuple[LineString, bool, str]]:
    segments: list[tuple[LineString, bool, str]] = []
    for vp in vector_paths:
        for sub in vp.points:
            for a, b in zip(sub, sub[1:], strict=False):
                if math.dist(a, b) >= 4:
                    segments.append((LineString([a, b]), _is_gray(vp.color), vp.id))
    return segments


def _is_diagonal(line: LineString) -> bool:
    (x0, y0), (x1, y1) = list(line.coords)
    angle = abs(math.degrees(math.atan2(y1 - y0, x1 - x0))) % 180
    return 15 <= angle <= 75 or 105 <= angle <= 165


def detect_exclusion_regions(
    *,
    sheet_id: str,
    vector_paths: list[VectorPath],
    spans: list[OCRSpan],
    faces: list[Polygon],
    exclude_black_hatch: bool = True,
) -> list[ExclusionRegion]:
    """Detect existing/ETR regions that should be removed from measured work."""
    exclusions: list[ExclusionRegion] = []
    used_keys: set[tuple[str, tuple[int, int, int, int]]] = set()
    closed_polys = []
    gray_polys = []
    for vp in vector_paths:
        is_gray_fill = "fill" in vp.kind and _is_gray(vp.fill_color or vp.color)
        for poly in _polygons_from_path(vp):
            closed_polys.append((poly, [vp.id], is_gray_fill))
            if is_gray_fill:
                gray_polys.append((poly, [vp.id]))

    def add(reason: str, poly: Polygon, source_ids: list[str], confidence: float):
        key = (reason, tuple(round(v) for v in poly.bounds))
        if key in used_keys:
            return
        used_keys.add(key)
        exclusions.append(_exclusion(sheet_id, reason, poly, source_ids, confidence))

    def add_geom(reason: str, geom, source_ids: list[str], confidence: float):
        if geom.is_empty:
            return
        if isinstance(geom, Polygon):
            if geom.area > 25:
                add(reason, geom, source_ids, confidence)
            return
        if geom.geom_type == "MultiPolygon":
            for part in geom.geoms:
                if isinstance(part, Polygon) and part.area > 25:
                    add(reason, part, source_ids, confidence)

    for vp in vector_paths:
        if "fill" not in vp.kind or not _is_gray(vp.fill_color or vp.color):
            continue
        for poly in _polygons_from_path(vp):
            x0, y0, x1, y1 = poly.bounds
            w, h = x1 - x0, y1 - y0
            aspect = max(w, h) / max(1.0, min(w, h))
            reason = "shaded_existing_wall" if aspect >= 3.0 else "gray_fill"
            if reason == "gray_fill":
                label_faces = _scope_label_faces(poly, spans, faces)
                if label_faces:
                    clipped = poly.difference(unary_union(label_faces)).buffer(0)
                    add_geom(reason, clipped, [vp.id], 0.85)
                    continue
            add(reason, poly, [vp.id], 0.85)

    for span in spans:
        if not _ETR_RE.search(span.text):
            continue
        pt = Point(*_span_center(span))
        gray_containing = [(poly, ids) for poly, ids in gray_polys if poly.contains(pt)]
        if gray_containing:
            poly, source_ids = min(gray_containing, key=lambda item: item[0].area)
            if not _has_near_scope_area_label(poly, spans):
                add("etr_text", poly, [span.id, *source_ids], 0.95)
                continue
        containing = [
            (poly, ids)
            for poly, ids, is_gray_fill in closed_polys
            if not is_gray_fill and poly.contains(pt) and _is_local_to_span(poly, span)
        ]
        if containing:
            poly, source_ids = min(containing, key=lambda item: item[0].area)
            add("etr_text", poly, [span.id, *source_ids], 0.9)
            continue
        face = next((f for f in faces if f.contains(pt)), None)
        if face is not None and _is_local_to_span(face, span):
            add("etr_text", face, [span.id], 0.8)
        elif face is not None:
            local = _span_region(span).intersection(face).buffer(0)
            if local.geom_type == "MultiPolygon":
                local = max(local.geoms, key=lambda p: p.area)
            if isinstance(local, Polygon) and not local.is_empty:
                add("etr_text", local, [span.id], 0.6)

    for vp in vector_paths:
        if "stroke" not in vp.kind or not _is_gray(vp.color) or vp.stroke_width < 0.45:
            continue
        for sub in vp.points:
            for a, b in zip(sub, sub[1:], strict=False):
                line = LineString([a, b])
                if line.length < 18.0:
                    continue
                width = max(2.0, vp.stroke_width * 2.5)
                poly = line.buffer(width, cap_style=2, join_style=2)
                if poly.is_empty or not poly.is_valid:
                    continue
                x0, y0, x1, y1 = poly.bounds
                aspect = max(x1 - x0, y1 - y0) / max(1.0, min(x1 - x0, y1 - y0))
                if aspect >= 3.0:
                    add("shaded_existing_wall", poly, [vp.id], 0.78)

    etr_points = [Point(*_span_center(span)) for span in spans if _ETR_RE.search(span.text)]
    segments = [s for s in _line_segments(vector_paths) if _is_diagonal(s[0])]
    if not segments or not faces:
        return exclusions
    tree = STRtree(faces)
    face_by_id = {id(face): idx for idx, face in enumerate(faces)}
    hatch_stats: dict[int, tuple[int, float, float, set[str]]] = {}
    for segment, is_gray_segment, source_id in segments:
        for candidate in tree.query(segment):
            if hasattr(candidate, "__index__"):
                idx = int(candidate)
                face = faces[idx]
            else:
                face = candidate
                idx = face_by_id.get(id(face), -1)
            if idx < 0:
                continue
            if face.intersection(segment).length < 0.8 * segment.length:
                continue
            count, length, gray_length, source_ids = hatch_stats.get(idx, (0, 0.0, 0.0, set()))
            source_ids.add(source_id)
            hatch_stats[idx] = (
                count + 1,
                length + segment.length,
                gray_length + (segment.length if is_gray_segment else 0.0),
                source_ids,
            )

    for idx, (count, diagonal_len, gray_len, source_ids) in hatch_stats.items():
        if count < 3:
            continue
        face = faces[idx]
        hatch_density = diagonal_len / max(1.0, face.area)
        hatch_like = diagonal_len >= max(30.0, math.sqrt(face.area) * 0.8) and hatch_density >= 0.08
        if not hatch_like:
            continue
        gray_hatch = gray_len >= diagonal_len * 0.5
        etr_hatch = any(face.contains(pt) or face.distance(pt) <= 12.0 for pt in etr_points)
        overlaps_gray_fill = any(face.intersects(poly) for poly, _ in gray_polys)
        if exclude_black_hatch or gray_hatch or etr_hatch or overlaps_gray_fill:
            add("hatch_fill", face, sorted(source_ids), 0.8)

    return exclusions


def exclusion_polygons(exclusions: list[ExclusionRegion]) -> list[Polygon]:
    polys: list[Polygon] = []
    for exclusion in exclusions:
        if len(exclusion.exterior) >= 3:
            poly = Polygon(exclusion.exterior, exclusion.holes)
            if poly.is_valid and not poly.is_empty:
                polys.append(poly)
    return polys
