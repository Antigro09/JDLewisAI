"""Regression on the second real plan set (takeofftest1.pdf, ArchiCAD export,
church renovation). Its conventions differ from testmain.pdf on purpose:
boxed/bare single-letter wall tags keyed to an A.103 "WALL TYPES" schedule,
X-prefixed EXISTING wall types with their own repair scope, demolition on
separate D-sheets, and structural grid bubbles that reuse the same letters.

Golden numbers verified by visual audit of the First Floor Plan (page 20):
new work concentrates in the south wing (bathrooms/kitchen/mech) and the
elevator/stair core; the sanctuary and its brick shell are existing.
"""

from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from shapely.geometry import Polygon

from app.config import Settings
from app.geometry.engine import GeometryEngine
from app.geometry.linework import detect_metadata_boxes
from app.geometry.walls import extend_rect_bands
from app.ingestion.pdf_pymupdf import PyMuPDFIngestor
from app.pipeline.candidates import _trade_drawing_boxes, run_candidates
from app.pipeline.measure import measure_area_item
from app.pipeline.orchestrator import (
    _WALL_CODE_RE,
    _apply_reference_floor_areas,
    _attribute_wall_code,
    _door_schedule_entries,
    _floor_style,
    _group_flooring_items,
    _harvest_wall_types_schedule,
    _max_wall_thickness_pt,
    _min_wall_thickness_pt,
    _normalize_floor_material,
    _room_area_entries,
    _wall_is_annotation_or_window_frame,
)
from app.pipeline.scale_calibration import resolve_scale
from app.pipeline.sheet_classify import classify_sheet
from app.pipeline.wall_tags import find_tag_spans, tag_anchors
from app.schemas.core import SheetType

T1 = Path(__file__).resolve().parents[1] / "takeofftest1.pdf"


class _NoDetections:
    def detect(self, *_args, **_kwargs):
        return []


class _NoMasks:
    def segment(self, *_args, **_kwargs):
        return []


def _harvest_catalog(ingestor: PyMuPDFIngestor) -> dict:
    sched_spans = [
        span.model_dump(mode="json") for span in ingestor.extract_text_spans(T1, 7, "sched")
    ]
    text = " ".join(span.get("text", "") for span in sched_spans)
    wall_types: dict = {}
    _harvest_wall_types_schedule(sched_spans, "sched", None, text, wall_types)
    for row in wall_types.values():
        row.pop("_score", None)
    return wall_types


def test_takeofftest1_wall_types_schedule_harvest():
    wall_types = _harvest_catalog(PyMuPDFIngestor())

    # new framed partitions with stud sizes read from the schedule
    assert wall_types["A"]["unit_size_in"] == pytest.approx(3.5)
    assert wall_types["B"]["unit_size_in"] == pytest.approx(3.5)
    assert wall_types["E"]["unit_size_in"] == pytest.approx(3.5)
    assert wall_types["F"]["unit_size_in"] == pytest.approx(5.5)
    assert wall_types["M"]["unit_size_in"] == pytest.approx(5.5)
    assert wall_types["N"]["unit_size_in"] == pytest.approx(2.5)
    # height variants named in the captions become tags in their own right
    assert {"A2", "A8", "B4", "B8"} <= set(wall_types)
    # X-prefixed types are EXISTING (repair scope, never new LF)
    for code in ("X1", "X2", "X3", "X4"):
        assert wall_types[code]["existing"] is True, code
    assert all(not wall_types[c].get("existing") for c in ("A", "B", "E", "F", "G", "M", "N"))


def test_takeofftest1_reference_notes_do_not_pollute_wall_catalog():
    ingestor = PyMuPDFIngestor()
    wall_types = _harvest_catalog(ingestor)

    for page_number in (8, 11):
        spans = [
            span.model_dump(mode="json")
            for span in ingestor.extract_text_spans(T1, page_number, f"p{page_number}")
        ]
        _harvest_wall_types_schedule(
            spans,
            f"p{page_number}",
            None,
            " ".join(span.get("text", "") for span in spans),
            wall_types,
        )

    assert "S" not in wall_types  # electrical symbol on A.104
    assert not {"W02", "W15", "W18"} & set(wall_types)  # window marks on A.107


def test_takeofftest1_demolition_and_life_safety_sheets_are_not_takeoff_targets():
    ingestor = PyMuPDFIngestor()
    # page 14 = D.202 FIRST FLOOR DEMOLITION PLAN, page 3 = LS.200 LIFE SAFETY
    demo_sheet = ingestor.extract_sheet(T1, 14, "p", "takeofftest1.pdf")
    demo_type, _, demo_number = classify_sheet(
        demo_sheet, ingestor.extract_text_spans(T1, 14, demo_sheet.id)
    )
    assert demo_type == SheetType.DEMOLITION_PLAN

    ls_sheet = ingestor.extract_sheet(T1, 3, "p", "takeofftest1.pdf")
    ls_type, _, _ = classify_sheet(ls_sheet, ingestor.extract_text_spans(T1, 3, ls_sheet.id))
    assert ls_type == SheetType.LIFE_SAFETY


def _first_floor_wall_takeoff(
    requested_trades: set[str],
    door_schedule: dict | None = None,
) -> tuple[dict[str, list[float]], list]:
    ingestor = PyMuPDFIngestor()
    wall_types = _harvest_catalog(ingestor)

    sheet = ingestor.extract_sheet(T1, 20, "p", "takeofftest1.pdf")
    spans = ingestor.extract_text_spans(T1, 20, sheet.id)
    paths = ingestor.extract_vector_paths(T1, 20, sheet.id)
    scale = resolve_scale(sheet, spans, pdf_metadata_ft_per_pt=ingestor.scale_metadata(T1, 20))
    assert scale.usable

    detections, _, geometries, _ = run_candidates(
        np.zeros((1, 1), dtype=np.uint8),
        sheet.id,
        1.0,
        _NoDetections(),
        _NoMasks(),
        GeometryEngine(),
        vector_paths=paths,
        ocr_spans=spans,
        include_existing=False,
        requested_trades=requested_trades,
        door_schedule=door_schedule,
        max_wall_thickness_pt=_max_wall_thickness_pt(scale, wall_types),
        min_wall_thickness_pt=_min_wall_thickness_pt(scale, wall_types),
        wall_types=wall_types,
    )
    anchors = tag_anchors(
        find_tag_spans(spans, _WALL_CODE_RE, lexicon=wall_types, vector_paths=paths), paths
    )
    by_id = {d.id: d for d in detections}
    walls = [
        g for g in geometries
        if any(by_id.get(i) is not None and by_id[i].label == "wall" for i in g.derived_from)
    ]

    prepass_existing = []
    for geom in walls:
        if geom.kind != "polygon":
            continue
        code, _s, _b, _r = _attribute_wall_code(anchors, geom, scale, wall_types)
        if wall_types.get(code, {}).get("existing"):
            prepass_existing.append(Polygon(geom.exterior))
    bands = extend_rect_bands(prepass_existing)
    assert prepass_existing, "the brick shell and historic partitions must attribute as existing"

    by_code: dict[str, list[float]] = {}
    for geom in walls:
        code, _s, basis, _r = _attribute_wall_code(anchors, geom, scale, wall_types)
        if wall_types.get(code, {}).get("existing"):
            continue
        if geom.kind == "polygon" and bands:
            probe = Polygon(geom.exterior)
            if probe.is_valid and any(
                band.intersection(probe).area >= 0.6 * probe.area for band in bands
            ):
                continue  # glazing/frames in existing-wall openings
        if _wall_is_annotation_or_window_frame(geom, spans, basis):
            continue
        by_code.setdefault(code or "UNTYPED", []).append(
            geom.length_pt * scale.ft_per_pt
        )
    return by_code, detections


def test_takeofftest1_first_floor_new_wall_takeoff():
    by_code, _ = _first_floor_wall_takeoff({"walls"})

    # Verified 2026-07-11 after excluding Wxx window bays, label backdrops,
    # title strips, compact callouts, and X-prefixed existing wall assemblies.
    counts = {code: len(values) for code, values in by_code.items()}
    assert counts == {
        "A": 30,
        "A2": 9,
        "B": 6,
        "F": 11,
        "M": 16,
        "N": 1,
        "UNTYPED": 1,
    }
    expected_lf = {
        "A": 180.91,
        "A2": 33.77,
        "B": 19.56,
        "F": 35.75,
        "M": 73.42,
        "N": 0.52,
        "UNTYPED": 1.85,
    }
    for code, lf in expected_lf.items():
        assert sum(by_code[code]) == pytest.approx(lf, abs=0.06), code
    total = sum(sum(values) for values in by_code.values())
    assert total == pytest.approx(345.79, abs=0.3)


def test_takeofftest1_walls_do_not_change_when_doors_are_requested_too():
    ingestor = PyMuPDFIngestor()
    schedule = _door_schedule_entries([
        span.model_dump(mode="json")
        for span in ingestor.extract_text_spans(T1, 10, "doors")
    ])

    walls_only, _ = _first_floor_wall_takeoff({"walls"})
    with_doors, detections = _first_floor_wall_takeoff({"walls", "doors"}, schedule)

    assert {
        code: (len(values), round(sum(values), 2)) for code, values in with_doors.items()
    } == {
        code: (len(values), round(sum(values), 2)) for code, values in walls_only.items()
    }
    assert len([detection for detection in detections if detection.label == "door"]) == 13


def test_takeofftest1_title_strip_does_not_swallow_repeated_w20_plan_marks():
    ingestor = PyMuPDFIngestor()
    sheet = ingestor.extract_sheet(T1, 20, "p", "takeofftest1.pdf")
    spans = ingestor.extract_text_spans(T1, 20, sheet.id)
    paths = ingestor.extract_vector_paths(T1, 20, sheet.id)

    boxes = detect_metadata_boxes(paths, spans)

    assert any(x0 >= 2800 and y0 == 0 and y1 >= 2150 for x0, y0, _x1, y1 in boxes)
    assert not any(x0 < 2700 and y1 - y0 > 1000 for x0, y0, _x1, y1 in boxes)


def test_takeofftest1_finish_plan_uses_room_areas_and_exact_carpet_regions():
    ingestor = PyMuPDFIngestor()
    room_areas = []
    for page_number in (19, 20, 21):
        ref_sheet = ingestor.extract_sheet(T1, page_number, "p", "takeofftest1.pdf")
        ref_spans = ingestor.extract_text_spans(T1, page_number, ref_sheet.id)
        ref_sheet.sheet_type, _, ref_sheet.sheet_number = classify_sheet(ref_sheet, ref_spans)
        room_areas.extend(_room_area_entries(
            [span.model_dump(mode="json") for span in ref_spans],
            SimpleNamespace(
                id=ref_sheet.id,
                sheet_type=ref_sheet.sheet_type.value,
                sheet_number=ref_sheet.sheet_number,
                page_number=page_number,
            ),
            " ".join(span.text for span in ref_spans),
        ))

    sheet = ingestor.extract_sheet(T1, 33, "p", "takeofftest1.pdf")
    spans = ingestor.extract_text_spans(T1, 33, sheet.id)
    sheet.sheet_type, _, sheet.sheet_number = classify_sheet(sheet, spans)
    paths = ingestor.extract_vector_paths(T1, 33, sheet.id)
    scale = resolve_scale(sheet, spans, pdf_metadata_ft_per_pt=ingestor.scale_metadata(T1, 33))
    drawing_boxes = _trade_drawing_boxes(spans, sheet.width_pt, sheet.height_pt, {"flooring"})
    assert len(drawing_boxes) == 1
    assert drawing_boxes[0][0] < 200 and drawing_boxes[0][2] < 2850

    detections, _, geometries, _ = run_candidates(
        np.zeros((1, 1), dtype=np.uint8),
        sheet.id,
        1.0,
        _NoDetections(),
        _NoMasks(),
        GeometryEngine(),
        vector_paths=paths,
        ocr_spans=spans,
        include_existing=False,
        requested_trades={"flooring"},
    )
    by_id = {detection.id: detection for detection in detections}
    items = []
    for geometry in geometries:
        detection = next(
            (by_id[source] for source in geometry.derived_from if source in by_id),
            None,
        )
        if detection is None or detection.label not in {"floor_area", "room"}:
            continue
        item = measure_area_item(
            project_id="project",
            sheet=sheet,
            geometry=geometry,
            scale=scale,
            detection=detection,
            item_type="flooring",
            settings=Settings(),
        )
        if detection.material_ref:
            material = _normalize_floor_material(detection.material_ref)
            item.attributes["floor_code"] = material
            item.description = f"{material.title()} flooring"
            item.overlay_style = _floor_style(material)
        items.append(item)

    items = _group_flooring_items(items, sheet.id)
    items = _apply_reference_floor_areas(
        items,
        spans,
        {"room_areas": room_areas},
        sheet,
        scale,
        detections,
    )
    base_by_material = {
        item.attributes["floor_code"]: item.quantity
        for item in items
        if item.item_type == "flooring"
    }

    assert base_by_material == pytest.approx({
        "CPT TILE": 142.0,
        "TILE": 1001.0,
        "QUARRY TILE": 238.0,
        "VCT": 201.0,
        "WOOD": 6511.1,
        "BROADLOOM CARPET": 705.0,
        "BROADLOOM CARPET RUNNER": 621.9,
    }, abs=0.1)
    assert sum(base_by_material.values()) == pytest.approx(9420.0, abs=0.1)
    assert sum(item.attributes.get("matched_room_count", 0) for item in items) == 18
    source_counts = {
        item.attributes["floor_code"]: len(item.source_geometry_ids)
        for item in items
        if item.item_type == "flooring"
    }
    assert source_counts["BROADLOOM CARPET"] == 2  # exact polygon + room finish tag
    assert source_counts["BROADLOOM CARPET RUNNER"] == 3  # three exact polygons
    assert source_counts["TILE"] == 6  # one finish tag per matched room
    assert not [detection for detection in detections if "column" in detection.label]
