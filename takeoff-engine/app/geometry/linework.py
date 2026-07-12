"""Vector-first boundaries — the accurate measurement path.

Most construction PDFs are plotted from CAD: the walls, room boundaries, and
slab edges are REAL vector polylines with exact coordinates already in the file.
When they exist, the measured area should come from that geometry — not from a
neural segmentation mask, which is only an approximation.

This module reconstructs the enclosed polygon "faces" implied by the linework
(Shapely `polygonize` over the noded network of segments) and matches a face to
a detector box, so the detector only has to *locate* a room/slab while the area
comes from the drawing itself. The neural mask stays as the fallback for raster
sheets that carry no linework.
"""

from __future__ import annotations

import math
import re

from shapely.geometry import LineString, Point, Polygon
from shapely.geometry import box as shp_box
from shapely.ops import polygonize, unary_union

from app.schemas.core import VectorPath
from app.schemas.ocr import OCRSpan

Coords = list[tuple[float, float]]
BBox = tuple[float, float, float, float]

_SHEET_REF_RE = re.compile(r"^[A-Z]{1,4}-?(?:\d{2,4}|\d(?:[.\-]\d{1,4})+)$", re.IGNORECASE)
_WALL_CODE_RE = re.compile(r"^[A-Z]\d(?:-\d+){2,}$", re.IGNORECASE)
_METADATA_TEXT_RE = re.compile(
    r"\b(?:project|sheet|title|date|drawn|checked|revision|scale|number|client|paper|type|legend|notes?)\b",
    re.IGNORECASE,
)
_SIDE_METADATA_TEXT_RE = re.compile(
    r"\b(?:project|sheet|title|date|drawn|checked|revision|number|client|paper|type|legend|notes?)\b",
    re.IGNORECASE,
)


def _bbox_area(b: BBox) -> float:
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def _bbox_center(b: BBox) -> tuple[float, float]:
    return ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)


def _bbox_inside_any(b: BBox, boxes: list[BBox]) -> bool:
    if not boxes:
        return True
    cx, cy = _bbox_center(b)
    return any(x0 <= cx <= x1 and y0 <= cy <= y1 for x0, y0, x1, y1 in boxes)


def _bbox_overlaps_any(b: BBox, boxes: list[BBox], threshold: float = 0.2) -> bool:
    if not boxes:
        return False
    area = _bbox_area(b)
    if area <= 0:
        return _bbox_inside_any(b, boxes)
    bb = shp_box(*b)
    return any(bb.intersection(shp_box(*x)).area / area >= threshold for x in boxes)


def _path_length(vp: VectorPath) -> float:
    total = 0.0
    for sub in vp.points:
        for a, b in zip(sub, sub[1:], strict=False):
            total += math.dist(a, b)
    return total


def filter_measurement_paths(
    vector_paths: list[VectorPath],
    *,
    drawing_boxes: list[BBox] | None = None,
    exclusion_boxes: list[BBox] | None = None,
    min_length_pt: float = 6.0,
) -> list[VectorPath]:
    """Keep only solid, measurement-relevant linework.

    Semantic model boxes provide soft drawing/exclusion regions. When no drawing
    box exists, the full sheet is allowed; when title/notes/schedule boxes are
    detected, paths whose centers land there are excluded.
    """
    out: list[VectorPath] = []
    for vp in vector_paths:
        if vp.dashes:
            continue
        if _path_length(vp) < min_length_pt:
            continue
        if not _bbox_inside_any(vp.bbox, drawing_boxes or []):
            continue
        if _bbox_overlaps_any(vp.bbox, exclusion_boxes or [], threshold=0.15):
            continue
        out.append(vp)
    return out


def detect_metadata_boxes(
    vector_paths: list[VectorPath],
    spans: list[OCRSpan] | None = None,
    *,
    min_area_pt2: float = 1200.0,
) -> list[BBox]:
    """Find title-block/metadata boxes without assuming every sheet has one.

    The heuristic is intentionally narrow: a closed box must sit near a page
    edge and contain sheet/project-like text. That keeps normal plan geometry
    untouched when there is no title block.
    """
    if not vector_paths or not spans:
        return []
    page_w = max(
        [vp.bbox[2] for vp in vector_paths] + [span.bbox[2] for span in spans],
        default=0.0,
    )
    page_h = max(
        [vp.bbox[3] for vp in vector_paths] + [span.bbox[3] for span in spans],
        default=0.0,
    )
    if page_w <= 0 or page_h <= 0:
        return []

    out: list[BBox] = []
    for vp in vector_paths:
        if not vp.is_closed:
            continue
        x0, y0, x1, y1 = vp.bbox
        area = _bbox_area(vp.bbox)
        if area < min_area_pt2:
            continue
        near_edge = (
            x1 <= page_w * 0.28
            or x0 <= page_w * 0.04
            or x0 >= page_w * 0.82
            or y0 >= page_h * 0.88
            or x1 >= page_w * 0.92
        )
        if not near_edge:
            continue
        hits = []
        for span in spans:
            cx, cy = _bbox_center(span.bbox)
            if not (x0 <= cx <= x1 and y0 <= cy <= y1):
                continue
            text = span.text.strip()
            if _WALL_CODE_RE.match(text):
                continue
            if _SHEET_REF_RE.match(text) or _METADATA_TEXT_RE.search(text):
                hits.append(text)
        if hits:
            out.append(vp.bbox)
    side_clusters = [
        ("left", [span for span in spans if _bbox_center(span.bbox)[0] <= page_w * 0.25]),
        ("right", [span for span in spans if _bbox_center(span.bbox)[0] >= page_w * 0.86]),
        ("bottom", [span for span in spans if _bbox_center(span.bbox)[1] >= page_h * 0.88]),
    ]
    for side, cluster in side_clusters:
        keyword_spans = [
            span for span in cluster
            if not _WALL_CODE_RE.match(span.text.strip())
            and _SIDE_METADATA_TEXT_RE.search(span.text)
        ]
        # Window/door marks such as W20 satisfy the loose sheet-reference
        # grammar and are commonly repeated down an exterior wall. They must
        # not stretch a title-block exclusion across the drawing. A bare sheet
        # reference only contributes when it is physically local to a real
        # metadata label (PROJECT, SHEET, DATE, etc.).
        nearby_refs = [
            span for span in cluster
            if _SHEET_REF_RE.match(span.text.strip())
            and any(
                math.dist(_bbox_center(span.bbox), _bbox_center(label.bbox)) <= 140.0
                for label in keyword_spans
            )
        ]
        metadata_spans = [*keyword_spans, *nearby_refs]
        # A normal drawing can have a scale note, wall tag, or sheet ref near
        # an edge — and plan annotations often cluster near one too. Only
        # multiple metadata-LIKE spans make a panel; raw text density alone
        # once swallowed a 1300pt band of an RCP's plan area.
        if len(keyword_spans) < 2:
            continue
        if side == "bottom" and len(keyword_spans) < 3:
            continue
        chosen = metadata_spans if metadata_spans else cluster
        xs = [v for span in chosen for v in (span.bbox[0], span.bbox[2])]
        ys = [v for span in chosen for v in (span.bbox[1], span.bbox[3])]
        x0, x1 = max(0.0, min(xs) - 24.0), min(page_w, max(xs) + 24.0)
        y0, y1 = max(0.0, min(ys) - 24.0), min(page_h, max(ys) + 24.0)
        if side == "left":
            x1 = min(x1, page_w * 0.23)
        elif side == "right":
            x0 = max(x0, page_w * 0.82)
        elif side == "bottom":
            y0 = max(y0, page_h * 0.9)

        # A narrow metadata cluster repeated at substantially different
        # heights is a vertical title strip. Exclude the whole strip so logos,
        # seals, and revision cells above/below the text cannot become takeoff
        # geometry. The x edge is based only on metadata keywords, not plan
        # marks, keeping the active drawing untouched.
        keyword_ys = [_bbox_center(span.bbox)[1] for span in keyword_spans]
        if side in {"left", "right"} and keyword_ys:
            keyword_xs = [v for span in keyword_spans for v in (span.bbox[0], span.bbox[2])]
            narrow = max(keyword_xs) - min(keyword_xs) <= page_w * 0.15
            vertically_distributed = max(keyword_ys) - min(keyword_ys) >= page_h * 0.25
            if narrow and vertically_distributed:
                y0, y1 = 0.0, page_h
                if side == "right":
                    x0, x1 = max(page_w * 0.82, min(keyword_xs) - 24.0), page_w
                else:
                    x0, x1 = 0.0, min(page_w * 0.23, max(keyword_xs) + 24.0)
        if x1 - x0 <= page_w * 0.35 or y1 - y0 <= page_h * 0.2:
            out.append((x0, y0, x1, y1))
    return out


_LEGEND_TITLE_RE = re.compile(
    r"^\s*(?:"
    r"[A-Z /&-]{0,28}\bLEGEND\b[A-Z /&-]{0,12}"
    r"|KEY\s*(?:NOTES?|PLAN)?"
    r"|GENERAL\s+(?:NOTES?|SCOPE)"
    r"|(?:CONSTRUCTION|DEMOLITION|FLOOR\s+PLAN|WALL|FINISH|SHEET)\s+NOTES?"
    r")\s*:?\s*$",
    re.IGNORECASE,
)


def detect_legend_boxes(
    vector_paths: list[VectorPath],
    spans: list[OCRSpan],
    *,
    max_page_fraction: float = 0.22,
) -> list[BBox]:
    """Exclusion boxes around titled legend/key/notes panels wherever they sit.

    A legend redraws wall/door/window samples at true style — the one thing a
    takeoff must never measure. The panel is the title's enclosing closed
    rectangle when one exists, else the text block hanging below the title."""
    if not spans:
        return []
    page_w = max(
        [vp.bbox[2] for vp in vector_paths] + [span.bbox[2] for span in spans], default=0.0
    )
    page_h = max(
        [vp.bbox[3] for vp in vector_paths] + [span.bbox[3] for span in spans], default=0.0
    )
    if page_w <= 0 or page_h <= 0:
        return []
    max_area = page_w * page_h * max_page_fraction

    out: list[BBox] = []
    for span in spans:
        if not _LEGEND_TITLE_RE.match(span.text.strip()):
            continue
        cx, cy = _bbox_center(span.bbox)
        enclosing: BBox | None = None
        for vp in vector_paths:
            if not vp.is_closed:
                continue
            x0, y0, x1, y1 = vp.bbox
            if not (x0 <= cx <= x1 and y0 <= cy <= y1):
                continue
            area = _bbox_area(vp.bbox)
            if area < _bbox_area(span.bbox) * 3 or area > max_area:
                continue
            if enclosing is None or area < _bbox_area(enclosing):
                enclosing = vp.bbox
        if enclosing is not None:
            out.append(enclosing)
            continue
        # no drawn frame: take the text block hanging below/beside the title
        x_lo = span.bbox[0] - 30.0
        x_hi = max(span.bbox[2], span.bbox[0] + 380.0)
        members = [span.bbox]
        cursor_y = span.bbox[3]
        for other in sorted(spans, key=lambda s: s.bbox[1]):
            if other.bbox[1] <= span.bbox[1] or other.bbox[0] < x_lo or other.bbox[0] > x_hi:
                continue
            if other.bbox[1] - cursor_y > 60.0:
                break
            members.append(other.bbox)
            cursor_y = max(cursor_y, other.bbox[3])
        x0 = min(b[0] for b in members) - 12.0
        y0 = min(b[1] for b in members) - 12.0
        x1 = max(b[2] for b in members) + 12.0
        y1 = max(b[3] for b in members) + 12.0
        if (x1 - x0) * (y1 - y0) <= max_area:
            out.append((max(0.0, x0), max(0.0, y0), min(page_w, x1), min(page_h, y1)))
    return out


def polygonize_faces(vector_paths: list[VectorPath], min_area_pt2: float = 200.0) -> list[Polygon]:
    """Enclosed faces implied by the linework, largest first, noise filtered.

    `min_area_pt2` drops hatch/text/dimension-tick slivers (200 pt² ≈ a 14×14 pt
    box of paper) so only real rooms/slabs survive.
    """
    segments: list[LineString] = []
    for vp in vector_paths:
        for sub in vp.points:
            if len(sub) >= 2:
                segments.append(LineString(sub))
    if not segments:
        return []
    # unary_union nodes the network (splits every segment at intersections) so
    # polygonize can find the minimal enclosed cycles.
    noded = unary_union(segments)
    faces = [p for p in polygonize(noded) if p.is_valid and p.area >= min_area_pt2]
    faces.sort(key=lambda p: p.area, reverse=True)
    return faces


def floor_for_detection(
    faces: list[Polygon],
    bbox_pt: BBox,
    column_polys: list[Polygon] | None = None,
    exclusion_polys: list[Polygon] | None = None,
    contain_frac: float = 0.35,
) -> Polygon | None:
    """Merge the floor faces inside a detection and subtract columns as holes."""
    parts = floor_polygons_for_detection(
        faces,
        bbox_pt,
        column_polys=column_polys,
        exclusion_polys=exclusion_polys,
        contain_frac=contain_frac,
    )
    return parts[0] if parts else None


def floor_polygons_for_detection(
    faces: list[Polygon],
    bbox_pt: BBox,
    column_polys: list[Polygon] | None = None,
    exclusion_polys: list[Polygon] | None = None,
    contain_frac: float = 0.35,
    min_area_pt2: float = 5_000.0,
) -> list[Polygon]:
    """Merge floor faces and keep every valid disconnected floor part."""
    bx = shp_box(*bbox_pt)
    contained = [
        f for f in faces
        if f.intersection(bx).area >= contain_frac * f.area
    ]
    if not contained:
        return []
    merged = unary_union(contained).buffer(0)
    if merged.is_empty:
        return []
    if column_polys:
        merged = merged.difference(unary_union(column_polys)).buffer(0)
    if exclusion_polys:
        merged = merged.difference(unary_union(exclusion_polys)).buffer(0)
    if merged.is_empty:
        return []
    if isinstance(merged, Polygon):
        return [merged] if merged.area >= min_area_pt2 else []
    if merged.geom_type == "MultiPolygon":
        parts = [p for p in merged.geoms if isinstance(p, Polygon) and p.area >= min_area_pt2]
        parts.sort(key=lambda p: p.area, reverse=True)
        return parts
    return []


def face_for_detection(
    faces: list[Polygon],
    bbox_pt: tuple[float, float, float, float],
    label: str,
    contain_frac: float = 0.8,
    area_slack: float = 1.2,
) -> Polygon | None:
    """Pick the vector geometry that a detection box points at.

    A face counts as "inside" the box when >= contain_frac of its area lies
    within the box (so we never grab a neighbouring room). Then:
      - room  → the single largest contained face (its interior, holes kept, so
                a column/void inside the room is subtracted from floor area).
      - slab/wall → the OUTER footprint: union the contained faces and take the
                exterior, because concrete is poured under the interior
                partitions too (the slab is the whole footprint, not
                footprint-minus-rooms).
    Returns None when no vector face matches (→ caller falls back to the mask).
    """
    bx = shp_box(*bbox_pt)
    box_area = bx.area
    if box_area <= 0:
        return None
    contained = [
        f for f in faces
        if f.area <= box_area * area_slack and f.intersection(bx).area >= contain_frac * f.area
    ]
    if not contained:
        return None

    if label in ("slab", "wall"):
        merged = unary_union(contained).buffer(0)  # heal any seams
        if merged.is_empty:
            return None
        if merged.geom_type == "MultiPolygon":
            merged = max(merged.geoms, key=lambda p: p.area)
        return Polygon(merged.exterior)  # filled footprint, interior partitions ignored
    return max(contained, key=lambda f: f.area)


def polygon_to_rings(poly: Polygon) -> tuple[Coords, list[Coords]]:
    """Shapely polygon → (exterior ring, interior hole rings) in page points."""
    exterior = [(float(x), float(y)) for x, y in poly.exterior.coords]
    holes = [[(float(x), float(y)) for x, y in ring.coords] for ring in poly.interiors]
    return exterior, holes


def _is_compact_column(poly: Polygon, min_area_pt2: float, max_area_pt2: float) -> bool:
    if not poly.is_valid or not (min_area_pt2 <= poly.area <= max_area_pt2):
        return False
    x0, y0, x1, y1 = poly.bounds
    w, h = x1 - x0, y1 - y0
    if w <= 0 or h <= 0:
        return False
    aspect = max(w, h) / min(w, h)
    return aspect <= 1.35


def _column_shape(poly: Polygon, points: int) -> str:
    circularity = 4 * math.pi * poly.area / (poly.length * poly.length) if poly.length else 0
    return "round" if points >= 8 and circularity >= 0.72 else "square"


def detect_columns(
    vector_paths: list[VectorPath],
    *,
    min_area_pt2: float = 80.0,
    max_area_pt2: float = 3600.0,
    text_boxes: list[Polygon] | None = None,
    require_structural_evidence: bool = False,
) -> list[tuple[str, Polygon]]:
    """Detect compact square/round column footprints from closed vector shapes."""
    columns: list[tuple[str, Polygon]] = []
    seen: set[tuple[int, int, int, int]] = set()
    text_boxes = text_boxes or []
    for vp in vector_paths:
        for sub in vp.points:
            if len(sub) < 4:
                continue
            ring = list(sub)
            if ring[0] != ring[-1]:
                if math.dist(ring[0], ring[-1]) > 1.0:
                    continue
                ring[-1] = ring[0]
            poly = Polygon(ring)
            if not _is_compact_column(poly, min_area_pt2, max_area_pt2):
                continue
            if any(
                poly.covers(text_box.representative_point())
                or poly.intersection(text_box).area >= 0.05 * poly.area
                for text_box in text_boxes
            ):
                continue
            shape = _column_shape(poly, len(ring))
            if require_structural_evidence:
                fill = (vp.fill_color or vp.color).lower()
                # CAD sheets use pure-white fill-only polygons as knockout
                # backgrounds for grid heads, section bubbles, and tags. A new
                # outlined column remains a stroke/fill_stroke path, while
                # poche columns retain a non-white fill.
                if vp.kind == "fill" and fill in {"", "#ffffff"}:
                    continue
                if shape == "round" and vp.kind == "stroke":
                    # Small thin circles are overwhelmingly door/detail/grid
                    # callouts. Round columns are either filled or have a
                    # materially heavier/larger structural outline.
                    if vp.stroke_width < 1.0 and poly.area < 400.0:
                        continue
                if shape == "square" and vp.kind == "stroke":
                    rect = poly.minimum_rotated_rectangle
                    if len(ring) > 6 or poly.area / max(1.0, rect.area) < 0.85:
                        continue
            key = tuple(round(v) for v in poly.bounds)
            if key in seen:
                continue
            seen.add(key)
            columns.append((shape, poly))
    return columns


def _polygon_from_path(vp: VectorPath) -> Polygon | None:
    for sub in vp.points:
        if len(sub) < 4:
            continue
        ring = list(sub)
        if ring[0] != ring[-1]:
            if math.dist(ring[0], ring[-1]) > 1.0:
                continue
            ring[-1] = ring[0]
        poly = Polygon(ring)
        if poly.is_valid and not poly.is_empty and poly.area > 1:
            return poly
    return None


def _rect_sides(poly: Polygon) -> tuple[float, float]:
    rect = poly.minimum_rotated_rectangle
    coords = list(rect.exterior.coords)
    lengths = sorted(
        math.dist(coords[i], coords[i + 1]) for i in range(4)
    )
    return lengths[0], lengths[-1]


def _rect_angle(poly: Polygon) -> float:
    rect = poly.minimum_rotated_rectangle
    coords = list(rect.exterior.coords)
    edges = [
        (coords[i], coords[i + 1], math.dist(coords[i], coords[i + 1]))
        for i in range(4)
    ]
    (x0, y0), (x1, y1), _ = max(edges, key=lambda item: item[2])
    return abs(math.degrees(math.atan2(y1 - y0, x1 - x0))) % 180


def _angle_delta(a: float, b: float) -> float:
    diff = abs(a - b) % 180
    return min(diff, 180 - diff)


def _is_wall_rect(poly: Polygon, *, min_length_pt: float, max_thickness_pt: float) -> bool:
    short, long = _rect_sides(poly)
    if short <= 0 or long < min_length_pt:
        return False
    if short > max_thickness_pt:
        return False
    if long / short < 3.0:
        return False
    return poly.area / max(1.0, short * long) >= 0.72


def _is_excluded(poly: Polygon, excluded: list[Polygon]) -> bool:
    point = poly.representative_point()
    return any(
        ex.covers(point) or ex.intersection(poly).area >= 0.25 * poly.area
        for ex in excluded
    )


def _overlaps_text(poly: Polygon, text_boxes: list[Polygon]) -> bool:
    return any(
        tb.intersects(poly) and tb.intersection(poly).area >= 0.10 * poly.area
        for tb in text_boxes
    )


def _near_code(poly: Polygon, code_points: list[tuple[float, float]], max_distance_pt: float) -> bool:
    if not code_points:
        return True
    return min(poly.distance(Point(x, y)) for x, y in code_points) <= max_distance_pt


def _is_gray_linework(color: str) -> bool:
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


def wall_context_segments(
    vector_paths: list[VectorPath],
    min_length_pt: float = 4.0,
    *,
    include_gray: bool = True,
) -> list[LineString]:
    segments: list[LineString] = []
    for vp in vector_paths:
        if vp.dashes:
            continue
        if not include_gray and _is_gray_linework(vp.color):
            continue
        for sub in vp.points:
            for a, b in zip(sub, sub[1:], strict=False):
                if math.dist(a, b) >= min_length_pt:
                    segments.append(LineString([a, b]))
    return segments


def _is_hatch_like_wall_candidate(poly: Polygon, context_segments: list[LineString]) -> bool:
    if not context_segments:
        return False
    angle = _rect_angle(poly)
    # True slanted walls exist; only reject them when they sit in a dense run of
    # parallel strokes, which is how diagonal hatch/ETR fills are drawn.
    if _angle_delta(angle, 0) <= 12 or _angle_delta(angle, 90) <= 12:
        return False
    short, _ = _rect_sides(poly)
    search = poly.buffer(max(10.0, short * 2.5))
    parallel = 0
    for segment in context_segments:
        if not search.intersects(segment):
            continue
        (x0, y0), (x1, y1) = list(segment.coords)
        seg_angle = abs(math.degrees(math.atan2(y1 - y0, x1 - x0))) % 180
        if _angle_delta(angle, seg_angle) <= 8:
            parallel += 1
            if parallel >= 3:
                return True
    return False


def _dedupe_wall_polys(candidates: list[tuple[Polygon, float]]) -> list[tuple[Polygon, float]]:
    kept: list[tuple[Polygon, float]] = []
    for poly, length in sorted(candidates, key=lambda item: item[0].area, reverse=True):
        if any(poly.intersection(existing).area >= 0.55 * poly.area for existing, _ in kept):
            continue
        kept.append((poly, length))
    return kept


def _axis_aligned_rect_parts(poly: Polygon, *, max_cells: int = 400) -> list[Polygon]:
    coords = list(poly.exterior.coords)
    # Only decompose rectilinear wall bodies. Rotated rectangles are handled by
    # minimum-rotated-rectangle tests above.
    for (x0, y0), (x1, y1) in zip(coords, coords[1:], strict=False):
        if abs(x0 - x1) > 0.5 and abs(y0 - y1) > 0.5:
            return []
    xs = sorted({round(x, 3) for x, _ in coords})
    ys = sorted({round(y, 3) for _, y in coords})
    if len(xs) < 2 or len(ys) < 2 or (len(xs) - 1) * (len(ys) - 1) > max_cells:
        return []

    row_runs: list[tuple[float, float, float, float]] = []
    for y0, y1 in zip(ys, ys[1:], strict=False):
        run_start: float | None = None
        run_end: float | None = None
        for x0, x1 in zip(xs, xs[1:], strict=False):
            cell = shp_box(x0, y0, x1, y1)
            inside = (
                cell.area > 0
                and poly.intersection(cell).area >= 0.95 * cell.area
                and poly.covers(cell.representative_point())
            )
            if inside:
                run_start = x0 if run_start is None else run_start
                run_end = x1
            elif run_start is not None and run_end is not None:
                row_runs.append((run_start, y0, run_end, y1))
                run_start = run_end = None
        if run_start is not None and run_end is not None:
            row_runs.append((run_start, y0, run_end, y1))

    merged: list[tuple[float, float, float, float]] = []
    for rect in row_runs:
        x0, y0, x1, y1 = rect
        if merged and abs(merged[-1][0] - x0) <= 0.001 and abs(merged[-1][2] - x1) <= 0.001 and abs(merged[-1][3] - y0) <= 0.001:
            px0, py0, px1, _ = merged[-1]
            merged[-1] = (px0, py0, px1, y1)
        else:
            merged.append(rect)
    return [shp_box(*rect) for rect in merged]


def _segment_record(line: LineString):
    (x0, y0), (x1, y1) = list(line.coords)
    length = math.dist((x0, y0), (x1, y1))
    if length <= 0:
        return None
    ux, uy = (x1 - x0) / length, (y1 - y0) / length
    if ux < -0.001 or (abs(ux) <= 0.001 and uy < 0):
        ux, uy = -ux, -uy
        x0, y0, x1, y1 = x1, y1, x0, y0
    nx, ny = -uy, ux
    t0, t1 = x0 * ux + y0 * uy, x1 * ux + y1 * uy
    if t1 < t0:
        t0, t1 = t1, t0
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    ncoord = mx * nx + my * ny
    angle = abs(math.degrees(math.atan2(uy, ux))) % 180
    return {
        "line": line,
        "length": length,
        "u": (ux, uy),
        "n": (nx, ny),
        "t": (t0, t1),
        "ncoord": ncoord,
        "angle": angle,
    }


def _point_from_basis(t: float, ncoord: float, u: tuple[float, float], n: tuple[float, float]) -> tuple[float, float]:
    return (u[0] * t + n[0] * ncoord, u[1] * t + n[1] * ncoord)


def extract_parallel_wall_pairs(
    vector_paths: list[VectorPath],
    *,
    exclude_polygons: list[Polygon] | None = None,
    text_boxes: list[Polygon] | None = None,
    code_points: list[tuple[float, float]] | None = None,
    context_segments: list[LineString] | None = None,
    min_length_pt: float = 18.0,
    min_thickness_pt: float = 4.0,
    max_thickness_pt: float = 18.0,
    max_code_distance_pt: float = 95.0,
    angle_bin_deg: float = 3.0,
) -> list[tuple[Polygon, float]]:
    """Pair double-line wall outlines into one rectangular wall body."""
    excluded = [poly.buffer(0.5) for poly in (exclude_polygons or [])]
    text_boxes = text_boxes or []
    code_points = code_points or []
    context_segments = context_segments or wall_context_segments(vector_paths)
    records = []
    for idx, segment in enumerate(context_segments):
        if not (min_length_pt <= segment.length <= 500.0):
            continue
        record = _segment_record(segment)
        if record is not None:
            if _angle_delta(record["angle"], 0) > 12 and _angle_delta(record["angle"], 90) > 12:
                continue
            record["idx"] = idx
            records.append(record)

    groups: dict[int, list[dict]] = {}
    for record in records:
        key = int(round(record["angle"] / angle_bin_deg))
        groups.setdefault(key, []).append(record)

    candidates: list[tuple[Polygon, float]] = []
    seen_pairs: set[tuple[int, int, int, int]] = set()

    def add(poly: Polygon, length: float):
        short, long = _rect_sides(poly)
        if short < min_thickness_pt or short > max_thickness_pt:
            return
        if long < min_length_pt or long / short < 3.0:
            return
        if _is_excluded(poly, excluded) or _overlaps_text(poly, text_boxes):
            return
        if not _near_code(poly, code_points, max_code_distance_pt):
            return
        if _is_hatch_like_wall_candidate(poly, context_segments):
            return
        key = tuple(round(v) for v in poly.bounds)
        if key in seen_pairs:
            return
        seen_pairs.add(key)
        candidates.append((poly, length))

    for group in groups.values():
        group.sort(key=lambda r: r["ncoord"])
        for i, a in enumerate(group):
            for b in group[i + 1:]:
                thickness = abs(b["ncoord"] - a["ncoord"])
                if thickness > max_thickness_pt:
                    break
                if thickness < min_thickness_pt:
                    continue
                if _angle_delta(a["angle"], b["angle"]) > angle_bin_deg:
                    continue
                ux, uy = a["u"]
                nx, ny = a["n"]
                b0, b1 = list(b["line"].coords)
                bt = sorted([b0[0] * ux + b0[1] * uy, b1[0] * ux + b1[1] * uy])
                at0, at1 = a["t"]
                t0, t1 = max(at0, bt[0]), min(at1, bt[1])
                overlap = t1 - t0
                if overlap < min_length_pt or overlap < min(a["length"], b["length"]) * 0.55:
                    continue
                n1, n2 = a["ncoord"], b["ncoord"]
                poly = Polygon([
                    _point_from_basis(t0, n1, (ux, uy), (nx, ny)),
                    _point_from_basis(t1, n1, (ux, uy), (nx, ny)),
                    _point_from_basis(t1, n2, (ux, uy), (nx, ny)),
                    _point_from_basis(t0, n2, (ux, uy), (nx, ny)),
                    _point_from_basis(t0, n1, (ux, uy), (nx, ny)),
                ])
                if poly.is_valid and not poly.is_empty:
                    add(poly, overlap)
    return _dedupe_wall_polys(candidates)


def extract_wall_bodies(
    vector_paths: list[VectorPath],
    *,
    exclude_polygons: list[Polygon] | None = None,
    text_boxes: list[Polygon] | None = None,
    code_points: list[tuple[float, float]] | None = None,
    context_segments: list[LineString] | None = None,
    min_length_pt: float = 18.0,
    min_thickness_pt: float = 5.0,
    max_thickness_pt: float = 36.0,
    max_code_distance_pt: float = 80.0,
) -> list[tuple[Polygon, float]]:
    """Extract wall bodies as one rectangular polygon per wall segment.

    Open guide/dimension/hatch strokes are intentionally ignored. Existing
    shaded walls, columns, title blocks, and ETR regions are removed upstream by
    passing their polygons in `exclude_polygons`.
    """
    excluded = [poly.buffer(0.5) for poly in (exclude_polygons or [])]
    text_boxes = text_boxes or []
    code_points = code_points or []
    context_segments = context_segments or []
    bodies: list[tuple[Polygon, float]] = []
    seen: set[tuple[int, int, int, int]] = set()

    def add(poly: Polygon):
        short, length = _rect_sides(poly)
        if short < min_thickness_pt:
            return
        if _is_excluded(poly, excluded) or _overlaps_text(poly, text_boxes):
            return
        if not _near_code(poly, code_points, max_code_distance_pt):
            return
        if not _is_wall_rect(poly, min_length_pt=min_length_pt, max_thickness_pt=max_thickness_pt):
            return
        if _is_hatch_like_wall_candidate(poly, context_segments):
            return
        key = tuple(round(v) for v in poly.bounds)
        if key in seen:
            return
        seen.add(key)
        bodies.append((poly, length))

    for vp in vector_paths:
        if not vp.is_closed or vp.dashes:
            continue
        poly = _polygon_from_path(vp)
        if poly is None:
            continue
        if _is_wall_rect(poly, min_length_pt=min_length_pt, max_thickness_pt=max_thickness_pt):
            add(poly)
            continue
        for part in _axis_aligned_rect_parts(poly):
            add(part)
    return _dedupe_wall_polys(bodies)


def extract_wall_faces(
    faces: list[Polygon],
    *,
    exclude_polygons: list[Polygon] | None = None,
    text_boxes: list[Polygon] | None = None,
    code_points: list[tuple[float, float]] | None = None,
    context_segments: list[LineString] | None = None,
    min_length_pt: float = 18.0,
    min_thickness_pt: float = 5.0,
    max_thickness_pt: float = 36.0,
    max_code_distance_pt: float = 80.0,
) -> list[tuple[Polygon, float]]:
    """Extract hollow/double-line wall bodies from polygonized CAD faces."""
    excluded = [poly.buffer(0.5) for poly in (exclude_polygons or [])]
    text_boxes = text_boxes or []
    code_points = code_points or []
    context_segments = context_segments or []
    candidates: list[tuple[Polygon, float]] = []
    for face in faces:
        if face.is_empty or not face.is_valid:
            continue
        short, length = _rect_sides(face)
        if short < min_thickness_pt:
            continue
        angle = _rect_angle(face)
        if _angle_delta(angle, 0) > 12 and _angle_delta(angle, 90) > 12:
            continue
        if _is_excluded(face, excluded) or _overlaps_text(face, text_boxes):
            continue
        if not _near_code(face, code_points, max_code_distance_pt):
            continue
        if not _is_wall_rect(face, min_length_pt=min_length_pt, max_thickness_pt=max_thickness_pt):
            continue
        if _is_hatch_like_wall_candidate(face, context_segments):
            continue
        candidates.append((face, length))
    return _dedupe_wall_polys(candidates)


def extract_wall_segments(
    vector_paths: list[VectorPath],
    *,
    exclude_polygons: list[Polygon] | None = None,
    min_length_pt: float = 18.0,
) -> list[Coords]:
    """Extract straight wall-like segments from solid linework."""
    excluded = [poly.buffer(0.5) for poly in (exclude_polygons or [])]
    segments: list[Coords] = []
    seen: set[tuple[tuple[int, int], tuple[int, int]]] = set()
    for vp in vector_paths:
        for sub in vp.points:
            for a, b in zip(sub, sub[1:], strict=False):
                if math.dist(a, b) < min_length_pt:
                    continue
                line = LineString([a, b])
                mid = line.interpolate(0.5, normalized=True)
                if any(poly.covers(mid) for poly in excluded):
                    continue
                pa = (round(a[0], 1), round(a[1], 1))
                pb = (round(b[0], 1), round(b[1], 1))
                key = tuple(sorted((pa, pb)))  # type: ignore[arg-type]
                if key in seen:
                    continue
                seen.add(key)
                segments.append([a, b])
    return segments
