"""Candidate detection/segmentation stage.

detector boxes → boundary → deterministic geometry. The boundary comes from
the drawing's REAL vector linework whenever it exists (exact), and only falls
back to the neural segmentation mask on raster sheets with no linework. The
detector's job is to LOCATE and CLASSIFY a region; the area comes from the
geometry, never from the model directly.
"""

from __future__ import annotations

import math
import re

import numpy as np
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry import box as shp_box
from shapely.ops import unary_union

from app.adapters.base import DetectorAdapter, SegmenterAdapter
from app.geometry.engine import GeometryEngine
from app.geometry.exclusions import detect_exclusion_regions, exclusion_polygons
from app.geometry.linework import (
    detect_columns,
    detect_legend_boxes,
    detect_metadata_boxes,
    extract_wall_faces,
    face_for_detection,
    filter_measurement_paths,
    floor_polygons_for_detection,
    polygon_to_rings,
    polygonize_faces,
    wall_context_segments,
)
from app.geometry.walls import existing_wall_bands, extract_wall_strips
from app.pipeline.wall_tags import find_tag_spans, tag_anchors
from app.schemas.core import VectorPath
from app.schemas.detection import DetectedObject, ExclusionRegion, PolygonGeometry, SegmentationMask
from app.schemas.ocr import OCRSpan

AREA_LABELS = {"room", "floor_area", "slab"}
COUNT_LABELS = {"door", "window"}
SEMANTIC_VOCAB = [
    "drawing area",
    "title block",
    "notes",
    "legend",
    "schedule",
    "floor area",
    "wall",
    "square column",
    "round column",
    "door",
    "window",
]
EXCLUSION_LABELS = {"title_block", "notes", "legend", "schedule"}
DRAWING_LABELS = {"drawing_area"}
WALL_CODE_RE = re.compile(r"\b[A-Z]\d(?:-\d+){2,}\b", re.IGNORECASE)
DOOR_MARK_RE = re.compile(r"^(?:C\d{3,5}|\d{3}[A-Z]|\d{3,4}|[A-Z]?\d{2,4}[A-Z])$", re.IGNORECASE)
DETAIL_REF_RE = re.compile(r"^[A-Z]\d+\.\d+$", re.IGNORECASE)
WINDOW_MARK_RE = re.compile(r"^W\d{1,3}$", re.IGNORECASE)
FLOOR_AREA_LABEL_RE = re.compile(r"^\s*\d{1,4}(?:,\d{3})?\s*SF\s*$", re.IGNORECASE)
DEMOLITION_PLAN_RE = re.compile(r"^\s*DEMOLITION\s+PLAN\s*$", re.IGNORECASE)
CONSTRUCTION_PLAN_RE = re.compile(r"^\s*CONSTRUCTION\s+PLAN\s*$", re.IGNORECASE)
FINISH_PLAN_RE = re.compile(r"^\s*FINISH\s+PLAN\s*$", re.IGNORECASE)
REFLECTED_CEILING_PLAN_RE = re.compile(r"^\s*REFLECTED\s+CEILING\s+PLAN\s*$", re.IGNORECASE)
TITLE_BLOCK_LABELS = {"PROJECT TITLE", "SHEET TITLE", "SHEET NUMBER", "PROJECT NUMBER"}
_BROADLOOM_RE = re.compile(r"^\s*BROADLOOM\s*$", re.IGNORECASE)
_CARPET_RE = re.compile(r"^\s*CARPET\s*$", re.IGNORECASE)
_CARPET_RUNNER_RE = re.compile(r"^\s*CARPET\s+RUNNER\s*$", re.IGNORECASE)


def _center_in_box(box, outer) -> bool:
    cx = (box[0] + box[2]) / 2
    cy = (box[1] + box[3]) / 2
    return outer[0] <= cx <= outer[2] and outer[1] <= cy <= outer[3]


def _page_bounds(vector_paths: list[VectorPath], spans: list[OCRSpan]) -> tuple[float, float]:
    width = max(
        [vp.bbox[2] for vp in vector_paths] + [span.bbox[2] for span in spans],
        default=0.0,
    )
    height = max(
        [vp.bbox[3] for vp in vector_paths] + [span.bbox[3] for span in spans],
        default=0.0,
    )
    return width, height


def _expand_boxes(
    boxes: list[tuple[float, float, float, float]],
    width: float,
    height: float,
    pad: float = 24.0,
) -> list[tuple[float, float, float, float]]:
    if width <= 0 or height <= 0:
        return boxes
    return [
        (
            max(0.0, x0 - pad),
            max(0.0, y0 - pad),
            min(width, x1 + pad),
            min(height, y1 + pad),
        )
        for x0, y0, x1, y1 in boxes
    ]


def _view_x_bounds(
    spans: list[OCRSpan],
    width: float,
    anchor_spans: list[OCRSpan],
) -> tuple[float, float]:
    if width <= 0 or not anchor_spans:
        return 0.0, width
    left_anchor = min(span.bbox[0] for span in anchor_spans)
    left = max(0.0, left_anchor - max(260.0, width * 0.1))
    right = width
    title_xs = [
        span.bbox[0]
        for span in spans
        if span.bbox[0] > width * 0.72 and " ".join(span.text.upper().split()) in TITLE_BLOCK_LABELS
    ]
    if title_xs:
        right = min(right, min(title_xs) - 24.0)
    if right <= left + width * 0.25:
        return 0.0, width
    return left, right


def _new_work_drawing_boxes(
    spans: list[OCRSpan],
    width: float,
    height: float,
) -> list[tuple[float, float, float, float]]:
    """Prefer the construction drawing on combined demolition/construction sheets."""
    if width <= 0 or height <= 0:
        return []
    demos = []
    constructions = []
    for span in spans:
        # Ignore title-block sheet-title text on the far right.
        if span.bbox[0] >= width * 0.65:
            continue
        text = " ".join(span.text.split())
        if DEMOLITION_PLAN_RE.match(text):
            demos.append(span)
        elif CONSTRUCTION_PLAN_RE.match(text):
            constructions.append(span)
    if not demos or not constructions:
        return []

    construction = max(constructions, key=lambda s: (s.bbox[1] + s.bbox[3]) / 2)
    construction_y = (construction.bbox[1] + construction.bbox[3]) / 2
    prior_demos = [span for span in demos if (span.bbox[1] + span.bbox[3]) / 2 < construction_y]
    if not prior_demos:
        return []
    demolition = max(prior_demos, key=lambda s: (s.bbox[1] + s.bbox[3]) / 2)

    top = min(height, demolition.bbox[3] + max(48.0, height * 0.035))
    bottom = max(0.0, construction.bbox[1] - 12.0)
    if bottom - top < height * 0.12:
        return []
    left, right = _view_x_bounds(spans, width, [construction, demolition])
    return [(left, top, right, bottom)]


def _trade_drawing_boxes(
    spans: list[OCRSpan],
    width: float,
    height: float,
    requested_trades: set[str] | None,
) -> list[tuple[float, float, float, float]]:
    """Pick the relevant drawing view on multi-view sheets."""
    if width <= 0 or height <= 0 or not requested_trades or "flooring" not in requested_trades:
        return []

    finish_labels = []
    ceiling_labels = []
    for span in spans:
        # Ignore title-block sheet-title text on the far right.
        if span.bbox[0] >= width * 0.65:
            continue
        text = " ".join(span.text.split())
        if FINISH_PLAN_RE.match(text):
            finish_labels.append(span)
        elif REFLECTED_CEILING_PLAN_RE.match(text):
            ceiling_labels.append(span)
    if not finish_labels or not ceiling_labels:
        floor_tags = [
            span for span in spans
            if " ".join(span.text.upper().split()) == "FLOORING:"
            and span.bbox[0] < width * 0.9
        ]
        if len(floor_tags) < 3:
            return []
        # Single-view finish sheet: the repeated room finish tags are more
        # reliable anchors than a broad open-vocabulary "drawing area" box.
        # Generous padding reaches exterior walls while stopping before the
        # side title strip.
        return [(
            max(0.0, min(span.bbox[0] for span in floor_tags) - width * 0.15),
            max(0.0, min(span.bbox[1] for span in floor_tags) - height * 0.25),
            min(width, max(span.bbox[2] for span in floor_tags) + width * 0.10),
            min(height, max(span.bbox[3] for span in floor_tags) + height * 0.08),
        )]

    finish = max(finish_labels, key=lambda s: (s.bbox[1] + s.bbox[3]) / 2)
    finish_y = (finish.bbox[1] + finish.bbox[3]) / 2
    prior_ceiling = [
        span for span in ceiling_labels
        if (span.bbox[1] + span.bbox[3]) / 2 < finish_y
    ]
    if not prior_ceiling:
        return []
    ceiling = max(prior_ceiling, key=lambda s: (s.bbox[1] + s.bbox[3]) / 2)

    top = min(height, ceiling.bbox[3] + max(48.0, height * 0.035))
    bottom = max(0.0, finish.bbox[1] - 12.0)
    if bottom - top < height * 0.12:
        return []
    left, right = _view_x_bounds(spans, width, [finish, ceiling])
    return [(left, top, right, bottom)]


def _combine_drawing_boxes(
    semantic_boxes: list[tuple[float, float, float, float]],
    deterministic_boxes: list[tuple[float, float, float, float]],
) -> list[tuple[float, float, float, float]]:
    if not deterministic_boxes:
        return semantic_boxes
    if not semantic_boxes:
        return deterministic_boxes
    out = []
    deterministic_area = sum(shp_box(*box).area for box in deterministic_boxes)
    intersection_area = 0.0
    for sx0, sy0, sx1, sy1 in semantic_boxes:
        for dx0, dy0, dx1, dy1 in deterministic_boxes:
            x0, y0 = max(sx0, dx0), max(sy0, dy0)
            x1, y1 = min(sx1, dx1), min(sy1, dy1)
            if x1 > x0 and y1 > y0:
                box = (x0, y0, x1, y1)
                out.append(box)
                intersection_area += shp_box(*box).area
    if deterministic_area > 0 and intersection_area < deterministic_area * 0.55:
        return deterministic_boxes
    return out or deterministic_boxes


def _semantic_filter(detections: list[DetectedObject]) -> list[DetectedObject]:
    drawing_boxes = [d.bbox for d in detections if d.label in DRAWING_LABELS]
    exclusion_boxes = [d.bbox for d in detections if d.label in EXCLUSION_LABELS]
    out = []
    for det in detections:
        if det.label in DRAWING_LABELS | EXCLUSION_LABELS:
            out.append(det)
            continue
        if drawing_boxes and not any(_center_in_box(det.bbox, b) for b in drawing_boxes):
            continue
        if any(_center_in_box(det.bbox, b) for b in exclusion_boxes):
            continue
        out.append(det)
    return out


def _final_drawing_filter(
    detections: list[DetectedObject],
    drawing_boxes: list[tuple[float, float, float, float]],
    exclusion_boxes: list[tuple[float, float, float, float]],
) -> list[DetectedObject]:
    if not drawing_boxes:
        return detections
    out = []
    for det in detections:
        if det.label in DRAWING_LABELS | EXCLUSION_LABELS:
            out.append(det)
            continue
        if not any(_center_in_box(det.bbox, drawing) for drawing in drawing_boxes):
            continue
        if any(_center_in_box(det.bbox, exclusion) for exclusion in exclusion_boxes):
            continue
        out.append(det)
    return out


def _clip_exclusion_boxes_to_drawing(
    exclusion_boxes: list[tuple[float, float, float, float]],
    drawing_boxes: list[tuple[float, float, float, float]],
) -> list[tuple[float, float, float, float]]:
    if not drawing_boxes:
        return exclusion_boxes
    clipped = []
    for ex in exclusion_boxes:
        pieces = [ex]
        for dx0, dy0, dx1, dy1 in drawing_boxes:
            next_pieces = []
            for x0, y0, x1, y1 in pieces:
                if x1 <= dx0 or x0 >= dx1 or y1 <= dy0 or y0 >= dy1:
                    next_pieces.append((x0, y0, x1, y1))
                    continue
                if x0 < dx0:
                    next_pieces.append((x0, y0, dx0, y1))
                if x1 > dx1:
                    next_pieces.append((dx1, y0, x1, y1))
                if y0 < dy0:
                    next_pieces.append((max(x0, dx0), y0, min(x1, dx1), dy0))
                if y1 > dy1:
                    next_pieces.append((max(x0, dx0), dy1, min(x1, dx1), y1))
            pieces = next_pieces
        clipped.extend(
            (x0, y0, x1, y1)
            for x0, y0, x1, y1 in pieces
            if x1 - x0 > 1.0 and y1 - y0 > 1.0
        )
    return clipped


def _wall_code_points(spans: list[OCRSpan], exclusion_boxes, drawing_boxes=None) -> list[tuple[float, float]]:
    points = []
    for span in spans:
        if not WALL_CODE_RE.search(span.text):
            continue
        box = span.bbox
        if any(_center_in_box(box, exclusion) for exclusion in exclusion_boxes):
            continue
        if drawing_boxes and not any(_center_in_box(box, drawing) for drawing in drawing_boxes):
            continue
        points.append(((box[0] + box[2]) / 2, (box[1] + box[3]) / 2))
    return points


def _dedupe_wall_candidates(candidates: list[tuple[Polygon, float]]) -> list[tuple[Polygon, float]]:
    kept: list[tuple[Polygon, float]] = []
    for poly, length in sorted(candidates, key=lambda item: item[0].area, reverse=True):
        rect = poly.minimum_rotated_rectangle
        coords = list(rect.exterior.coords)
        longest = max(
            ((coords[i], coords[i + 1]) for i in range(4)),
            key=lambda edge: math.dist(*edge),
        )
        angle = math.degrees(
            math.atan2(longest[1][1] - longest[0][1], longest[1][0] - longest[0][0])
        ) % 180
        duplicate = False
        for existing, _ in kept:
            if poly.intersection(existing).area >= 0.55 * poly.area:
                duplicate = True
                break
            existing_rect = existing.minimum_rotated_rectangle
            existing_coords = list(existing_rect.exterior.coords)
            existing_longest = max(
                ((existing_coords[i], existing_coords[i + 1]) for i in range(4)),
                key=lambda edge: math.dist(*edge),
            )
            existing_angle = math.degrees(
                math.atan2(
                    existing_longest[1][1] - existing_longest[0][1],
                    existing_longest[1][0] - existing_longest[0][0],
                )
            ) % 180
            angle_diff = abs(angle - existing_angle) % 180
            angle_diff = min(angle_diff, 180 - angle_diff)
            if (
                angle_diff <= 5.0
                and poly.intersection(existing.buffer(3.0)).area >= 0.8 * poly.area
            ):
                duplicate = True
                break
        if duplicate:
            continue
        kept.append((poly, length))
    return kept


def _normalize_wall_candidates(candidates: list[tuple[Polygon, float]]) -> list[tuple[Polygon, float]]:
    """Emit one exact rotated rectangle per already-selected wall segment."""
    out: list[tuple[Polygon, float]] = []
    for poly, length in candidates:
        rect = poly.minimum_rotated_rectangle
        if isinstance(rect, Polygon) and rect.is_valid and not rect.is_empty and rect.area > 0:
            out.append((rect, length))
    return out


def _oversized_wall_face_exclusions(
    faces: list[Polygon],
    *,
    exclude_polygons: list[Polygon],
    text_boxes: list[Polygon],
    code_points: list[tuple[float, float]],
    context_segments: list[LineString],
    max_wall_thickness_pt: float,
) -> list[Polygon]:
    """Treat schedule-incompatible thick faces as non-wall fixture regions."""
    probes = extract_wall_faces(
        faces,
        exclude_polygons=exclude_polygons,
        text_boxes=text_boxes,
        code_points=code_points,
        context_segments=context_segments,
        max_thickness_pt=max(72.0, max_wall_thickness_pt * 2.0),
    )
    oversized = []
    for poly, _ in probes:
        rect = poly.minimum_rotated_rectangle
        coords = list(rect.exterior.coords)
        short = min(math.dist(coords[i], coords[i + 1]) for i in range(4))
        if short > max_wall_thickness_pt:
            oversized.append(poly)
    return oversized


def _turn_degrees(points: list[tuple[float, float]]) -> float:
    total = 0.0
    previous = None
    for a, b in zip(points, points[1:], strict=False):
        angle = math.atan2(b[1] - a[1], b[0] - a[0])
        if previous is not None:
            total += abs((angle - previous + math.pi) % (2 * math.pi) - math.pi)
        previous = angle
    return math.degrees(total)


def _nearest_door_mark(
    bbox: tuple[float, float, float, float],
    spans: list[OCRSpan],
    *,
    max_distance_pt: float = 40.0,
    allowed_refs: set[str] | None = None,
) -> OCRSpan | None:
    symbol = shp_box(*bbox)
    hits = []
    for span in spans:
        text = span.text.strip()
        if not DOOR_MARK_RE.match(text) or WALL_CODE_RE.search(text):
            continue
        if allowed_refs is not None and text.upper() not in allowed_refs:
            continue
        cx = (span.bbox[0] + span.bbox[2]) / 2
        cy = (span.bbox[1] + span.bbox[3]) / 2
        dist = symbol.distance(Point(cx, cy))
        if dist <= max_distance_pt:
            hits.append((dist, span))
    return min(hits, key=lambda item: item[0])[1] if hits else None


def _is_alphanumeric_door_mark(text: str) -> bool:
    return any(ch.isalpha() for ch in text) and any(ch.isdigit() for ch in text)


def _has_near_detail_ref(
    bbox: tuple[float, float, float, float],
    spans: list[OCRSpan],
    *,
    max_distance_pt: float = 80.0,
) -> bool:
    symbol = shp_box(*bbox)
    for span in spans:
        text = span.text.strip()
        if not DETAIL_REF_RE.match(text):
            continue
        cx = (span.bbox[0] + span.bbox[2]) / 2
        cy = (span.bbox[1] + span.bbox[3]) / 2
        if symbol.distance(Point(cx, cy)) <= max_distance_pt:
            return True
    return False


def _nearest_extended_door_mark(
    bbox: tuple[float, float, float, float],
    spans: list[OCRSpan],
    normal_refs: set[str],
    *,
    max_distance_pt: float = 175.0,
    allowed_refs: set[str] | None = None,
) -> OCRSpan | None:
    if _has_near_detail_ref(bbox, spans):
        return None
    symbol = shp_box(*bbox)
    hits = []
    for span in spans:
        text = span.text.strip().upper()
        if (
            not DOOR_MARK_RE.match(text)
            or WALL_CODE_RE.search(text)
            or not _is_alphanumeric_door_mark(text)
            or text in normal_refs
            or (allowed_refs is not None and text not in allowed_refs)
        ):
            continue
        cx = (span.bbox[0] + span.bbox[2]) / 2
        cy = (span.bbox[1] + span.bbox[3]) / 2
        dist = symbol.distance(Point(cx, cy))
        if dist <= max_distance_pt:
            hits.append((dist, span))
    return min(hits, key=lambda item: item[0])[1] if hits else None


def _box_excluded(bbox: tuple[float, float, float, float], excluded: list[Polygon]) -> bool:
    if not excluded:
        return False
    poly = shp_box(*bbox)
    point = poly.representative_point()
    return any(ex.covers(point) or ex.intersection(poly).area >= 0.25 * poly.area for ex in excluded)


def _repeated_window_bands(spans: list[OCRSpan]) -> list[Polygon]:
    """Wall-only bands for rows/columns of scheduled exterior windows."""
    marks = [span for span in spans if WINDOW_MARK_RE.fullmatch(span.text.strip())]
    if len(marks) < 3:
        return []
    centers = [
        (
            (span.bbox[0] + span.bbox[2]) / 2,
            (span.bbox[1] + span.bbox[3]) / 2,
            span,
        )
        for span in marks
    ]
    bands: list[Polygon] = []
    used_vertical: set[int] = set()
    for cx, _cy, _ in centers:
        vertical = [(x, y, span) for x, y, span in centers if abs(x - cx) <= 8.0]
        vertical_key = round(sum(x for x, _, _ in vertical) / max(1, len(vertical)))
        if (
            len(vertical) >= 3
            and max(y for _, y, _ in vertical) - min(y for _, y, _ in vertical) >= 100.0
            and vertical_key not in used_vertical
        ):
            used_vertical.add(vertical_key)
            xs = [v for _, _, span in vertical for v in (span.bbox[0], span.bbox[2])]
            ys = [v for _, _, span in vertical for v in (span.bbox[1], span.bbox[3])]
            bands.append(shp_box(min(xs) - 24.0, min(ys) - 24.0, max(xs) + 24.0, max(ys) + 24.0))
    return bands


def _floor_label_faces(
    faces: list[Polygon],
    bbox: tuple[float, float, float, float],
    spans: list[OCRSpan],
) -> list[Polygon]:
    region = shp_box(*bbox)
    chosen: list[Polygon] = []
    seen: set[int] = set()
    for span in spans:
        if not FLOOR_AREA_LABEL_RE.match(span.text.strip()):
            continue
        center = Point((span.bbox[0] + span.bbox[2]) / 2, (span.bbox[1] + span.bbox[3]) / 2)
        if not region.contains(center):
            continue
        containing = [
            face
            for face in faces
            if face.contains(center) and face.intersection(region).area >= 0.35 * face.area
        ]
        if not containing:
            continue
        face = min(containing, key=lambda candidate: candidate.area)
        key = id(face)
        if key in seen:
            continue
        seen.add(key)
        chosen.append(face)
    chosen.sort(key=lambda poly: poly.area, reverse=True)
    return chosen


def _finish_pattern_regions(
    vector_paths: list[VectorPath],
    spans: list[OCRSpan],
) -> list[tuple[str, Polygon, list[str]]]:
    """Match explicit broadloom/runner labels to their native CAD fill rings.

    These regions are already drawn as exact closed fills in many finish plans.
    Using the fill avoids polygonizing pews, hatch strokes, and label knockout
    boxes into fake rooms. Printed-SF plans keep their existing label workflow.
    """
    if any(FLOOR_AREA_LABEL_RE.match(span.text.strip()) for span in spans):
        return []

    labels: list[tuple[str, Polygon, list[str]]] = []
    for span in spans:
        text = " ".join(span.text.split())
        if not (_CARPET_RE.match(text) or _CARPET_RUNNER_RE.match(text)):
            continue
        prior = [
            other for other in spans
            if _BROADLOOM_RE.match(" ".join(other.text.split()))
            and 0.0 <= span.bbox[1] - other.bbox[3] <= 8.0
            and abs(
                (span.bbox[0] + span.bbox[2]) / 2
                - (other.bbox[0] + other.bbox[2]) / 2
            ) <= 32.0
        ]
        if not prior:
            continue
        broadloom = min(prior, key=lambda other: span.bbox[1] - other.bbox[3])
        material = (
            "BROADLOOM CARPET RUNNER"
            if _CARPET_RUNNER_RE.match(text)
            else "BROADLOOM CARPET"
        )
        x0 = min(span.bbox[0], broadloom.bbox[0])
        y0 = min(span.bbox[1], broadloom.bbox[1])
        x1 = max(span.bbox[2], broadloom.bbox[2])
        y1 = max(span.bbox[3], broadloom.bbox[3])
        labels.append((material, shp_box(x0, y0, x1, y1), [broadloom.id, span.id]))

    fill_polys: list[Polygon] = []
    for vp in vector_paths:
        if vp.kind != "fill" or (vp.fill_color or vp.color).lower() != "#ffffff":
            continue
        for sub in vp.points:
            if len(sub) < 4:
                continue
            ring = list(sub)
            if ring[0] != ring[-1]:
                if math.dist(ring[0], ring[-1]) > 1.0:
                    continue
                ring[-1] = ring[0]
            poly = Polygon(ring)
            if poly.is_valid and 5_000.0 <= poly.area <= 250_000.0:
                fill_polys.append(poly)

    used: set[int] = set()
    out: list[tuple[str, Polygon, list[str]]] = []
    for material, label_box, span_ids in labels:
        candidates = []
        for idx, poly in enumerate(fill_polys):
            if idx in used:
                continue
            x0, y0, x1, y1 = poly.bounds
            aspect = max(x1 - x0, y1 - y0) / max(1.0, min(x1 - x0, y1 - y0))
            if material.endswith("RUNNER") and aspect < 3.0:
                continue
            if material == "BROADLOOM CARPET" and aspect >= 3.0:
                continue
            distance = poly.distance(label_box)
            if distance <= 120.0:
                candidates.append((distance, idx, poly))
        if not candidates:
            continue
        _, idx, poly = min(candidates, key=lambda item: (item[0], item[2].area))
        used.add(idx)
        out.append((material, poly, span_ids))
    return out


def _finish_tag_detections(sheet_id: str, spans: list[OCRSpan]) -> list[DetectedObject]:
    detections: list[DetectedObject] = []
    for floor_span in spans:
        if " ".join(floor_span.text.upper().split()) != "FLOORING:":
            continue
        materials = [
            span for span in spans
            if 0.0 <= span.bbox[0] - floor_span.bbox[2] <= 120.0
            and abs(span.bbox[1] - floor_span.bbox[1]) <= 3.0
            and re.search(r"[A-Za-z]", span.text)
        ]
        if not materials:
            continue
        material = min(materials, key=lambda span: span.bbox[0])
        detections.append(DetectedObject(
            sheet_id=sheet_id,
            label="finish_tag",
            bbox=(
                float(floor_span.bbox[0]),
                float(min(floor_span.bbox[1], material.bbox[1])),
                float(material.bbox[2]),
                float(max(floor_span.bbox[3], material.bbox[3])),
            ),
            confidence=0.99,
            detector="vector_finish_tag",
            matched_ocr_span_ids=[floor_span.id, material.id],
            material_ref=" ".join(material.text.upper().split()),
        ))
    return detections


def _clip_floor_parts(
    parts: list[Polygon],
    cut_polys: list[Polygon],
    *,
    min_area_pt2: float = 5_000.0,
) -> list[Polygon]:
    if not cut_polys:
        return [part for part in parts if part.area >= min_area_pt2]
    cutter = unary_union(cut_polys)
    out: list[Polygon] = []
    for part in parts:
        clipped = part.difference(cutter).buffer(0)
        if clipped.is_empty:
            continue
        if isinstance(clipped, Polygon):
            if clipped.area >= min_area_pt2:
                out.append(clipped)
            continue
        if clipped.geom_type == "MultiPolygon":
            out.extend(poly for poly in clipped.geoms if isinstance(poly, Polygon) and poly.area >= min_area_pt2)
    out.sort(key=lambda poly: poly.area, reverse=True)
    return out


def _overlaps_detection(bbox: tuple[float, float, float, float], detections: list[DetectedObject], label: str) -> bool:
    poly = shp_box(*bbox)
    for det in detections:
        if det.label != label:
            continue
        other = shp_box(*det.bbox)
        if poly.intersection(other).area >= 0.35 * min(poly.area, other.area):
            return True
    return False


def _vector_door_detections(
    *,
    sheet_id: str,
    vector_paths: list[VectorPath],
    spans: list[OCRSpan],
    drawing_boxes: list[tuple[float, float, float, float]],
    excluded_polys: list[Polygon],
    door_schedule: dict[str, dict] | None = None,
    include_existing: bool = False,
) -> list[DetectedObject]:
    """Detect door leaves from CAD swing arcs, anchored to nearby door marks."""
    schedule = door_schedule or {}
    allowed_refs = set(schedule) if schedule else None
    existing_refs = {
        ref for ref, row in schedule.items()
        if not include_existing and isinstance(row, dict) and row.get("existing") is True
    }
    top_limit = None
    if drawing_boxes:
        y0 = min(box[1] for box in drawing_boxes)
        y1 = max(box[3] for box in drawing_boxes)
        if y1 - y0 > 200:
            top_limit = y0 + 90.0

    detections: list[DetectedObject] = []
    candidates: list[tuple[float, float, float, float]] = []
    for vp in vector_paths:
        if vp.dashes or (vp.color and vp.color.lower() != "#000000"):
            continue
        for sub in vp.points:
            if len(sub) < 3:
                continue
            x0 = min(x for x, _ in sub)
            y0 = min(y for _, y in sub)
            x1 = max(x for x, _ in sub)
            y1 = max(y for _, y in sub)
            width, height = x1 - x0, y1 - y0
            if top_limit is not None and y0 < top_limit:
                continue
            if not (18.0 <= max(width, height) <= 70.0 and 10.0 <= min(width, height) <= 55.0):
                continue
            line = LineString(sub)
            chord = math.dist(sub[0], sub[-1])
            if chord <= 0:
                continue
            if _turn_degrees(sub) < 55.0 or line.length / chord <= 1.06:
                continue
            bbox = (x0, y0, x1, y1)
            if not schedule and _box_excluded(bbox, excluded_polys):
                continue
            if any(abs(bbox[0] - b[0]) < 1 and abs(bbox[1] - b[1]) < 1 and abs(bbox[2] - b[2]) < 1 and abs(bbox[3] - b[3]) < 1 for b in candidates):
                continue
            candidates.append(bbox)

    used: set[int] = set()
    normal_refs: set[str] = set()

    def add_detection(bbox: tuple[float, float, float, float], mark: OCRSpan):
        ref = mark.text.strip().upper()
        detections.append(
            DetectedObject(
                sheet_id=sheet_id,
                label="door",
                bbox=bbox,
                confidence=0.82,
                detector="vector_heuristic",
                matched_ocr_span_ids=[mark.id],
                schedule_ref=ref,
            )
        )

    for idx, bbox in enumerate(candidates):
        mark = _nearest_door_mark(bbox, spans, allowed_refs=allowed_refs)
        if mark is None:
            continue
        if mark.text.strip().upper() in existing_refs:
            continue
        used.add(idx)
        normal_refs.add(mark.text.strip().upper())
        add_detection(bbox, mark)

    extended_counts: dict[str, int] = {}
    for idx, bbox in enumerate(candidates):
        if idx in used:
            continue
        width, height = bbox[2] - bbox[0], bbox[3] - bbox[1]
        if min(width, height) < 21.0 or max(width, height) < 38.0:
            continue
        mark = _nearest_extended_door_mark(
            bbox,
            spans,
            normal_refs,
            allowed_refs=allowed_refs,
        )
        if mark is None:
            continue
        ref = mark.text.strip().upper()
        if ref in existing_refs:
            continue
        if extended_counts.get(ref, 0) >= 2:
            continue
        extended_counts[ref] = extended_counts.get(ref, 0) + 1
        add_detection(bbox, mark)

    if not schedule:
        return detections

    # A double door has two swing leaves but one scheduled opening. Merge all
    # leaves tied to the same mark so EA follows the door schedule, not arc count.
    merged: list[DetectedObject] = []
    grouped: dict[str, list[DetectedObject]] = {}
    for detection in detections:
        grouped.setdefault(detection.schedule_ref, []).append(detection)
    for ref, group in grouped.items():
        merged.append(
            DetectedObject(
                sheet_id=sheet_id,
                label="door",
                bbox=(
                    min(d.bbox[0] for d in group),
                    min(d.bbox[1] for d in group),
                    max(d.bbox[2] for d in group),
                    max(d.bbox[3] for d in group),
                ),
                confidence=max(d.confidence for d in group),
                detector="vector_schedule_heuristic",
                matched_ocr_span_ids=list(dict.fromkeys(
                    span_id for d in group for span_id in d.matched_ocr_span_ids
                )),
                schedule_ref=ref,
            )
        )

    # Fixed panels, operable partitions, and doors drawn without a swing arc
    # still have authoritative plan marks. Add one evidence box for any schedule
    # mark not represented by the vector arcs, choosing the smallest matching
    # plan text span to avoid confusing larger room-number labels for door tags.
    represented = {d.schedule_ref for d in merged}
    for ref in sorted(set(schedule) - represented - existing_refs):
        mark_spans = []
        for span in spans:
            if span.text.strip().upper() != ref:
                continue
            if drawing_boxes and not any(_center_in_box(span.bbox, box) for box in drawing_boxes):
                continue
            if not schedule and _box_excluded(span.bbox, excluded_polys):
                continue
            mark_spans.append(span)
        if not mark_spans:
            continue
        mark = min(
            mark_spans,
            key=lambda span: (
                (span.bbox[2] - span.bbox[0]) * (span.bbox[3] - span.bbox[1]),
                span.bbox[1],
                span.bbox[0],
            ),
        )
        x0, y0, x1, y1 = mark.bbox
        merged.append(
            DetectedObject(
                sheet_id=sheet_id,
                label="door",
                bbox=(x0 - 3.0, y0 - 3.0, x1 + 3.0, y1 + 3.0),
                confidence=0.9,
                detector="schedule_mark_heuristic",
                matched_ocr_span_ids=[mark.id],
                schedule_ref=ref,
            )
        )
    return merged


def _linework_length_inside(
    vector_paths: list[VectorPath],
    drawing_boxes: list[tuple[float, float, float, float]],
    exclusion_boxes: list[tuple[float, float, float, float]],
) -> float:
    total = 0.0
    for vp in vector_paths:
        if vp.dashes:
            continue
        cx = (vp.bbox[0] + vp.bbox[2]) / 2
        cy = (vp.bbox[1] + vp.bbox[3]) / 2
        if drawing_boxes and not any(
            x0 <= cx <= x1 and y0 <= cy <= y1 for x0, y0, x1, y1 in drawing_boxes
        ):
            continue
        if any(x0 <= cx <= x1 and y0 <= cy <= y1 for x0, y0, x1, y1 in exclusion_boxes):
            continue
        total += sum(
            math.dist(a, b) for sub in vp.points for a, b in zip(sub, sub[1:], strict=False)
        )
    return total


def run_candidates(
    image: np.ndarray,
    sheet_id: str,
    px_per_pt: float,
    detector: DetectorAdapter,
    segmenter: SegmenterAdapter,
    geometry: GeometryEngine,
    vector_paths: list[VectorPath] | None = None,
    ocr_spans: list[OCRSpan] | None = None,
    include_existing: bool = False,
    requested_trades: set[str] | None = None,
    door_schedule: dict[str, dict] | None = None,
    max_wall_thickness_pt: float = 36.0,
    min_wall_thickness_pt: float = 2.2,
    wall_types: dict[str, dict] | None = None,
) -> tuple[list[DetectedObject], list[SegmentationMask], list[PolygonGeometry], list[ExclusionRegion]]:
    detections = _semantic_filter(detector.detect(image, sheet_id, px_per_pt, SEMANTIC_VOCAB))
    drawing_boxes = [d.bbox for d in detections if d.label in DRAWING_LABELS]
    # An open-vocab detector on a CAD sheet emits low-confidence mislabeled
    # regions; a bogus notes/legend/schedule box over the plan would silently
    # veto the vector linework that walls are measured from. Only confident
    # model exclusions participate, and never ones that would wipe the drawing.
    model_exclusion_boxes = [
        d.bbox for d in detections if d.label in EXCLUSION_LABELS and d.confidence >= 0.5
    ]
    metadata_boxes = detect_metadata_boxes(vector_paths or [], ocr_spans or [])
    page_w, page_h = _page_bounds(vector_paths or [], ocr_spans or [])
    exclusion_boxes = list(_expand_boxes(metadata_boxes, page_w, page_h))
    # Titled legend/key/notes panels redraw wall and door samples at true
    # style — nothing inside them may ever become a candidate or a tag.
    exclusion_boxes.extend(detect_legend_boxes(vector_paths or [], ocr_spans or []))
    if model_exclusion_boxes and vector_paths:
        baseline = _linework_length_inside(vector_paths, drawing_boxes, exclusion_boxes)
        with_model = _linework_length_inside(
            vector_paths, drawing_boxes, exclusion_boxes + model_exclusion_boxes
        )
        if baseline <= 0 or with_model >= baseline * 0.5:
            exclusion_boxes.extend(model_exclusion_boxes)
    elif model_exclusion_boxes:
        exclusion_boxes.extend(model_exclusion_boxes)
    deterministic_boxes: list[tuple[float, float, float, float]] = []
    if not include_existing:
        deterministic_boxes = (
            _trade_drawing_boxes(ocr_spans or [], page_w, page_h, requested_trades)
            or _new_work_drawing_boxes(ocr_spans or [], page_w, page_h)
        )
        drawing_boxes = _combine_drawing_boxes(
            drawing_boxes,
            deterministic_boxes,
        )
    detections = _final_drawing_filter(detections, drawing_boxes, exclusion_boxes)
    if requested_trades and "flooring" in requested_trades and deterministic_boxes:
        detections = [d for d in detections if d.label not in AREA_LABELS]
    all_tag_spans = find_tag_spans(
        ocr_spans or [], WALL_CODE_RE, lexicon=wall_types, vector_paths=vector_paths
    )
    tag_spans = [
        (code, span) for code, span in all_tag_spans
        if not any(_center_in_box(span.bbox, ex) for ex in exclusion_boxes)
        and (not drawing_boxes or any(_center_in_box(span.bbox, box) for box in drawing_boxes))
    ]
    code_points = [
        ((span.bbox[0] + span.bbox[2]) / 2, (span.bbox[1] + span.bbox[3]) / 2)
        for _, span in tag_spans
    ]
    measurement_paths = filter_measurement_paths(
        vector_paths or [],
        drawing_boxes=drawing_boxes,
        exclusion_boxes=exclusion_boxes,
    )
    area_dets = [d for d in detections if d.label in AREA_LABELS]

    # Exact enclosed faces from the CAD linework (empty on raster-only sheets).
    faces = polygonize_faces(measurement_paths)
    context_segments = wall_context_segments(measurement_paths, include_gray=bool(code_points))
    text_boxes = [
        shp_box(*span.bbox)
        for span in (ocr_spans or [])
        if not WALL_CODE_RE.search(span.text)
    ]
    compact_shapes = detect_columns(measurement_paths, text_boxes=text_boxes)
    column_shapes = detect_columns(
        measurement_paths,
        text_boxes=text_boxes,
        require_structural_evidence=True,
    )
    column_polys = [poly for _, poly in column_shapes]
    # Rejected compact symbols are not columns, but their little boxes/circles
    # are also not wall segments. Keep the full compact set as a wall-only
    # exclusion while subtracting only structurally supported columns from
    # floors and emitting only those columns as EA.
    compact_polys = [poly for _, poly in compact_shapes]
    repeated_window_bands = _repeated_window_bands(ocr_spans or [])
    exclusions = [] if include_existing else detect_exclusion_regions(
        sheet_id=sheet_id,
        vector_paths=vector_paths or [],
        spans=ocr_spans or [],
        faces=faces,
        exclude_black_hatch=not (requested_trades is not None and requested_trades <= {"flooring"}),
    )
    excluded_polys = exclusion_polygons(exclusions)
    # With no wall tags to focus candidates, give existing/ETR regions a small
    # wall-only cushion so border strokes do not become new-wall rectangles.
    wall_excluded_polys = excluded_polys if code_points else [poly.buffer(4.0) for poly in excluded_polys]
    if door_schedule and requested_trades and "doors" in requested_trades:
        detections = [d for d in detections if d.label != "door"]
    door_measurement_paths = measurement_paths
    if requested_trades and "doors" in requested_trades:
        door_measurement_paths = filter_measurement_paths(
            vector_paths or [],
            drawing_boxes=drawing_boxes,
            exclusion_boxes=_clip_exclusion_boxes_to_drawing(exclusion_boxes, drawing_boxes),
        )
    countable_door_detections = _vector_door_detections(
        sheet_id=sheet_id,
        vector_paths=door_measurement_paths,
        spans=ocr_spans or [],
        drawing_boxes=drawing_boxes,
        excluded_polys=excluded_polys,
        door_schedule=door_schedule,
        include_existing=include_existing,
    )
    # Wall reconstruction needs every visible opening, while the door EA
    # takeoff may intentionally contain only new/scheduled marks. Keeping these
    # two sets separate makes wall LF invariant when the doors trade is added
    # to an otherwise identical scope.
    wall_opening_detections = countable_door_detections
    if requested_trades and "walls" in requested_trades and door_schedule:
        wall_opening_detections = _vector_door_detections(
            sheet_id=sheet_id,
            vector_paths=door_measurement_paths,
            spans=ocr_spans or [],
            drawing_boxes=drawing_boxes,
            excluded_polys=excluded_polys,
            door_schedule=None,
            include_existing=include_existing,
        )
    for det in countable_door_detections:
        if not _overlaps_detection(det.bbox, detections, "door"):
            detections.append(det)
    if requested_trades and "flooring" in requested_trades:
        for det in _finish_tag_detections(sheet_id, ocr_spans or []):
            if exclusion_boxes and any(_center_in_box(det.bbox, box) for box in exclusion_boxes):
                continue
            if drawing_boxes and not any(_center_in_box(det.bbox, box) for box in drawing_boxes):
                continue
            detections.append(det)
    if faces and not area_dets:
        bounds = drawing_boxes[0] if drawing_boxes else tuple(float(v) for v in faces[0].bounds)
        inferred = DetectedObject(
            sheet_id=sheet_id,
            label="floor_area",
            bbox=bounds,
            confidence=0.82 if deterministic_boxes else 0.55,
            detector="vector_heuristic",
        )
        detections.append(inferred)
        area_dets = [inferred]

    # Segment every area box for the raster fallback (and as an audit artifact).
    masks = segmenter.segment(image, sheet_id, px_per_pt, [d.bbox for d in area_dets])
    mask_by_box = {m.source_box_index: m for m in masks}

    geometries: list[PolygonGeometry] = []
    for shape, poly in column_shapes:
        exterior, holes = polygon_to_rings(poly)
        det = DetectedObject(
            sheet_id=sheet_id,
            label=f"{shape}_column",
            bbox=tuple(float(v) for v in poly.bounds),
            confidence=0.9,
            detector="vector_heuristic",
        )
        detections.append(det)
        geometries.append(
            geometry.build_polygon(
                sheet_id=sheet_id,
                exterior=exterior,
                holes=holes,
                derived_from=[det.id],
                refinement=f"vector {shape} column footprint",
                boundary_source="vector",
            )
        )

    # Finish patterns are explicit, closed CAD regions. Emit them directly;
    # they are not room detections and must not be replaced by the tiny white
    # label background that happens to contain their OCR text.
    pattern_cuts = exclusion_polygons(
        [e for e in exclusions if e.reason in {"etr_text", "gray_fill", "hatch_fill"}]
    )
    for material, pattern_poly, span_ids in _finish_pattern_regions(
        measurement_paths,
        ocr_spans or [],
    ):
        clipped = pattern_poly
        if column_polys:
            clipped = clipped.difference(unary_union(column_polys)).buffer(0)
        if pattern_cuts:
            clipped = clipped.difference(unary_union(pattern_cuts)).buffer(0)
        parts = [clipped] if isinstance(clipped, Polygon) else [
            part for part in getattr(clipped, "geoms", []) if isinstance(part, Polygon)
        ]
        for part in parts:
            if part.is_empty or part.area < 5_000.0:
                continue
            exterior, holes = polygon_to_rings(part)
            det = DetectedObject(
                sheet_id=sheet_id,
                label="floor_area",
                bbox=tuple(float(v) for v in part.bounds),
                confidence=0.98,
                detector="vector_finish_pattern",
                matched_ocr_span_ids=span_ids,
                material_ref=material,
            )
            detections.append(det)
            geometries.append(
                geometry.build_polygon(
                    sheet_id=sheet_id,
                    exterior=exterior,
                    holes=holes,
                    derived_from=[det.id],
                    refinement=f"vector {material.lower()} footprint (exact)",
                    boundary_source="vector",
                )
            )

    base_wall_exclusions = compact_polys + repeated_window_bands + wall_excluded_polys
    fixture_exclusions = _oversized_wall_face_exclusions(
        faces,
        exclude_polygons=base_wall_exclusions,
        text_boxes=text_boxes,
        code_points=code_points,
        context_segments=context_segments,
        max_wall_thickness_pt=max_wall_thickness_pt,
    )
    wall_candidate_exclusions = base_wall_exclusions + fixture_exclusions
    # Existing gray poché bands: a lone new face line running along one is a
    # furred wall (there is no second face line to pair with).
    poche_polys = exclusion_polygons(
        [e for e in exclusions if e.reason in {"gray_fill", "shaded_existing_wall"}]
    )
    # A wall-type tag's leader landing ON a gray band overrides "gray means
    # existing" for that band: it is a scheduled NEW wall drawn pochéd.
    anchors = tag_anchors(tag_spans, measurement_paths)
    anchor_points = [pt for _, _, pt in anchors]
    tagged_wall_polys = []
    kept_poche = []
    for poly in poche_polys:
        # exact containment only — an anchor that merely grazes the band's
        # edge belongs to the adjacent (new) wall, not to the band — and the
        # poly must be wall-band shaped (a leader crossing a column square
        # must not rescue the column)
        x0, y0, x1, y1 = poly.bounds
        aspect = max(x1 - x0, y1 - y0) / max(1.0, min(x1 - x0, y1 - y0))
        if aspect >= 2.0 and any(poly.covers(Point(x, y)) for x, y in anchor_points):
            tagged_wall_polys.append(poly)
        else:
            kept_poche.append(poly)
    poche_polys = kept_poche
    if tagged_wall_polys:
        tagged_bounds = {tuple(round(v, 1) for v in p.bounds) for p in tagged_wall_polys}
        exclusions = [
            e for e in exclusions
            if not (
                e.reason in {"gray_fill", "shaded_existing_wall"}
                and tuple(round(v, 1) for v in e.bbox) in tagged_bounds
            )
        ]
        excluded_polys = exclusion_polygons(exclusions)
        wall_excluded_polys = excluded_polys if code_points else [p.buffer(4.0) for p in excluded_polys]
        wall_candidate_exclusions = (
            compact_polys
            + repeated_window_bands
            + wall_excluded_polys
            + fixture_exclusions
        )
    door_boxes = [d.bbox for d in wall_opening_detections]
    wall_strips = extract_wall_strips(
        measurement_paths,
        faces,
        exclude_polygons=wall_candidate_exclusions
        + existing_wall_bands(poche_polys, tag_points=anchor_points + code_points),
        poche_polygons=poche_polys,
        text_boxes=text_boxes,
        door_boxes=door_boxes,
        min_thickness_pt=min_wall_thickness_pt,
        max_thickness_pt=max_wall_thickness_pt,
        tagged_wall_polys=tagged_wall_polys,
    )
    for strip in wall_strips:
        exterior, holes = polygon_to_rings(strip.poly)
        det = DetectedObject(
            sheet_id=sheet_id,
            label="wall",
            bbox=tuple(float(v) for v in strip.poly.bounds),
            confidence=0.75,
            detector="vector_heuristic",
        )
        detections.append(det)
        bridged = (
            f", {strip.bridged_openings} opening(s) bridged {strip.bridged_pt:.0f}pt"
            if strip.bridged_openings
            else ""
        )
        geom = geometry.build_polygon(
            sheet_id=sheet_id,
            exterior=exterior,
            holes=holes,
            derived_from=[det.id],
            refinement=f"vector wall run ({strip.source}, {strip.thickness_pt:.1f}pt thick{bridged})",
            boundary_source="vector",
        )
        geom.length_pt = strip.length_pt
        geometries.append(geom)

    for i, det in enumerate(area_dets):
        floor_parts = []
        if requested_trades and requested_trades <= {"flooring"} and det.detector == "vector_heuristic":
            label_faces = _floor_label_faces(faces, det.bbox, ocr_spans or []) if faces else []
            if label_faces:
                floor_parts = _clip_floor_parts(label_faces, column_polys + excluded_polys)
        if not floor_parts and (det.label in {"room", "floor_area"} or (det.label == "slab" and excluded_polys)):
            floor_parts = (
                floor_polygons_for_detection(faces, det.bbox, column_polys, excluded_polys)
                if faces else []
            )
            face = floor_parts[0] if len(floor_parts) == 1 else None
        else:
            face = face_for_detection(faces, det.bbox, det.label) if faces else None
        if len(floor_parts) > 1 and det.detector == "vector_heuristic":
            for part in floor_parts:
                exterior, holes = polygon_to_rings(part)
                geom = geometry.build_polygon(
                    sheet_id=sheet_id,
                    exterior=exterior,
                    holes=holes,
                    derived_from=[det.id],
                    refinement="vector linework floor face (exact)",
                    boundary_source="vector",
                )
                geometries.append(geom)
            continue
        if len(floor_parts) > 1:
            face = floor_parts[0]
        if face is not None and face.area > 0:
            exterior, holes = polygon_to_rings(face)
            geom = geometry.build_polygon(
                sheet_id=sheet_id,
                exterior=exterior,
                holes=holes,
                derived_from=[det.id],
                refinement="vector linework face (exact)",
                boundary_source="vector",
            )
            geometries.append(geom)
            continue

        # No linework here → fall back to the neural mask (approximate).
        mask = mask_by_box.get(i)
        if mask is None or not mask.polygons:
            continue
        mask.detected_object_id = det.id
        ring = max(mask.polygons, key=_ring_area)
        holes = []
        if det.label in {"room", "floor_area", "slab"} and (excluded_polys or column_polys):
            mask_poly = Polygon(ring)
            if mask_poly.is_valid and not mask_poly.is_empty:
                clipped = mask_poly.difference(unary_union(excluded_polys + column_polys)).buffer(0)
                if clipped.is_empty:
                    continue
                if clipped.geom_type == "MultiPolygon":
                    clipped = max(clipped.geoms, key=lambda p: p.area)
                if isinstance(clipped, Polygon):
                    ring, holes = polygon_to_rings(clipped)
        geom = geometry.build_polygon(
            sheet_id=sheet_id,
            exterior=ring,
            holes=holes,
            derived_from=[det.id, mask.id],
            refinement=f"{mask.segmenter} mask → largest contour (approximate)",
            boundary_source="mask",
        )
        geometries.append(geom)
    return detections, masks, geometries, exclusions


def _ring_area(ring: list[tuple[float, float]]) -> float:
    # Shoelace, absolute — cheap ranking without building Shapely objects.
    n = len(ring)
    if n < 3:
        return 0.0
    s = 0.0
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0
