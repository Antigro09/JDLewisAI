"""Pipeline orchestrator.

Runs the stage sequence per sheet and persists every intermediate artifact,
so any quantity can be traced: quantity → geometry → mask/detection →
raster/vector/OCR spans → sheet → file. Stage order:

  ingest → OCR/layout → classify → scale → candidates → measure →
  confidence flags → VLM audit → rollup → persist

`process_project_job(project_id)` is a module-level function so both the
local thread queue and RQ can run it.
"""

from __future__ import annotations

import hashlib
import logging
import math
import re
from datetime import UTC, datetime

import cv2
from shapely.geometry import LineString, Point, Polygon

from app.adapters.base import build_adapters
from app.config import get_settings
from app.db.database import session_scope
from app.db.orm import ArtifactRow, FileRow, JobRow, ProjectRow, QuantityRow, SheetRow
from app.geometry.engine import GeometryEngine
from app.geometry.exclusions import exclusion_polygons
from app.geometry.walls import extend_rect_bands
from app.ingestion.pdf_pymupdf import PyMuPDFIngestor
from app.ingestion.tiff import TiffIngestor
from app.pipeline import vlm_audit as audit
from app.pipeline.candidates import COUNT_LABELS, run_candidates
from app.pipeline.confidence import finalize_item
from app.pipeline.measure import (
    count_symbols,
    measure_area_item,
    measure_column_item,
    measure_length_item,
)
from app.pipeline.rollup import rollup_items
from app.pipeline.scale_calibration import resolve_scale
from app.pipeline.sheet_classify import classify_sheet
from app.pipeline.wall_tags import find_tag_spans, tag_anchors
from app.schemas.confidence import ConfidenceBundle, ReviewReason
from app.schemas.core import SheetType
from app.schemas.detection import ExclusionRegion
from app.schemas.ocr import OCRSpan
from app.schemas.quantity import OverlayStyle, QuantityItem
from app.schemas.scale import ScaleCalibration, ScaleSource
from app.schemas.takeoff_scope import TakeoffScope, scope_from_payload
from app.storage.local import LocalStorage

log = logging.getLogger(__name__)

# detection label → quantity item type
ITEM_TYPE_BY_LABEL = {
    "slab": "concrete_slab",
    "room": "flooring",
    "floor_area": "flooring",
    "wall": "wall",
    "square_column": "column",
    "round_column": "column",
    "column": "column",
    "door": "door",
    "window": "window",
}

_WALL_CODE_RE = re.compile(r"\b[A-Z]\d(?:-\d+){2,}\b", re.IGNORECASE)
_WINDOW_MARK_RE = re.compile(r"^W\d{1,3}$", re.IGNORECASE)
# Distinct hues so each wall type reads at a glance in the overlay.
_WALL_PALETTE = (
    "#0f766e",  # teal
    "#dc2626",  # red
    "#2563eb",  # blue
    "#d97706",  # amber
    "#7c3aed",  # violet
    "#16a34a",  # green
    "#db2777",  # pink
    "#0891b2",  # cyan
    "#854d0e",  # brown
    "#4f46e5",  # indigo
)


def _wall_overlay_style(code: str, wall_types: dict):
    """Stable color per wall type: catalog codes take palette slots in sorted
    order (same colors every run); ad-hoc codes hash into the palette."""
    from app.schemas.quantity import OverlayStyle

    known = sorted(
        c for c, row in wall_types.items()
        if isinstance(row, dict) and row.get("existing") is not True
    )
    if code in known:
        color = _WALL_PALETTE[known.index(code) % len(_WALL_PALETTE)]
    else:
        color = _WALL_PALETTE[hash(code) % len(_WALL_PALETTE)]
    return OverlayStyle(stroke=color, fill=f"{color}33")
# Short boxed tags (A, B1, X2 ...) used by sets that key walls to a WALL TYPES
# schedule. Only harvested from schedule sheets whose row text looks like a
# wall assembly, then matched on plans against their little tag box.
_SHORT_WALL_CODE_RE = re.compile(r"^[A-Z]\d{0,2}$")
_WALL_TYPES_HEADING_RE = re.compile(
    r"^(?:(?:INTERIOR|EXTERIOR)\s+)?WALL\s+TYPES?(?:\s+SCHEDULE)?$",
    re.IGNORECASE,
)
_WALL_ROW_KEYWORDS = ("STUD", "GWB", "PARTITION", "WALL", "CMU", "BRICK", "PLASTER", "FURR", "CHASE")
_EXISTING_DETAIL_RE = re.compile(r"\b(?:EXISTING|HISTORIC)\b", re.IGNORECASE)
# stud/masonry sizes a wall schedule can plausibly call out, in inches
_PLAUSIBLE_WALL_SIZES_IN = (2.5, 3.5, 3.625, 4.0, 5.5, 6.0, 7.25, 8.0, 12.0)
_DOOR_SCHEDULE_MARK_RE = re.compile(r"^\d{3}[A-Z]?$", re.IGNORECASE)
_INCH_RE = re.compile(
    r"(?P<whole>\d+(?:\.\d+)?)?(?:\s+|\s*-\s*)?(?:(?P<num>\d+)\s*/\s*(?P<den>\d+))?\s*(?:\"|IN\b)?",
    re.IGNORECASE,
)
_SF_LABEL_RE = re.compile(r"\b(?P<area>\d{1,4}(?:,\d{3})?)\s*SF\b", re.IGNORECASE)
_ROOM_AREA_RE = re.compile(
    r"\b(?P<area>\d{1,3}(?:,\d{3})*)\s*(?:SQ\.?\s*FT\.?|SF)\b",
    re.IGNORECASE,
)
_ROOM_NAME_IGNORE_RE = re.compile(
    r"\b(?:GROSS|TOTAL|SCALE|OCCUPANCY|FLOORING|PLAN|DETAIL|SECTION|ELEVATION)\b",
    re.IGNORECASE,
)
_GEOMETRIC_TAKEOFF_SHEET_TYPES = {
    SheetType.ARCHITECTURAL_PLAN,
    SheetType.STRUCTURAL_PLAN,
    SheetType.FINISH_PLAN,
}


def _stable_id(*parts) -> str:
    """Content-derived id so re-processing the same page upserts existing rows
    instead of minting fresh ones (which would double-count on every re-run)."""
    return hashlib.sha1("::".join(str(p) for p in parts).encode()).hexdigest()[:32]


def _nearest_label(label_dets, engine, g):
    """Nearest room_label detection to a polygon (for LABEL_FAR_FROM_POLYGON)."""
    if not label_dets:
        return None
    return min(label_dets, key=lambda d: engine.label_distance_pt(d.bbox, g))


def _trade_for_item(item_type: str, label: str) -> str:
    if item_type == "wall":
        return "walls"
    if item_type == "door" or label == "door":
        return "doors"
    if item_type in {"flooring", "concrete_slab"}:
        return "flooring"
    if item_type == "column":
        return "columns"
    return item_type


def _polygon_for_geometry(geom) -> Polygon | None:
    if geom.kind != "polygon" or len(geom.exterior) < 3:
        return None
    poly = Polygon(geom.exterior, geom.holes)
    if not poly.is_valid:
        poly = poly.buffer(0)
    return poly if isinstance(poly, Polygon) and not poly.is_empty else None


def _geometry_is_excluded(geom, excluded_polys: list[Polygon]) -> bool:
    if not excluded_polys:
        return False
    poly = _polygon_for_geometry(geom)
    if poly is None:
        return False
    probe = poly.representative_point()
    if any(excluded.contains(probe) or excluded.covers(probe) for excluded in excluded_polys):
        return True
    return any(poly.intersection(excluded).area >= poly.area * 0.5 for excluded in excluded_polys)


def _wall_is_annotation_or_window_frame(
    geom,
    spans: list[OCRSpan],
    attribution_basis: str,
) -> bool:
    """Reject only weakly attributed label backdrops/window-frame slivers."""
    if attribution_basis not in {"typical_size", "untyped"}:
        return False
    poly = _polygon_for_geometry(geom)
    if poly is None or poly.area <= 0:
        return False
    for span in spans:
        text = span.text.strip()
        center = Point((span.bbox[0] + span.bbox[2]) / 2, (span.bbox[1] + span.bbox[3]) / 2)
        if _WINDOW_MARK_RE.fullmatch(text) and poly.distance(center) <= 60.0:
            return True
        if attribution_basis != "untyped" or _WALL_CODE_RE.search(text):
            continue
        text_box = Polygon([
            (span.bbox[0] - 1.0, span.bbox[1] - 1.0),
            (span.bbox[2] + 1.0, span.bbox[1] - 1.0),
            (span.bbox[2] + 1.0, span.bbox[3] + 1.0),
            (span.bbox[0] - 1.0, span.bbox[3] + 1.0),
        ])
        if poly.intersection(text_box).area >= 0.05 * poly.area:
            return True
    return False


def _floor_area_label_total(spans: list[OCRSpan], detections) -> tuple[float, list[str]] | None:
    area_boxes = [
        det.bbox for det in detections
        if det.label in {"floor_area", "room"} and det.detector == "vector_heuristic"
    ]
    if not area_boxes:
        return None
    ids: list[str] = []
    total = 0.0
    for span in spans:
        match = _SF_LABEL_RE.search(span.text)
        if not match:
            continue
        cx = (span.bbox[0] + span.bbox[2]) / 2
        cy = (span.bbox[1] + span.bbox[3]) / 2
        if not any(x0 <= cx <= x1 and y0 <= cy <= y1 for x0, y0, x1, y1 in area_boxes):
            continue
        total += float(match.group("area").replace(",", ""))
        ids.append(span.id)
    return (total, ids) if ids else None


def _apply_floor_area_label_total(items, spans: list[OCRSpan], detections, sheet_type: SheetType) -> None:
    if sheet_type != SheetType.FINISH_PLAN:
        return
    label_total = _floor_area_label_total(spans, detections)
    if label_total is None:
        return
    total, span_ids = label_total
    if total <= 0:
        return
    for item in items:
        if item.item_type != "flooring":
            continue
        item.quantity = round(total, 1)
        item.formula = f"SF = sum of {len(span_ids)} printed room area labels on finish plan = {total:.1f}"
        item.source_ocr_span_ids = sorted({*item.source_ocr_span_ids, *span_ids})
        item.attributes["area_source"] = "printed_room_area_labels"
        item.attributes["label_area_count"] = len(span_ids)
        item.measurement_confidence = max(item.measurement_confidence, 0.95)
        item.confidence.geometry = max(item.confidence.geometry, 0.95)


def _floor_level(text: str) -> str:
    upper = " ".join(text.upper().split())
    for level, patterns in (
        ("basement", ("BASEMENT", "LOWER LEVEL")),
        ("first", ("FIRST FLOOR", "LEVEL 1")),
        ("second", ("SECOND FLOOR", "LEVEL 2")),
        ("third", ("THIRD FLOOR", "LEVEL 3")),
    ):
        if any(pattern in upper for pattern in patterns):
            return level
    return ""


def _room_tokens(text: str) -> set[str]:
    normalized = re.sub(r"[^A-Z0-9]+", " ", text.upper().replace("'S", "S"))
    return {token for token in normalized.split() if len(token) > 1}


def _is_room_name_span(text: str) -> bool:
    upper = " ".join(text.upper().split())
    if not upper or not re.search(r"[A-Z]", upper):
        return False
    if upper in {"DN", "UP", "N", "S", "E", "W", "WOOD", "TILE", "VCT", "CARPET"}:
        return False
    if re.fullmatch(r"(?:[A-Z]\d{0,3}|W\d{1,3}|X\d{1,3})", upper):
        return False
    return True


def _room_area_entries(sheet_spans: list[dict], sheet, text: str) -> list[dict]:
    """Printed room areas from plan labels, retained as full-set references."""
    if sheet is None or sheet.sheet_type != SheetType.ARCHITECTURAL_PLAN.value:
        return []
    level = _floor_level(text)
    entries: list[dict] = []
    seen: set[tuple[int, int, int]] = set()
    for area_span in sheet_spans:
        match = _ROOM_AREA_RE.search(_span_text(area_span))
        if not match:
            continue
        area_sf = float(match.group("area").replace(",", ""))
        if not 1.0 <= area_sf <= 100_000.0:
            continue
        area_box = area_span.get("bbox") or (0, 0, 0, 0)
        area_cx = (area_box[0] + area_box[2]) / 2
        above = []
        for candidate in sheet_spans:
            if candidate is area_span:
                continue
            candidate_box = candidate.get("bbox") or (0, 0, 0, 0)
            gap = area_box[1] - candidate_box[3]
            candidate_cx = (candidate_box[0] + candidate_box[2]) / 2
            candidate_text = _span_text(candidate)
            if not (0.0 <= gap <= 28.0 and abs(candidate_cx - area_cx) <= 90.0):
                continue
            if not _is_room_name_span(candidate_text) or _ROOM_AREA_RE.search(candidate_text):
                continue
            above.append(candidate)
        if not above:
            continue
        nearest_bottom = max((candidate.get("bbox") or (0, 0, 0, 0))[3] for candidate in above)
        name_spans = [
            candidate for candidate in above
            if nearest_bottom - (candidate.get("bbox") or (0, 0, 0, 0))[3] <= 13.0
        ]
        name_spans.sort(key=lambda candidate: (
            (candidate.get("bbox") or (0, 0, 0, 0))[1],
            (candidate.get("bbox") or (0, 0, 0, 0))[0],
        ))
        name = " ".join(_span_text(candidate) for candidate in name_spans).strip()
        if not name or _ROOM_NAME_IGNORE_RE.search(name) or "GROSS AREA" in name.upper():
            continue
        xs = [v for candidate in name_spans for v in (
            (candidate.get("bbox") or (0, 0, 0, 0))[0],
            (candidate.get("bbox") or (0, 0, 0, 0))[2],
        )]
        ys = [v for candidate in name_spans for v in (
            (candidate.get("bbox") or (0, 0, 0, 0))[1],
            (candidate.get("bbox") or (0, 0, 0, 0))[3],
        )]
        center = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2)
        key = (round(center[0]), round(center[1]), round(area_sf))
        if key in seen:
            continue
        seen.add(key)
        entries.append({
            "name": name,
            "area_sf": area_sf,
            "center": [round(center[0], 3), round(center[1], 3)],
            "level": level,
            "sheet_id": sheet.id,
            "sheet_number": sheet.sheet_number,
            "page_number": sheet.page_number,
            "source_ocr_span_ids": [
                *[str(candidate.get("id", "")) for candidate in name_spans],
                str(area_span.get("id", "")),
            ],
        })
    return entries


def _normalize_floor_material(text: str) -> str:
    upper = " ".join(text.upper().replace(".", "").split())
    aliases = {
        "BRDLM CPT": "BROADLOOM CARPET",
        "BROADLOOM CPT": "BROADLOOM CARPET",
        "CARPET TILE": "CPT TILE",
    }
    return aliases.get(upper, upper)


def _finish_room_labels(spans: list[OCRSpan]) -> list[dict]:
    labels: list[dict] = []
    for floor_span in spans:
        if " ".join(floor_span.text.upper().split()) != "FLOORING:":
            continue
        material_spans = [
            span for span in spans
            if 0.0 <= span.bbox[0] - floor_span.bbox[2] <= 120.0
            and abs(span.bbox[1] - floor_span.bbox[1]) <= 3.0
            and re.search(r"[A-Za-z]", span.text)
        ]
        if not material_spans:
            continue
        material_span = min(material_spans, key=lambda span: span.bbox[0])
        above = [
            span for span in spans
            if 0.0 <= floor_span.bbox[1] - span.bbox[3] <= 24.0
            and abs(
                (span.bbox[0] + span.bbox[2]) / 2
                - (floor_span.bbox[0] + floor_span.bbox[2]) / 2
            ) <= 90.0
            and _is_room_name_span(span.text)
            and "FLOORING" not in span.text.upper()
        ]
        if not above:
            continue
        nearest_bottom = max(span.bbox[3] for span in above)
        names = [span for span in above if nearest_bottom - span.bbox[3] <= 13.0]
        names.sort(key=lambda span: (span.bbox[1], span.bbox[0]))
        name = " ".join(" ".join(span.text.split()) for span in names).strip()
        if not name:
            continue
        center = (
            (min(span.bbox[0] for span in names) + max(span.bbox[2] for span in names)) / 2,
            (min(span.bbox[1] for span in names) + max(span.bbox[3] for span in names)) / 2,
        )
        labels.append({
            "name": name,
            "material": _normalize_floor_material(material_span.text),
            "center": center,
            "source_ocr_span_ids": [
                *[span.id for span in names],
                floor_span.id,
                material_span.id,
            ],
        })
    return labels


def _match_finish_room_areas(labels: list[dict], room_areas: list[dict], level: str) -> list[tuple[dict, dict]]:
    matches: list[tuple[dict, dict]] = []
    used: set[tuple[str, int, int]] = set()
    for label in labels:
        label_tokens = _room_tokens(label["name"])
        candidates = []
        for entry in room_areas:
            if level and entry.get("level") and entry.get("level") != level:
                continue
            center = entry.get("center") or (0.0, 0.0)
            distance = math.dist(label["center"], center)
            entry_tokens = _room_tokens(str(entry.get("name", "")))
            overlap = len(label_tokens & entry_tokens) / max(1, len(label_tokens))
            if overlap <= 0 and distance > 45.0:
                continue
            if distance > (600.0 if overlap >= 0.99 else 160.0):
                continue
            key = (str(entry.get("sheet_id", "")), round(center[0]), round(center[1]))
            if key in used:
                continue
            candidates.append((distance + (1.0 - overlap) * 180.0, key, entry))
        if not candidates:
            continue
        _, key, entry = min(candidates, key=lambda candidate: candidate[0])
        used.add(key)
        matches.append((label, entry))
    return matches


_FLOOR_COLORS = {
    "WOOD": "#8b5e34",
    "TILE": "#2563eb",
    "QUARRY TILE": "#b45309",
    "VCT": "#7c3aed",
    "CPT TILE": "#0f766e",
    "BROADLOOM CARPET": "#be123c",
    "BROADLOOM CARPET RUNNER": "#e11d48",
}


def _floor_style(material: str) -> OverlayStyle:
    color = _FLOOR_COLORS.get(material, "#2563eb")
    return OverlayStyle(stroke=color, fill=f"{color}33")


def _apply_reference_floor_areas(
    items: list[QuantityItem],
    spans: list[OCRSpan],
    reference_catalog: dict,
    sheet,
    scale: ScaleCalibration,
    detections=None,
) -> list[QuantityItem]:
    if sheet.sheet_type != SheetType.FINISH_PLAN:
        return items
    room_areas = reference_catalog.get("room_areas") or []
    labels = _finish_room_labels(spans)
    if not room_areas or not labels:
        return items
    level = _floor_level(" ".join(span.text for span in spans))
    matches = _match_finish_room_areas(labels, room_areas, level)
    if not matches or len(matches) / len(labels) < 0.6:
        return items

    non_floor = [item for item in items if item.item_type != "flooring"]
    floor_items = [item for item in items if item.item_type == "flooring"]
    by_material: dict[str, list[QuantityItem]] = {}
    for item in floor_items:
        code = str(item.attributes.get("floor_code") or "")
        if code:
            by_material.setdefault(code, []).append(item)

    runner_code = "BROADLOOM CARPET RUNNER"
    runner_items = by_material.get(runner_code, [])
    runner_base = sum(item.quantity for item in runner_items)
    grouped_matches: dict[str, list[tuple[dict, dict]]] = {}
    for label, entry in matches:
        grouped_matches.setdefault(label["material"], []).append((label, entry))

    output: list[QuantityItem] = [*non_floor]
    finish_tag_detections = [
        detection for detection in (detections or [])
        if detection.label == "finish_tag"
    ]
    for material, material_matches in grouped_matches.items():
        candidates = by_material.get(material, [])
        if candidates:
            item = candidates[0]
            item.source_geometry_ids = [
                geometry_id for candidate in candidates for geometry_id in candidate.source_geometry_ids
            ]
        else:
            item = QuantityItem(
                project_id=sheet.project_id,
                sheet_id=sheet.id,
                page_number=sheet.page_number,
                item_type="flooring",
                description=f"{material.title()} flooring",
                quantity=0.0,
                unit="SF",
                formula="",
                scale_id=scale.id,
                scale_confidence=scale.confidence,
                measurement_confidence=0.98,
                model_confidence=0.98,
                confidence=ConfidenceBundle(
                    ocr=0.98,
                    scale=max(0.95, scale.confidence),
                    geometry=0.98,
                    detector=0.98,
                ),
            )
        rooms = [
            {
                "name": entry["name"],
                "area_sf": float(entry["area_sf"]),
                "reference_sheet": entry.get("sheet_number", ""),
            }
            for _, entry in material_matches
        ]
        base = sum(room["area_sf"] for room in rooms)
        runner_deduction = 0.0
        if material == "WOOD" and runner_base > 0 and any(
            "SANCTUARY" in room["name"].upper() for room in rooms
        ):
            runner_deduction = runner_base
            base = max(0.0, base - runner_deduction)
        item.id = _stable_id(sheet.id, "flooring", material)
        item.description = f"{material.title()} flooring"
        item.quantity = round(base, 1)
        item.formula = f"SF = sum of {len(rooms)} printed room areas = {sum(room['area_sf'] for room in rooms):.1f}"
        if runner_deduction:
            item.formula += f" - {runner_deduction:.1f} SF carpet runner = {base:.1f}"
        item.source_ocr_span_ids = sorted({
            *[source_id for label, _ in material_matches for source_id in label["source_ocr_span_ids"]],
            *[source_id for _, entry in material_matches for source_id in entry.get("source_ocr_span_ids", [])],
        })
        label_span_sets = [set(label["source_ocr_span_ids"]) for label, _ in material_matches]
        tag_ids = [
            detection.id for detection in finish_tag_detections
            if _normalize_floor_material(detection.material_ref) == material
            and any(
                len(set(detection.matched_ocr_span_ids) & span_ids) >= 2
                for span_ids in label_span_sets
            )
        ]
        item.source_geometry_ids = list(dict.fromkeys([*item.source_geometry_ids, *tag_ids]))
        item.attributes.update({
            "floor_code": material,
            "area_source": "printed_room_area_reference",
            "rooms": rooms,
            "matched_room_count": len(rooms),
            "runner_deduction_sf": round(runner_deduction, 1),
        })
        item.overlay_style = _floor_style(material)
        item.needs_review = False
        item.review_reason = []
        item.measurement_confidence = max(item.measurement_confidence, 0.98)
        item.model_confidence = max(item.model_confidence, 0.98)
        item.confidence.ocr = max(item.confidence.ocr, 0.98)
        item.confidence.geometry = max(item.confidence.geometry, 0.98)
        item.confidence.detector = max(item.confidence.detector, 0.98)
        output.append(item)

    for runner in runner_items:
        runner.id = _stable_id(sheet.id, "flooring", runner_code)
        runner.description = "Broadloom carpet runner"
        runner.attributes["floor_code"] = runner_code
        runner.attributes["area_source"] = "vector_finish_pattern"
        runner.overlay_style = _floor_style(runner_code)
        output.append(runner)
    return output


def _wall_code_hits(spans: list[OCRSpan]) -> list[tuple[str, OCRSpan]]:
    out: list[tuple[str, OCRSpan]] = []
    for span in spans:
        for match in _WALL_CODE_RE.finditer(span.text):
            out.append((match.group(0).upper(), span))
    return out


def _nearest_wall_code(spans: list[OCRSpan], geom, max_distance_pt: float = 96.0) -> tuple[str, OCRSpan] | None:
    if len(geom.exterior) < 2:
        return None
    if geom.kind == "polyline":
        shape = LineString(geom.exterior)
    elif geom.kind == "polygon" and len(geom.exterior) >= 3:
        ring = list(geom.exterior)
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        shape = Polygon(ring)
    else:
        return None
    hits = []
    for code, span in _wall_code_hits(spans):
        cx = (span.bbox[0] + span.bbox[2]) / 2
        cy = (span.bbox[1] + span.bbox[3]) / 2
        dist = shape.distance(Point(cx, cy))
        if dist <= max_distance_pt:
            hits.append((dist, code, span))
    if not hits:
        return None
    _, code, span = min(hits, key=lambda x: x[0])
    return code, span


def _wall_thickness_from_code(code: str) -> float | None:
    parts = code.split("-")
    if not parts:
        return None
    try:
        value = float(parts[-1])
    except ValueError:
        return None
    return value if 0 < value <= 24 else None


def _wall_dimension_metadata(code: str, unit_size_in: float | None) -> dict:
    nominal = _wall_thickness_from_code(code)
    return {
        "thickness_in": unit_size_in if unit_size_in is not None else nominal,
        "thickness_basis": (
            "wall_schedule_unit_size" if unit_size_in is not None else "nominal_wall_code"
        ),
        "nominal_code_thickness_in": nominal,
    }


def _min_wall_thickness_pt(scale: ScaleCalibration, wall_types: dict) -> float:
    """Scale-aware lower bound: a 2.5-inch scheduled partition is under 3 pt
    of paper at 3/16" scale — a fixed floor would erase it."""
    if not scale.usable or scale.ft_per_pt <= 0:
        return 2.2
    sizes = [
        float(_scheduled_wall_unit_size(row) or 0)
        for row in wall_types.values()
        if isinstance(row, dict)
    ]
    sizes = [s for s in sizes if s > 0]
    if not sizes:
        return 2.2
    return max(2.0, (min(sizes) * 0.8 / 12.0) / scale.ft_per_pt)


def _scheduled_wall_unit_size(row: dict) -> float | None:
    """Physical schedule evidence suitable for untagged size propagation.

    A thickness parsed only from a code suffix is useful display metadata, but
    it is not enough to relabel another wall by size. Only an extracted unit
    size (or an explicitly schedule-backed thickness) participates.
    """
    value = row.get("unit_size_in")
    if isinstance(value, (int, float)) and value > 0:
        return float(value)
    if row.get("thickness_basis") == "wall_schedule_unit_size":
        value = row.get("thickness_in")
        if isinstance(value, (int, float)) and value > 0:
            return float(value)
    return None


def _wall_polygon_thickness_in(geom, scale: ScaleCalibration) -> float | None:
    if not scale.usable or geom.kind != "polygon" or len(geom.exterior) < 4:
        return None
    poly = Polygon(geom.exterior)
    if not poly.is_valid or poly.is_empty:
        return None
    rect = poly.minimum_rotated_rectangle
    if not isinstance(rect, Polygon):
        return None
    coords = list(rect.exterior.coords)
    short = min(math.dist(coords[i], coords[i + 1]) for i in range(4))
    return short * scale.ft_per_pt * 12.0


def _attribute_wall_code(
    anchors: list,
    geom,
    scale: ScaleCalibration,
    wall_types: dict,
) -> tuple[str, object | None, str, bool]:
    """(code, span, basis, needs_review) for one wall geometry.

    Order of evidence: the tag whose LEADER lands on this wall; else a tag
    within text-proximity range; else the scheduled type whose size matches
    this wall's drawn thickness ("TYP" tags mark every similar wall); else
    untyped-but-still-counted.
    """
    if geom.kind == "polygon" and len(geom.exterior) >= 3:
        ring = list(geom.exterior)
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        shape = Polygon(ring)
    elif len(geom.exterior) >= 2:
        shape = LineString(geom.exterior)
    else:
        return "", None, "untyped", True

    scored = []
    for code, span, anchor in anchors:
        anchor_d = shape.distance(Point(anchor))
        cx = (span.bbox[0] + span.bbox[2]) / 2
        cy = (span.bbox[1] + span.bbox[3]) / 2
        span_d = shape.distance(Point(cx, cy))
        scored.append((anchor_d, span_d, code, span))
    scored.sort(key=lambda item: (item[0], item[1]))

    if scored and scored[0][0] <= 12.0:
        return scored[0][2], scored[0][3], "leader", False
    near = sorted(scored, key=lambda item: item[1])
    if near and near[0][1] <= 96.0:
        return near[0][2], near[0][3], "nearest_tag", False

    thickness_in = _wall_polygon_thickness_in(geom, scale)
    if thickness_in is not None and wall_types:
        candidates = []
        for code, row in wall_types.items():
            if not isinstance(row, dict):
                continue
            size = _scheduled_wall_unit_size(row)
            if size is None:
                continue
            # drawn thickness ≈ studs alone or studs + GWB build-up
            delta = min(abs(thickness_in - size), abs(thickness_in - size - 1.25))
            candidates.append((delta, code))
        candidates.sort()
        if candidates and candidates[0][0] <= 1.6:
            margin_ok = len(candidates) < 2 or candidates[1][0] - candidates[0][0] > 0.4
            # size ties (two codes share one stud size) break toward the code
            # with the nearest tag instance on the sheet — a reasonably close
            # tag resolves the tie well enough to skip the review flag
            tied = [c for d, c in candidates if d - candidates[0][0] <= 0.3]
            code = candidates[0][1]
            if len(tied) > 1:
                ranked = [(sd, c) for _, sd, c, _ in near if c in tied]
                if ranked:
                    best_distance, code = min(ranked)
                    if best_distance <= 300.0:
                        margin_ok = True
            span = next((s for _, sd, c, s in near if c == code), None)
            return code, span, "typical_size", not margin_ok
    return "", None, "untyped", True


def _max_wall_thickness_pt(scale: ScaleCalibration, wall_types: dict) -> float:
    """Convert scheduled wall sizes into a generous drawing-space plausibility cap."""
    if not scale.usable or scale.ft_per_pt <= 0:
        return 36.0
    sizes = []
    for row in wall_types.values():
        if not isinstance(row, dict) or row.get("existing") is True:
            continue  # a 12" existing brick type must not widen the NEW-wall cap
        value = _scheduled_wall_unit_size(row)
        if value is not None:
            sizes.append(value)
    if not sizes:
        return 36.0
    max_physical_in = max(18.0, max(sizes) * 3.0)
    return max(12.0, min(72.0, (max_physical_in / 12.0) / scale.ft_per_pt))


def _parse_inches(text: str) -> float | None:
    for match in _INCH_RE.finditer(text):
        raw = match.group(0).strip()
        if not raw or not any(ch.isdigit() for ch in raw):
            continue
        whole_s = match.group("whole")
        num_s = match.group("num")
        den_s = match.group("den")
        if not whole_s and not num_s:
            continue
        whole = float(whole_s) if whole_s else 0.0
        frac = 0.0
        if num_s and den_s:
            den = float(den_s)
            if den == 0:
                continue
            frac = float(num_s) / den
        value = whole + frac
        if 0 < value <= 48:
            return value
    return None


def _span_cy(span: dict) -> float:
    box = span.get("bbox") or (0, 0, 0, 0)
    return (box[1] + box[3]) / 2


def _span_text(span: dict) -> str:
    return str(span.get("text", "")).strip()


def _line_text(spans: list[dict]) -> str:
    return " ".join(_span_text(span) for span in sorted(spans, key=lambda s: s.get("bbox", (0, 0, 0, 0))[0]) if _span_text(span))


def _row_local_wall_detail(code: str, span: dict, sheet_spans: list[dict]) -> tuple[str, float | None, int]:
    """Build a compact schedule/detail snippet around one wall-code span."""
    box = span.get("bbox") or (0, 0, 0, 0)
    cy = _span_cy(span)
    row = [
        s for s in sheet_spans
        if abs(_span_cy(s) - cy) <= 8.0
        and box[0] - 24.0 <= (s.get("bbox") or (0, 0, 0, 0))[0] <= box[0] + 520.0
    ]
    row_text = _line_text(row) or _span_text(span)
    unit_size = None
    for right_span in sorted(row, key=lambda s: s.get("bbox", (0, 0, 0, 0))[0]):
        right_box = right_span.get("bbox") or (0, 0, 0, 0)
        if right_box[0] <= box[2] or right_box[0] > box[2] + 150.0:
            continue
        unit_size = _parse_inches(_span_text(right_span))
        if unit_size is not None:
            break
    if unit_size is None:
        unit_size = _parse_inches(row_text.replace(code, "", 1))

    header_lines: list[tuple[float, str]] = []
    for other in sheet_spans:
        obox = other.get("bbox") or (0, 0, 0, 0)
        other_cy = _span_cy(other)
        if not (0 < cy - other_cy <= 90.0):
            continue
        if abs(obox[0] - box[0]) > 120.0 and obox[0] < box[0]:
            continue
        text = _span_text(other)
        if not text:
            continue
        lower = text.lower()
        if (
            "type" in lower
            or "partition" in lower
            or "stud" in lower
            or "gwb" in lower
            or "unit" in lower
            or "rating" in lower
            or "detail" in lower
            or "remarks" in lower
        ):
            header_lines.append((round(other_cy, 1), text))

    grouped_headers: list[str] = []
    for y in sorted({y for y, _ in header_lines})[-4:]:
        grouped_headers.append(
            " ".join(text for yy, text in header_lines if yy == y)
        )

    detail_parts = [part for part in [*grouped_headers, row_text] if part]
    detail = " | ".join(detail_parts)
    score = 0
    if len(row) >= 3:
        score += 5
    if unit_size is not None:
        score += 3
    if grouped_headers:
        score += 2
    return detail, unit_size, score


def _wide_row_stud_size(span: dict, sheet_spans: list[dict]) -> tuple[float | None, str]:
    """Stud size from a build-up cell to the tag's right, tolerating the
    vertical offset of multi-line schedule cells ("3 1/2" WOOD STUDS...")."""
    box = span.get("bbox") or (0, 0, 0, 0)
    cy = _span_cy(span)
    best: tuple[float, float, str] | None = None
    for other in sheet_spans:
        obox = other.get("bbox") or (0, 0, 0, 0)
        if not (box[2] < obox[0] <= box[2] + 420.0):
            continue
        dy = abs(_span_cy(other) - cy)
        if dy > 40.0:
            continue
        text = _span_text(other)
        if "STUD" not in text.upper():
            continue
        size = _parse_inches(text)
        if size is None:
            continue
        if best is None or dy < best[0]:
            best = (dy, size, text)
    if best is None:
        return None, ""
    return best[1], best[2]


def _column_local_wall_detail(span: dict, sheet_spans: list[dict]) -> tuple[str, float | None, int]:
    """Wall-type detail for COLUMN-layout schedules: the boxed tag sits above
    a section diagram with its caption below (ArchiCAD 'WALL TYPES' sheets)."""
    box = span.get("bbox") or (0, 0, 0, 0)
    cx = (box[0] + box[2]) / 2
    below = [
        s for s in sheet_spans
        if 0 < (s.get("bbox") or (0, 0, 0, 0))[1] - box[3] <= 170.0
        and abs(((s.get("bbox") or (0, 0, 0, 0))[0] + (s.get("bbox") or (0, 0, 0, 0))[2]) / 2 - cx) <= 95.0
        and _span_text(s)
    ]
    below.sort(key=lambda s: ((s.get("bbox") or (0, 0, 0, 0))[1], (s.get("bbox") or (0, 0, 0, 0))[0]))
    detail = " ".join(_span_text(s) for s in below)
    unit_size = _parse_inches(detail)
    score = 0
    if len(below) >= 2:
        score += 5
    if unit_size is not None:
        score += 3
    return detail, unit_size, score


def _wall_detail_score(detail: str, sheet: SheetRow | None) -> int:
    text = detail.lower()
    score = 0
    if sheet and sheet.sheet_type in {SheetType.DETAIL.value, SheetType.SCHEDULE.value}:
        score += 4
    if "wall type" in text or "wall types" in text:
        score += 4
    for keyword in ("stud", "partition", "gyp", "metal", "rated", "insulation", "track"):
        if keyword in text:
            score += 1
    if '"' in detail or " in" in text:
        score += 1
    if len(detail) > 80:
        score += 1
    return score


def _harvest_wall_types_schedule(
    sheet_spans: list[dict], sid: str, sheet, text: str, wall_types: dict
) -> None:
    """Harvest short boxed wall-type tags (A, B1, X2...) from a "WALL TYPES"
    schedule sheet. Only rows that read like a wall assembly qualify, so stray
    single letters never become wall types; X/EXISTING/HISTORIC rows carry an
    existing flag so their walls are repair scope, not new LF."""
    if not any(
        _WALL_TYPES_HEADING_RE.fullmatch(" ".join(_span_text(span).split()))
        for span in sheet_spans
    ):
        return
    for span in sheet_spans:
        code_text = _span_text(span).upper()
        if not _SHORT_WALL_CODE_RE.fullmatch(code_text):
            continue
        candidates_rc = []
        for detail_c, size_c, score_c in (
            _row_local_wall_detail(code_text, span, sheet_spans),
            _column_local_wall_detail(span, sheet_spans),
        ):
            plausible = size_c is not None and any(
                abs(size_c - s) <= 0.3 for s in _PLAUSIBLE_WALL_SIZES_IN
            )
            if not plausible:
                size_c = None
            elif "STUD" in detail_c.upper() or "CMU" in detail_c.upper():
                score_c += 4
            candidates_rc.append((detail_c, size_c, score_c))
        detail, unit_size_in, row_score = max(candidates_rc, key=lambda c: c[2])
        if unit_size_in is None:
            stud_size, stud_text = _wide_row_stud_size(span, sheet_spans)
            if stud_size is not None and any(
                abs(stud_size - s) <= 0.3 for s in _PLAUSIBLE_WALL_SIZES_IN
            ):
                unit_size_in = stud_size
                detail = " ".join(f"{detail} {stud_text}".split())
        detail_upper = detail.upper()
        if row_score < 5 or not any(k in detail_upper for k in _WALL_ROW_KEYWORDS):
            continue
        is_existing = bool(_EXISTING_DETAIL_RE.search(detail))
        if unit_size_in is None and is_existing:
            # nominal masonry/plaster thickness so existing walls still win
            # size attribution (and stay out of the new-wall takeoff)
            if "BRICK" in detail_upper:
                unit_size_in = 12.0
            elif "CMU" in detail_upper or "MASONRY" in detail_upper:
                unit_size_in = 8.0
            else:
                unit_size_in = 5.0
        candidate = {
            "code": code_text,
            "sheet_id": sid,
            "sheet_number": sheet.sheet_number if sheet else "",
            "detail": " ".join(detail.split()),
            "existing": is_existing,
            **_wall_dimension_metadata(code_text, unit_size_in),
            "_score": _wall_detail_score(detail, sheet) + row_score,
        }
        if unit_size_in is not None:
            candidate["unit_size_in"] = unit_size_in
        current = wall_types.get(code_text)
        if current is None or candidate["_score"] > current.get("_score", 0):
            wall_types[code_text] = candidate
        # height variants listed in the caption ("A2 = 28" TALL") are tags in
        # their own right on the plans
        for variant in re.findall(r"\b([A-Z]\d{1,2})\s*=\s*\d+\s*\"", detail):
            variant = variant.upper()
            if variant in wall_types:
                continue
            wall_types[variant] = {
                **candidate,
                "code": variant,
                "detail": f"{candidate['detail']} (height variant {variant})",
                "_score": candidate["_score"] - 1,
            }


def _load_reference_catalog(project_id: str) -> dict:
    with session_scope() as s:
        sheet_ids = [r.id for r in s.query(SheetRow).filter_by(project_id=project_id).all()]
        if not sheet_ids:
            return {"wall_types": {}, "door_types": {}, "room_areas": []}
        row = (
            s.query(ArtifactRow)
            .filter(ArtifactRow.sheet_id.in_(sheet_ids), ArtifactRow.kind == "reference_catalog")
            .first()
        )
        return row.data if row else {"wall_types": {}, "door_types": {}, "room_areas": []}


def _door_schedule_entries(sheet_spans: list[dict]) -> dict[str, dict]:
    """Extract authoritative door rows from the schedule's number column."""
    titles = [
        span for span in sheet_spans
        if " ".join(_span_text(span).upper().split()) == "DOOR SCHEDULE"
    ]
    if not titles:
        return {}

    note_tops = [
        (span.get("bbox") or (0, 0, 0, 0))[1]
        for span in sheet_spans
        if "DOOR SCHEDULE GENERAL NOTES" in _span_text(span).upper()
    ]
    entries: dict[str, dict] = {}
    for title in titles:
        title_box = title.get("bbox") or (0, 0, 0, 0)
        y_min = title_box[3]
        later_notes = [y for y in note_tops if y > y_min]
        y_max = min(later_notes) if later_notes else float("inf")
        candidates = [
            span for span in sheet_spans
            if _DOOR_SCHEDULE_MARK_RE.fullmatch(_span_text(span))
            and y_min < _span_cy(span) < y_max
        ]
        if not candidates:
            continue

        # Schedule marks align in one vertical number column. Group by x and
        # choose the densest cluster to reject door-key examples and dimensions.
        clusters: list[list[dict]] = []
        for span in sorted(candidates, key=lambda value: (value.get("bbox") or (0, 0, 0, 0))[0]):
            x = (span.get("bbox") or (0, 0, 0, 0))[0]
            cluster = next(
                (
                    group for group in clusters
                    if abs(x - sum((item.get("bbox") or (0, 0, 0, 0))[0] for item in group) / len(group)) <= 36.0
                ),
                None,
            )
            if cluster is None:
                clusters.append([span])
            else:
                cluster.append(span)
        number_column = max(
            clusters,
            key=lambda group: (len({_span_text(span).upper() for span in group}), len(group)),
        )
        if len({_span_text(span).upper() for span in number_column}) < 2:
            continue

        for mark_span in sorted(number_column, key=_span_cy):
            mark = _span_text(mark_span).upper()
            mark_box = mark_span.get("bbox") or (0, 0, 0, 0)
            cy = _span_cy(mark_span)
            same_line = [
                span for span in sheet_spans
                if abs(_span_cy(span) - cy) <= 4.0
                and (span.get("bbox") or (0, 0, 0, 0))[0] >= mark_box[0] - 4.0
            ]
            same_line.sort(key=lambda span: (span.get("bbox") or (0, 0, 0, 0))[0])
            right_cells = [
                span for span in same_line
                if (span.get("bbox") or (0, 0, 0, 0))[0] > mark_box[2]
            ]
            first_cell = right_cells[0] if right_cells else None
            first_text = _span_text(first_cell).upper() if first_cell else ""
            first_x = (first_cell.get("bbox") or (float("inf"), 0, 0, 0))[0] if first_cell else float("inf")
            entries[mark] = {
                "code": mark,
                "existing": first_text == "ETR" and first_x - mark_box[2] <= 120.0,
                "detail": _line_text(same_line),
                "source_ocr_span_id": mark_span.get("id", ""),
            }
    return entries


def _build_and_persist_reference_catalog(project_id: str) -> dict:
    with session_scope() as s:
        sheets = s.query(SheetRow).filter_by(project_id=project_id).all()
        sheet_ids = [r.id for r in sheets]
        if not sheet_ids:
            return {"wall_types": {}, "door_types": {}, "room_areas": []}
        sheet_by_id = {r.id: r for r in sheets}
        spans = [
            r.data for r in s.query(ArtifactRow)
            .filter(ArtifactRow.sheet_id.in_(sheet_ids), ArtifactRow.kind == "ocr_span")
            .all()
        ]
        by_sheet: dict[str, list[dict]] = {}
        for span in spans:
            by_sheet.setdefault(span["sheet_id"], []).append(span)

        wall_types: dict[str, dict] = {}
        door_types: dict[str, dict] = {}
        room_areas: list[dict] = []
        for sid, sheet_spans in by_sheet.items():
            text = " ".join(span.get("text", "") for span in sheet_spans)
            sheet = sheet_by_id.get(sid)
            for span in sheet_spans:
                span_text = _span_text(span)
                if not span_text:
                    continue
                for match in _WALL_CODE_RE.finditer(span_text):
                    code = match.group(0).upper()
                    detail, unit_size_in, row_score = _row_local_wall_detail(code, span, sheet_spans)
                    if not detail:
                        detail = span_text
                    candidate = {
                        "code": code,
                        "sheet_id": sid,
                        "sheet_number": sheet.sheet_number if sheet else "",
                        "detail": " ".join(detail.split()),
                        **_wall_dimension_metadata(code, unit_size_in),
                        "_score": _wall_detail_score(detail, sheet) + row_score,
                    }
                    if unit_size_in is not None:
                        candidate["unit_size_in"] = unit_size_in
                    current = wall_types.get(code)
                    if current is None or candidate["_score"] > current.get("_score", 0):
                        wall_types[code] = candidate

            _harvest_wall_types_schedule(sheet_spans, sid, sheet, text, wall_types)
            room_areas.extend(_room_area_entries(sheet_spans, sheet, text))

            # Fallback for any code embedded in a long span without usable row
            # geometry, such as a paragraph note extracted as one native span.
            for match in _WALL_CODE_RE.finditer(text):
                code = match.group(0).upper()
                if code in wall_types:
                    continue
                start = max(0, match.start() - 120)
                end = min(len(text), match.end() + 180)
                detail = " ".join(text[start:end].split())
                candidate = {
                    "code": code,
                    "sheet_id": sid,
                    "sheet_number": sheet.sheet_number if sheet else "",
                    "detail": detail,
                    **_wall_dimension_metadata(code, None),
                    "_score": _wall_detail_score(detail, sheet),
                }
                current = wall_types.get(code)
                if current is None or candidate["_score"] > current.get("_score", 0):
                    wall_types[code] = candidate

            for code, door in _door_schedule_entries(sheet_spans).items():
                door_types[code] = door | {
                    "sheet_id": sid,
                    "sheet_number": sheet.sheet_number if sheet else "",
                }

        for value in wall_types.values():
            value.pop("_score", None)
        data = {
            "project_id": project_id,
            "wall_types": wall_types,
            "door_types": door_types,
            "room_areas": room_areas,
        }
        for old in (
            s.query(ArtifactRow)
            .filter(ArtifactRow.sheet_id.in_(sheet_ids), ArtifactRow.kind == "reference_catalog")
            .all()
        ):
            s.delete(old)
        s.add(ArtifactRow(
            id=_stable_id(project_id, "reference_catalog"),
            sheet_id=sheet_ids[0],
            kind="reference_catalog",
            data=data,
        ))
        return data


def _load_manual_scale(sheet_id: str) -> ScaleCalibration | None:
    """A two-click MANUAL calibration stored by the /calibrate endpoint wins over
    every OCR-derived source on re-process. Preserved across re-runs."""
    with session_scope() as s:
        rows = s.query(ArtifactRow).filter_by(sheet_id=sheet_id, kind="scale").all()
        manual = [
            r.data for r in rows if r.data.get("source") == ScaleSource.MANUAL.value
        ]
    if not manual:
        return None
    # Newest manual calibration wins.
    manual.sort(key=lambda d: d.get("created_at", ""))
    cal = ScaleCalibration.model_validate(manual[-1])
    return cal if cal.usable else None


def index_project_job(project_id: str, job_id: str) -> None:
    settings = get_settings()
    storage = LocalStorage(settings.storage_root)
    adapters = build_adapters(settings)
    geometry_engine = GeometryEngine()

    def set_job(status: str, progress: str = "", error: str = ""):
        with session_scope() as s:
            job = s.get(JobRow, job_id)
            if job:
                job.status = status
                job.progress = progress or job.progress
                job.error = error
                if status in ("done", "failed"):
                    job.finished_at = datetime.now(UTC)

    try:
        set_job("running", "indexing files")
        with session_scope() as s:
            files = s.query(FileRow).filter_by(project_id=project_id).all()
        if not files:
            raise ValueError("project has no uploaded files")
        for f in files:
            _index_file(project_id, f, settings, storage, adapters, geometry_engine, set_job)
        _build_and_persist_reference_catalog(project_id)
        with session_scope() as s:
            proj = s.get(ProjectRow, project_id)
            if proj:
                proj.status = "indexed"
                data = dict(proj.data or {})
                data["indexed_at"] = datetime.now(UTC).isoformat()
                proj.data = data
        set_job("done", "indexed")
    except Exception as e:
        log.exception("indexing failed for project %s", project_id)
        with session_scope() as s:
            proj = s.get(ProjectRow, project_id)
            if proj:
                proj.status = "failed"
        set_job("failed", error=f"{type(e).__name__}: {e}")


def process_project_job(project_id: str, job_id: str, scope_payload: dict | None = None) -> None:
    settings = get_settings()
    storage = LocalStorage(settings.storage_root)
    adapters = build_adapters(settings)
    geometry_engine = GeometryEngine()
    if scope_payload is None:
        with session_scope() as s:
            proj = s.get(ProjectRow, project_id)
            data = proj.data if proj and isinstance(proj.data, dict) else {}
            stored = data.get("takeoff_scope") if isinstance(data, dict) else None
            scope_payload = stored if isinstance(stored, dict) else None
    scope = scope_from_payload(scope_payload)
    reference_catalog = _load_reference_catalog(project_id)

    def set_job(status: str, progress: str = "", error: str = ""):
        with session_scope() as s:
            job = s.get(JobRow, job_id)
            if job:
                job.status = status
                job.progress = progress or job.progress
                job.error = error
                if status in ("done", "failed"):
                    job.finished_at = datetime.now(UTC)

    try:
        set_job("running", "loading files")
        with session_scope() as s:
            files = s.query(FileRow).filter_by(project_id=project_id).all()
        if not files:
            raise ValueError("project has no uploaded files")

        for f in files:
            _process_file(
                project_id, f, settings, storage, adapters, geometry_engine,
                set_job, scope=scope, reference_catalog=reference_catalog,
            )
        _build_and_persist_reference_catalog(project_id)

        with session_scope() as s:
            proj = s.get(ProjectRow, project_id)
            if proj:
                proj.status = "processed"
                data = dict(proj.data or {})
                if scope_payload:
                    data["takeoff_scope"] = scope.model_dump(mode="json")
                proj.data = data
        set_job("done", "complete")
    except Exception as e:
        log.exception("processing failed for project %s", project_id)
        with session_scope() as s:
            proj = s.get(ProjectRow, project_id)
            if proj:
                proj.status = "failed"
        set_job("failed", error=f"{type(e).__name__}: {e}")


def _index_file(project_id, file_row, settings, storage, adapters, geometry_engine, set_job):
    path = storage.open_path(file_row.storage_path)
    is_tiff = file_row.media_type in ("image/tiff", "image/tif") or path.suffix.lower() in (
        ".tif",
        ".tiff",
    )
    ingestor = TiffIngestor() if is_tiff else PyMuPDFIngestor()
    n_pages = ingestor.page_count(path)

    for page_number in range(1, n_pages + 1):
        set_job("running", f"indexing {file_row.filename}: sheet {page_number}/{n_pages}")
        sheet = ingestor.extract_sheet(path, page_number, project_id, file_row.storage_path)
        sheet.id = _stable_id(project_id, file_row.storage_path, page_number)
        render_dpi = min(settings.render_dpi, settings.max_render_dpi)
        render_key = f"projects/{project_id}/renders/{sheet.id}_{render_dpi}.png"
        raster = ingestor.render_page(
            path, page_number, sheet.id, render_dpi, storage.open_path(render_key)
        )
        raster.image_path = render_key
        native_spans, vector_paths = [], []
        if not is_tiff:
            native_spans = ingestor.extract_text_spans(path, page_number, sheet.id)
            vector_paths = ingestor.extract_vector_paths(path, page_number, sheet.id)

        image = cv2.imread(str(storage.open_path(render_key)))
        px_per_pt = raster.px_per_pt
        ocr_result = adapters["ocr"].run(image, sheet.id, px_per_pt)
        spans = native_spans + ocr_result.spans
        sheet.sheet_type, sheet.sheet_type_confidence, sheet.sheet_number = classify_sheet(
            sheet, spans
        )
        pdf_scale = None if is_tiff else ingestor.scale_metadata(path, page_number)
        manual_scale = _load_manual_scale(sheet.id)
        scale = resolve_scale(
            sheet, spans, pdf_metadata_ft_per_pt=pdf_scale, manual_override=manual_scale
        )
        sheet.is_nts = scale.source.value == "nts"
        _persist_sheet(
            project_id, sheet, raster, vector_paths, spans, ocr_result.tables,
            scale, [], [], [], [], [], clear_quantities=False,
        )


def _mark_quantity_excluded_by_scope(old: QuantityRow) -> None:
    old.review_status = "rejected"
    old.needs_review = False
    old_data = dict(old.data or {})
    old_data["review_status"] = "rejected"
    old_data["needs_review"] = False
    attrs = old_data.get("attributes")
    if not isinstance(attrs, dict):
        attrs = {}
    attrs["excluded_by_scope"] = True
    old_data["attributes"] = attrs
    old.data = old_data


def _reject_sheet_quantities(project_id: str, sheet_id: str) -> None:
    with session_scope() as s:
        for old in s.query(QuantityRow).filter_by(project_id=project_id, sheet_id=sheet_id).all():
            _mark_quantity_excluded_by_scope(old)


def _scoped_pages_from_index(project_id: str, file_row, scope: TakeoffScope, n_pages: int) -> list[int] | None:
    if scope.is_empty:
        return None
    selected: list[int] = []
    indexed_any = False
    with session_scope() as s:
        for page_number in range(1, n_pages + 1):
            sheet_id = _stable_id(project_id, file_row.storage_path, page_number)
            row = s.get(SheetRow, sheet_id)
            if row is None:
                continue
            indexed_any = True
            trades = scope.trades_for_sheet(
                sheet_id=row.id,
                sheet_number=row.sheet_number,
                page_number=row.page_number,
            )
            if trades:
                selected.append(page_number)
            else:
                for old in s.query(QuantityRow).filter_by(project_id=project_id, sheet_id=row.id).all():
                    _mark_quantity_excluded_by_scope(old)
    return selected if indexed_any else None


def _process_file(
    project_id,
    file_row,
    settings,
    storage,
    adapters,
    geometry_engine,
    set_job,
    *,
    scope: TakeoffScope,
    reference_catalog: dict,
):
    path = storage.open_path(file_row.storage_path)
    is_tiff = file_row.media_type in ("image/tiff", "image/tif") or path.suffix.lower() in (
        ".tif",
        ".tiff",
    )
    ingestor = TiffIngestor() if is_tiff else PyMuPDFIngestor()
    n_pages = ingestor.page_count(path)
    pages_to_process = _scoped_pages_from_index(project_id, file_row, scope, n_pages)
    if pages_to_process is None:
        pages_to_process = list(range(1, n_pages + 1))
    elif not pages_to_process:
        set_job("running", f"{file_row.filename}: no scoped sheets to process")
        return

    for ordinal, page_number in enumerate(pages_to_process, start=1):
        if scope.is_empty:
            set_job("running", f"{file_row.filename}: sheet {page_number}/{n_pages}")
        else:
            set_job(
                "running",
                f"{file_row.filename}: scoped sheet {ordinal}/{len(pages_to_process)} (page {page_number}/{n_pages})",
            )

        # --- 1. sheet ingestion ------------------------------------------
        sheet = ingestor.extract_sheet(path, page_number, project_id, file_row.storage_path)
        # Stable identity keyed on (project, file, page) so a re-run overwrites
        # this sheet's rows rather than appending a duplicate set.
        sheet.id = _stable_id(project_id, file_row.storage_path, page_number)
        render_dpi = min(settings.render_dpi, settings.max_render_dpi)  # guard absurd DPI
        render_key = f"projects/{project_id}/renders/{sheet.id}_{render_dpi}.png"
        raster = ingestor.render_page(
            path, page_number, sheet.id, render_dpi, storage.open_path(render_key)
        )
        raster.image_path = render_key
        native_spans, vector_paths = [], []
        if not is_tiff:
            native_spans = ingestor.extract_text_spans(path, page_number, sheet.id)
            vector_paths = ingestor.extract_vector_paths(path, page_number, sheet.id)

        image = cv2.imread(str(storage.open_path(render_key)))
        px_per_pt = raster.px_per_pt

        # --- 2. OCR/layout -------------------------------------------------
        ocr_result = adapters["ocr"].run(image, sheet.id, px_per_pt)
        spans = native_spans + ocr_result.spans

        # --- 3. classification --------------------------------------------
        sheet.sheet_type, sheet.sheet_type_confidence, sheet.sheet_number = classify_sheet(
            sheet, spans
        )

        # --- 4. scale calibration ------------------------------------------
        pdf_scale = None if is_tiff else ingestor.scale_metadata(path, page_number)
        manual_scale = _load_manual_scale(sheet.id)
        scale = resolve_scale(
            sheet, spans, pdf_metadata_ft_per_pt=pdf_scale, manual_override=manual_scale
        )
        sheet.is_nts = scale.source.value == "nts"
        allowed_trades = scope.trades_for_sheet(
            sheet_id=sheet.id,
            sheet_number=sheet.sheet_number,
            page_number=sheet.page_number,
        )
        include_existing = scope.include_existing_for_sheet(
            sheet_id=sheet.id,
            sheet_number=sheet.sheet_number,
            page_number=sheet.page_number,
        )

        if not allowed_trades:
            _persist_sheet(
                project_id, sheet, raster, vector_paths, spans, ocr_result.tables,
                scale, [], [], [], [], [], clear_quantities=True,
            )
            continue
        if sheet.sheet_type not in _GEOMETRIC_TAKEOFF_SHEET_TYPES:
            _persist_sheet(
                project_id, sheet, raster, vector_paths, spans, ocr_result.tables,
                scale, [], [], [], [], [], clear_quantities=True,
            )
            continue

        # --- 5. candidates --------------------------------------------------
        # vector_paths feed the exact vector-first boundary path; the mask is
        # the fallback only where a sheet carries no linework.
        wall_types_catalog = reference_catalog.get("wall_types", {})
        detections, masks, geometries, exclusions = run_candidates(
            image, sheet.id, px_per_pt, adapters["detector"], adapters["segmenter"],
            geometry_engine, vector_paths=vector_paths, ocr_spans=spans,
            include_existing=include_existing, requested_trades=allowed_trades,
            door_schedule=reference_catalog.get("door_types", {}),
            max_wall_thickness_pt=_max_wall_thickness_pt(scale, wall_types_catalog),
            min_wall_thickness_pt=_min_wall_thickness_pt(scale, wall_types_catalog),
            wall_types=wall_types_catalog,
        )
        sheet_tag_spans = find_tag_spans(
            spans, _WALL_CODE_RE, lexicon=wall_types_catalog, vector_paths=vector_paths
        )
        sheet_anchors = tag_anchors(sheet_tag_spans, vector_paths)

        # --- 6. deterministic measurement -----------------------------------
        # Overlapping detectors (or a box + its own interior contour) can yield
        # near-identical polygons; keep one per region.
        geometries = _dedupe_geometries(geometries, geometry_engine)
        excluded_polys = exclusion_polygons(exclusions)
        items = []
        item_labels: dict[str, object] = {}  # item.id → nearest room_label detection
        det_by_id = {d.id: d for d in detections}
        label_dets = [d for d in detections if d.label == "room_label"]

        # Openings punched through EXISTING (X-tagged) walls carry glazing and
        # frames drawn at wall-like thickness; extend each existing-attributed
        # wall along its axis so those slivers read as existing, not new.
        existing_band_polys: list[Polygon] = []
        if not include_existing and any(
            isinstance(row, dict) and row.get("existing") is True
            for row in wall_types_catalog.values()
        ):
            prepass_existing = []
            for geom in geometries:
                det = next((det_by_id[i] for i in geom.derived_from if i in det_by_id), None)
                if det is None or det.label != "wall" or geom.kind != "polygon":
                    continue
                code, _span, _basis, _review = _attribute_wall_code(
                    sheet_anchors, geom, scale, wall_types_catalog
                )
                row = wall_types_catalog.get(code)
                if isinstance(row, dict) and row.get("existing") is True:
                    poly = _polygon_for_geometry(geom)
                    if poly is not None:
                        prepass_existing.append(poly)
            existing_band_polys = extend_rect_bands(prepass_existing)

        for idx, geom in enumerate(geometries):
            det = next((det_by_id[i] for i in geom.derived_from if i in det_by_id), None)
            label = det.label if det else "room"
            item_type = ITEM_TYPE_BY_LABEL.get(label)
            if item_type is None:
                continue
            if not scope.is_empty and label == "slab" and "flooring" in allowed_trades:
                item_type = "flooring"
            # Structural sheets take off slabs; everything measured there is concrete.
            if scope.is_empty and sheet.sheet_type == SheetType.STRUCTURAL_PLAN and item_type == "flooring":
                item_type = "concrete_slab"
            trade = _trade_for_item(item_type, label)
            if trade not in allowed_trades:
                continue
            if item_type == "column" and not include_existing and _geometry_is_excluded(geom, excluded_polys):
                continue
            if item_type == "wall":
                if existing_band_polys:
                    poly_probe = _polygon_for_geometry(geom)
                    if poly_probe is not None and any(
                        band.intersection(poly_probe).area >= 0.6 * poly_probe.area
                        for band in existing_band_polys
                    ):
                        continue  # glazing/frame sliver inside an existing wall's opening
                wall_code, code_span, code_basis, code_review = _attribute_wall_code(
                    sheet_anchors, geom, scale, wall_types_catalog
                )
                if _wall_is_annotation_or_window_frame(geom, spans, code_basis):
                    continue
                wall_detail = wall_types_catalog.get(wall_code) if wall_code else None
                if (
                    wall_detail is not None
                    and wall_detail.get("existing") is True
                    and not include_existing
                ):
                    # tagged EXISTING wall type (X1... in sets that schedule
                    # existing walls) — repair scope, not new partition LF
                    continue
                drawn_thickness_in = _wall_polygon_thickness_in(geom, scale)
                description = f"Wall {wall_code}" if wall_code else "New wall (untyped)"
                item = measure_length_item(
                    project_id=project_id, sheet=sheet, geometry=geom, scale=scale,
                    detection=det, item_type=item_type, description=description,
                )
                if drawn_thickness_in is not None:
                    item.attributes["drawn_thickness_in"] = round(drawn_thickness_in, 2)
                item.overlay_style = _wall_overlay_style(
                    wall_code or "NEW", wall_types_catalog
                )
                if wall_code:
                    item.attributes["wall_code"] = wall_code
                    item.attributes["wall_code_basis"] = code_basis
                    if code_span is not None:
                        item.source_ocr_span_ids.append(code_span.id)
                    if code_review and ReviewReason.LOW_CONFIDENCE not in item.review_reason:
                        item.needs_review = True
                        item.review_reason.append(ReviewReason.LOW_CONFIDENCE)
                    if wall_detail:
                        item.attributes["wall_detail"] = wall_detail.get("detail", "")
                        if wall_detail.get("thickness_in") is not None:
                            item.attributes["thickness_in"] = wall_detail["thickness_in"]
                        if wall_detail.get("unit_size_in") is not None:
                            item.attributes["unit_size_in"] = wall_detail["unit_size_in"]
                        if wall_detail.get("thickness_basis"):
                            item.attributes["thickness_basis"] = wall_detail["thickness_basis"]
                        if wall_detail.get("nominal_code_thickness_in") is not None:
                            item.attributes["nominal_code_thickness_in"] = wall_detail[
                                "nominal_code_thickness_in"
                            ]
                        if code_basis == "leader" or not code_review:
                            item.confidence.detector = max(item.confidence.detector, 0.9)
                            item.model_confidence = max(item.model_confidence, item.confidence.detector)
                    else:
                        item.needs_review = True
                        item.review_reason.append(ReviewReason.WALL_DETAIL_MISSING)
                else:
                    # still counted — an estimator reviews it rather than
                    # silently losing footage
                    size_key = f"{round((drawn_thickness_in or 0) * 2) / 2:g}\""
                    item.attributes["wall_code"] = f"NEW-{size_key}"
                    item.needs_review = True
                    item.review_reason.append(ReviewReason.WALL_DETAIL_MISSING)
            elif item_type == "column":
                shape = "round" if label == "round_column" else "square"
                item = measure_column_item(
                    project_id=project_id, sheet=sheet, geometry=geom, scale=scale,
                    detection=det, shape=shape,
                )
            else:
                item = measure_area_item(
                    project_id=project_id, sheet=sheet, geometry=geom, scale=scale,
                    detection=det, item_type=item_type, settings=settings,
                )
                if item_type == "flooring" and det is not None and det.material_ref:
                    material = _normalize_floor_material(det.material_ref)
                    item.description = f"{material.title()} flooring"
                    item.attributes["floor_code"] = material
                    item.overlay_style = _floor_style(material)
            item.id = _stable_id(sheet.id, item_type, idx)
            items.append(item)
            item_labels[item.id] = _nearest_label(label_dets, geometry_engine, geom)
        items = _group_wall_items(items, sheet.id)
        items = _group_flooring_items(items, sheet.id)
        if "flooring" in allowed_trades:
            items = _apply_reference_floor_areas(
                items,
                spans,
                reference_catalog,
                sheet,
                scale,
                detections,
            )
            _apply_floor_area_label_total(items, spans, detections, sheet.sheet_type)
        # A slab footprint and its interior sub-faces (partitions/rooms) can both
        # be detected; summing them double-counts concrete. Collapse any slab
        # contained within a larger slab into the footprint (flooring is left
        # alone — distinct rooms are distinct floor areas).
        items = _collapse_contained_slabs(items, {g.id: g for g in geometries}, geometry_engine)
        count_labels = ["door"] if "doors" in allowed_trades and not scope.is_empty else COUNT_LABELS
        if "doors" not in allowed_trades and not scope.is_empty:
            count_labels = []
        for label in count_labels:
            counted = count_symbols(
                project_id=project_id, sheet=sheet, detections=detections,
                label=label, scale=scale, exclude_polygons=excluded_polys,
            )
            if counted:
                if label == "door" and reference_catalog.get("door_types"):
                    door_types = reference_catalog["door_types"]
                    existing_marks = sorted(
                        code for code, row in door_types.items()
                        if isinstance(row, dict) and row.get("existing") is True
                    )
                    counted.attributes["schedule_row_count"] = len(door_types)
                    counted.attributes["new_schedule_row_count"] = len(door_types) - len(existing_marks)
                    counted.attributes["existing_schedule_marks_excluded"] = existing_marks
                counted.id = _stable_id(sheet.id, label)
                items.append(counted)

        # --- 7. confidence + review flags ------------------------------------
        geoms_by_id = {g.id: g for g in geometries}
        masks_by_id = {m.id: m for m in masks}
        for item in items:
            finalize_item(
                item, settings=settings, scale=scale,
                geometries=geoms_by_id, masks=masks_by_id,
                label_detection=item_labels.get(item.id),
                dpi_assumed=raster.dpi_assumed,
            )

        # --- 8. VLM audit (flagged items only) --------------------------------
        queue = audit.build_question_queue(items)
        if queue:
            audit.run_audit(queue, adapters["vlm"], image, px_per_pt, {i.id: i for i in items})

        # --- 9. estimator rollup ----------------------------------------------
        items = rollup_items(
            items, spans, adapters["rollup"], settings,
            geometries=geoms_by_id, engine=geometry_engine,
        )
        # Rollup/VLM may have lowered confidence; recompute and re-apply the
        # low-confidence threshold so a late drop still flags for review.
        for item in items:
            item.final_confidence = item.confidence.final()
            if (
                item.final_confidence < settings.review_confidence_threshold
                and ReviewReason.LOW_CONFIDENCE not in item.review_reason
            ):
                item.needs_review = True
                item.review_reason.append(ReviewReason.LOW_CONFIDENCE)

        _persist_sheet(
            project_id, sheet, raster, vector_paths, spans, ocr_result.tables,
            scale, detections, masks, geometries, exclusions, items,
        )


_SOURCE_RANK = {"vector": 0, "manual": 1}  # exact > manual > mask/unknown (default 2)


def _dedupe_geometries(geometries, engine, threshold: float = 0.92):
    """Drop polygons that mutually overlap an already-kept one by >threshold.

    Order matters: a region can be captured by BOTH an exact vector face and an
    approximate mask, so we keep the vector one — ranking boundary_source before
    area — and only fall back to larger-area within the same source. Shapely
    shapes are built once per geometry (not on every O(n²) comparison).
    """
    shapes: dict[str, object] = {}

    def shape(g):
        if g.id not in shapes:
            shapes[g.id] = engine._to_shapely(g)
        return shapes[g.id]

    def rank(g):
        return (_SOURCE_RANK.get(g.boundary_source, 2), -g.area_pt2)

    kept = []
    for g in sorted(geometries, key=rank):
        if g.kind == "polygon" and g.is_closed:
            sg = shape(g)
            if sg is not None:
                dup = False
                for k in kept:
                    sk = shape(k)
                    if sk is None:
                        continue
                    inter = sg.intersection(sk).area
                    if inter > threshold * sg.area and inter > threshold * sk.area:
                        dup = True
                        break
                if dup:
                    continue
        kept.append(g)
    return kept


def _group_wall_items(items, sheet_id: str):
    grouped: dict[str, list] = {}
    passthrough = []
    for item in items:
        code = item.attributes.get("wall_code") if item.item_type == "wall" else None
        if not code:
            passthrough.append(item)
            continue
        grouped.setdefault(str(code), []).append(item)

    for code, group in grouped.items():
        first = group[0]
        raw_lengths = [
            float(i.attributes.get("raw_quantity_lf", i.quantity))
            for i in group
        ]
        segment_lengths = [round(value, 2) for value in raw_lengths]
        raw_total = sum(raw_lengths)
        first.attributes["segment_count"] = len(group)
        first.attributes["segment_lengths_lf"] = segment_lengths
        first.attributes["raw_quantity_lf"] = raw_total
        if len(group) == 1:
            first.quantity = round(raw_total, 2)
            first.id = _stable_id(sheet_id, "wall", code)
            passthrough.append(first)
            continue
        first.id = _stable_id(sheet_id, "wall", code)
        first.quantity = round(raw_total, 2)
        first.source_geometry_ids = [gid for i in group for gid in i.source_geometry_ids]
        first.source_ocr_span_ids = sorted({sid for i in group for sid in i.source_ocr_span_ids})
        first.measurement_confidence = min(i.measurement_confidence for i in group)
        first.model_confidence = min(i.model_confidence for i in group)
        first.confidence.geometry = min(i.confidence.geometry for i in group)
        first.confidence.detector = min(i.confidence.detector for i in group)
        first.needs_review = any(i.needs_review for i in group)
        first.review_reason = sorted({r for i in group for r in i.review_reason}, key=lambda r: r.value)
        first.formula = f"LF = sum of {len(group)} wall segments for {code} = {first.quantity:.2f}"
        passthrough.append(first)
    return passthrough


def _group_flooring_items(items, sheet_id: str):
    grouped: dict[str, list] = {}
    passthrough = []
    for item in items:
        if item.item_type != "flooring":
            passthrough.append(item)
            continue
        floor_code = item.attributes.get("floor_code")
        if not floor_code and item.attributes.get("source_detector") != "vector_heuristic":
            passthrough.append(item)
            continue
        key = str(floor_code or item.description or "Floor finish")
        grouped.setdefault(key, []).append(item)

    for key, group in grouped.items():
        first = group[0]
        first.id = _stable_id(sheet_id, "flooring", key)
        if len(group) > 1:
            first.quantity = round(sum(i.quantity for i in group), 1)
            first.source_geometry_ids = [gid for i in group for gid in i.source_geometry_ids]
            first.source_ocr_span_ids = sorted({sid for i in group for sid in i.source_ocr_span_ids})
            first.measurement_confidence = min(i.measurement_confidence for i in group)
            first.model_confidence = min(i.model_confidence for i in group)
            first.confidence.geometry = min(i.confidence.geometry for i in group)
            first.confidence.detector = min(i.confidence.detector for i in group)
            first.needs_review = any(i.needs_review for i in group)
            first.review_reason = sorted({r for i in group for r in i.review_reason}, key=lambda r: r.value)
            first.formula = f"SF = sum of {len(group)} floor regions = {first.quantity:.1f}"
        passthrough.append(first)
    return passthrough


def _collapse_contained_slabs(items, geoms_by_id, engine, contain: float = 0.9):
    """Drop any concrete_slab whose polygon is >=`contain` inside a larger slab
    (footprint absorbs interior faces) — deterministic anti-double-count."""
    slabs = [it for it in items if it.item_type == "concrete_slab" and it.source_geometry_ids]
    drop: set[str] = set()
    for a in slabs:
        ga = geoms_by_id.get(a.source_geometry_ids[0])
        if ga is None or not ga.is_closed:
            continue
        for b in slabs:
            if a is b or b.id in drop:
                continue
            gb = geoms_by_id.get(b.source_geometry_ids[0])
            if gb is None or not gb.is_closed or gb.area_pt2 <= ga.area_pt2:
                continue
            if engine.overlap_ratio(ga, gb) >= contain:  # a mostly inside larger b
                drop.add(a.id)
                break
    return [it for it in items if it.id not in drop]


def _persist_sheet(
    project_id,
    sheet,
    raster,
    vector_paths,
    spans,
    tables,
    scale,
    detections,
    masks,
    geometries,
    exclusions: list[ExclusionRegion],
    items,
    *,
    clear_quantities: bool = True,
):
    def artifact(kind, model):
        return ArtifactRow(
            id=model.id, sheet_id=sheet.id, kind=kind, data=model.model_dump(mode="json")
        )

    with session_scope() as s:
        # Idempotent re-process: clear this sheet's prior artifacts (keeping any
        # human MANUAL calibration) and upsert the sheet + quantities by their
        # stable ids, so a second /process run overwrites instead of duplicating.
        # Quantities are upserted (not deleted) so review_decisions stay linked.
        manual_ids = {
            r.id
            for r in s.query(ArtifactRow).filter_by(sheet_id=sheet.id, kind="scale").all()
            if r.data.get("source") == ScaleSource.MANUAL.value
        }
        for r in s.query(ArtifactRow).filter_by(sheet_id=sheet.id).all():
            if r.id not in manual_ids:
                s.delete(r)
        s.flush()

        s.merge(SheetRow(
            id=sheet.id, project_id=project_id, page_number=sheet.page_number,
            sheet_number=sheet.sheet_number, sheet_type=sheet.sheet_type.value,
            data=sheet.model_dump(mode="json"),
        ))
        # The artifact/quantity mappers have FK columns but no relationship()
        # to SheetRow, so the unit of work will NOT order the sheet INSERT
        # ahead of theirs. Flush the sheet row first or Postgres rejects the
        # batch with a foreign-key violation (SQLite only when FKs are on).
        s.flush()
        s.add(artifact("raster_page", raster))
        # A resolved MANUAL scale is already persisted (preserved above); don't re-add it.
        if scale.id not in manual_ids:
            s.add(artifact("scale", scale))
        # Raw vector linework is deliberately NOT persisted: nothing reads it
        # back (every pipeline stage re-extracts it from the PDF), and at tens
        # of thousands of paths per CAD sheet it multiplies database size a
        # hundredfold — enough to blow through hosted-Postgres storage limits.
        for span in spans:
            s.add(artifact("ocr_span", span))
        for t in tables:
            s.add(artifact("ocr_table", t))
        for d in detections:
            s.add(artifact("detection", d))
        for m in masks:
            s.add(artifact("mask", m))
        for g in geometries:
            s.add(artifact("geometry", g))
        for e in exclusions:
            s.add(artifact("exclusion_region", e))
        if clear_quantities:
            keep_ids = {item.id for item in items}
            for old in s.query(QuantityRow).filter_by(project_id=project_id, sheet_id=sheet.id).all():
                if old.id in keep_ids:
                    continue
                _mark_quantity_excluded_by_scope(old)
        for item in items:
            s.merge(QuantityRow(
                id=item.id, project_id=project_id, sheet_id=sheet.id,
                item_type=item.item_type, unit=item.unit, quantity=item.quantity,
                needs_review=item.needs_review, review_status=item.review_status,
                version=item.version, data=item.model_dump(mode="json"),
            ))
