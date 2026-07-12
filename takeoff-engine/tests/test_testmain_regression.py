from collections import defaultdict
from pathlib import Path

import numpy as np
import pytest
from shapely.geometry import Polygon, box

from app.geometry.engine import GeometryEngine
from app.geometry.exclusions import exclusion_polygons
from app.geometry.linework import filter_measurement_paths
from app.ingestion.pdf_pymupdf import PyMuPDFIngestor
from app.pipeline.candidates import (
    _new_work_drawing_boxes,
    _trade_drawing_boxes,
    _vector_door_detections,
    run_candidates,
)
from app.pipeline.measure import count_symbols
from app.pipeline.orchestrator import (
    _WALL_CODE_RE,
    _attribute_wall_code,
    _door_schedule_entries,
    _floor_area_label_total,
    _geometry_is_excluded,
    _max_wall_thickness_pt,
    _min_wall_thickness_pt,
    _row_local_wall_detail,
    _wall_dimension_metadata,
)
from app.pipeline.scale_calibration import resolve_scale
from app.pipeline.wall_tags import find_tag_spans, tag_anchors
from app.schemas.detection import DetectedObject
from app.schemas.detection import DetectedObject as _Det
from app.schemas.scale import ScaleCalibration, ScaleSource

TESTMAIN = Path(__file__).resolve().parents[1] / "testmain.pdf"


class _NoDetections:
    def detect(self, *_args, **_kwargs):
        return []


class _NoMasks:
    def segment(self, *_args, **_kwargs):
        return []


def test_testmain_door_schedule_and_construction_plan_reconcile():
    ingestor = PyMuPDFIngestor()
    schedule_spans = ingestor.extract_text_spans(TESTMAIN, 7, "schedule")
    schedule = _door_schedule_entries([
        span.model_dump(mode="json") for span in schedule_spans
    ])

    assert len(schedule) == 20
    assert schedule["100A"]["existing"] is True
    assert all(not row["existing"] for code, row in schedule.items() if code != "100A")

    sheet = ingestor.extract_sheet(TESTMAIN, 5, "project", "testmain.pdf")
    spans = ingestor.extract_text_spans(TESTMAIN, 5, "plan")
    paths = ingestor.extract_vector_paths(TESTMAIN, 5, "plan")
    drawing_boxes = _new_work_drawing_boxes(spans, sheet.width_pt, sheet.height_pt)
    measurement_paths = filter_measurement_paths(
        paths,
        drawing_boxes=drawing_boxes,
        exclusion_boxes=[],
    )

    detections = _vector_door_detections(
        sheet_id="plan",
        vector_paths=measurement_paths,
        spans=spans,
        drawing_boxes=drawing_boxes,
        # 112B sits at the edge of an ETR corridor, but its schedule row calls
        # for a new door in an existing frame. Schedule semantics must win.
        excluded_polys=[box(2500, 1580, 2600, 1700)],
        door_schedule=schedule,
        include_existing=False,
    )
    refs = [d.schedule_ref for d in detections]

    assert len(refs) == 19
    assert len(set(refs)) == 19
    assert "100A" not in refs
    assert {"105B", "105D", "112B"} <= set(refs)

    scale = ScaleCalibration(
        sheet_id=sheet.id,
        source=ScaleSource.MANUAL,
        ft_per_pt=1.0,
        confidence=1.0,
    )
    item = count_symbols(
        project_id="project",
        sheet=sheet,
        detections=detections,
        label="door",
        scale=scale,
        exclude_polygons=[box(2500, 1580, 2600, 1700)],
    )

    assert item is not None
    assert item.quantity == 19
    assert item.description == "Doors (scheduled openings)"
    assert item.attributes["count_basis"] == "scheduled_plan_marks"


def test_testmain_can_include_existing_door_when_explicitly_requested():
    ingestor = PyMuPDFIngestor()
    schedule = _door_schedule_entries([
        span.model_dump(mode="json")
        for span in ingestor.extract_text_spans(TESTMAIN, 7, "schedule")
    ])
    sheet = ingestor.extract_sheet(TESTMAIN, 5, "project", "testmain.pdf")
    spans = ingestor.extract_text_spans(TESTMAIN, 5, "plan")
    drawing_boxes = _new_work_drawing_boxes(spans, sheet.width_pt, sheet.height_pt)
    paths = filter_measurement_paths(
        ingestor.extract_vector_paths(TESTMAIN, 5, "plan"),
        drawing_boxes=drawing_boxes,
        exclusion_boxes=[],
    )

    detections = _vector_door_detections(
        sheet_id="plan",
        vector_paths=paths,
        spans=spans,
        drawing_boxes=drawing_boxes,
        excluded_polys=[],
        door_schedule=schedule,
        include_existing=True,
    )

    assert len(detections) == 20
    assert {d.schedule_ref for d in detections} == set(schedule)


_TESTMAIN_WALL_TYPES = {
    "S1-0-3": {"unit_size_in": 2.5},
    "S1-0-4": {"unit_size_in": 3.625},
    "S2-0-4": {"unit_size_in": 3.625},
    "S2-0-6": {"unit_size_in": 6.0},
}


def _extract_testmain_walls(detector, wall_types=None):
    wall_types = wall_types or _TESTMAIN_WALL_TYPES
    ingestor = PyMuPDFIngestor()
    sheet = ingestor.extract_sheet(TESTMAIN, 5, "project", "testmain.pdf")
    spans = ingestor.extract_text_spans(TESTMAIN, 5, sheet.id)
    paths = ingestor.extract_vector_paths(TESTMAIN, 5, sheet.id)
    scale = resolve_scale(
        sheet, spans, pdf_metadata_ft_per_pt=ingestor.scale_metadata(TESTMAIN, 5)
    )
    detections, _, geometries, exclusions = run_candidates(
        np.zeros((1, 1), dtype=np.uint8),
        sheet.id,
        1.0,
        detector,
        _NoMasks(),
        GeometryEngine(),
        vector_paths=paths,
        ocr_spans=spans,
        include_existing=False,
        requested_trades={"walls", "columns"},
        max_wall_thickness_pt=_max_wall_thickness_pt(scale, wall_types),
        min_wall_thickness_pt=_min_wall_thickness_pt(scale, wall_types),
        wall_types=wall_types,
    )
    anchors = tag_anchors(
        find_tag_spans(spans, _WALL_CODE_RE, lexicon=wall_types, vector_paths=paths),
        paths,
    )
    return sheet, spans, scale, detections, geometries, exclusions, anchors


def test_testmain_wall_network_matches_verified_takeoff():
    """Golden numbers verified by visual audit against the construction plan:
    every counted segment sits on a NEW partition per the sheet's key (hollow
    heavy pairs / leader-tagged), existing gray/hatched walls excluded. The
    independent vector-statistics estimate for this sheet is ~229 LF (205-250).
    """
    sheet, spans, scale, detections, geometries, exclusions, anchors = _extract_testmain_walls(
        _NoDetections()
    )

    drawing_box = _new_work_drawing_boxes(spans, sheet.width_pt, sheet.height_pt)[0]
    detection_by_id = {d.id: d for d in detections}
    grouped: dict[str, list[float]] = defaultdict(list)
    wall_polygons = []
    column_geometries = []
    for geometry in geometries:
        detection = next(
            (detection_by_id[source] for source in geometry.derived_from if source in detection_by_id),
            None,
        )
        if detection is None:
            continue
        if detection.label == "wall":
            code, _span, _basis, _review = _attribute_wall_code(
                anchors, geometry, scale, _TESTMAIN_WALL_TYPES
            )
            assert code, "every wall on this sheet attributes to a scheduled type"
            grouped[code].append(geometry.length_pt * scale.ft_per_pt)
            wall_polygons.append(Polygon(geometry.exterior))
        elif detection.label in {"square_column", "round_column"}:
            column_geometries.append(geometry)

    # Verified 2026-07-10 with opening bridging ON: runs measure THROUGH
    # door/window openings and extend to meet adjacent/existing walls, the way
    # the customer's manual takeoff measures.
    assert {code: len(values) for code, values in grouped.items()} == {
        "S1-0-3": 8,
        "S1-0-4": 14,
        "S2-0-4": 17,
        "S2-0-6": 24,
    }
    expected_lf = {
        "S1-0-3": 11.28,
        "S1-0-4": 51.09,
        "S2-0-4": 109.37,
        "S2-0-6": 107.95,
    }
    for code, lf in expected_lf.items():
        assert sum(grouped[code]) == pytest.approx(lf, abs=0.05), code
    total = sum(sum(values) for values in grouped.values())
    assert total == pytest.approx(279.74, abs=0.25)
    assert len(wall_polygons) == 63
    assert all(
        poly.area == pytest.approx(poly.minimum_rotated_rectangle.area, rel=0.02)
        for poly in wall_polygons
    )
    assert all(
        drawing_box[0] <= poly.centroid.x <= drawing_box[2]
        and drawing_box[1] <= poly.centroid.y <= drawing_box[3]
        for poly in wall_polygons
    )
    assert {region.reason for region in exclusions} == {
        "etr_text",
        "gray_fill",
        "hatch_fill",
        "shaded_existing_wall",
    }
    excluded = exclusion_polygons(exclusions)
    assert column_geometries
    assert all(_geometry_is_excluded(geometry, excluded) for geometry in column_geometries)


class _GarbageOpenVocabDetector:
    """Simulates GroundingDINO on a CAD sheet: low-confidence mislabeled boxes,
    including exclusion-class labels smeared across the drawing itself."""

    def detect(self, _image, sheet_id, _px_per_pt, _vocabulary=None):
        return [
            # a "schedule" box covering the whole construction view — if
            # honored, it would veto every wall's linework
            _Det(sheet_id=sheet_id, label="schedule", bbox=(700.0, 1150.0, 2690.0, 1900.0), confidence=0.24, detector="grounding-dino"),
            _Det(sheet_id=sheet_id, label="notes", bbox=(30.0, 20.0, 3000.0, 2140.0), confidence=0.22, detector="grounding-dino"),
            _Det(sheet_id=sheet_id, label="wall", bbox=(30.0, 20.0, 2995.0, 2145.0), confidence=0.25, detector="grounding-dino"),
            _Det(sheet_id=sheet_id, label="window", bbox=(120.0, 340.0, 250.0, 380.0), confidence=0.34, detector="grounding-dino"),
        ]


def test_testmain_walls_survive_open_vocab_detector_garbage():
    """The real detector's mislabeled low-confidence regions must never erase
    the vector wall takeoff (the zero-walls failure mode)."""
    _, _, scale, _, base_geometries, _, _ = _extract_testmain_walls(_NoDetections())
    _, _, _, detections, geometries, _, _ = _extract_testmain_walls(_GarbageOpenVocabDetector())

    base_total = sum(g.length_pt for g in base_geometries if g.length_pt > 0)
    with_garbage_total = sum(g.length_pt for g in geometries if g.length_pt > 0)
    assert with_garbage_total == pytest.approx(base_total, rel=0.001)
    # the raw model detections are preserved as artifacts, not silently dropped
    assert any(d.detector == "grounding-dino" for d in detections)


def test_testmain_nominal_only_detail_codes_do_not_relabel_walls_by_size():
    noisy_catalog = {
        **_TESTMAIN_WALL_TYPES,
        "A2-0-4": {"thickness_in": 4.0, "thickness_basis": "nominal_wall_code"},
        "C1-1-6": {"thickness_in": 6.0, "thickness_basis": "nominal_wall_code"},
    }
    _, _, scale, detections, geometries, _, anchors = _extract_testmain_walls(
        _NoDetections(),
        noisy_catalog,
    )
    by_id = {detection.id: detection for detection in detections}
    grouped: dict[str, list[float]] = defaultdict(list)
    for geometry in geometries:
        detection = next(
            (by_id[source] for source in geometry.derived_from if source in by_id),
            None,
        )
        if detection is None or detection.label != "wall":
            continue
        code, _span, _basis, _review = _attribute_wall_code(
            anchors,
            geometry,
            scale,
            noisy_catalog,
        )
        grouped[code].append(geometry.length_pt * scale.ft_per_pt)

    assert not {"A2-0-4", "C1-1-6"} & set(grouped)
    assert {code: len(values) for code, values in grouped.items()} == {
        "S1-0-3": 8,
        "S1-0-4": 14,
        "S2-0-4": 17,
        "S2-0-6": 24,
    }


def test_testmain_finish_plan_uses_only_in_scope_room_area_labels():
    ingestor = PyMuPDFIngestor()
    sheet = ingestor.extract_sheet(TESTMAIN, 14, "project", "testmain.pdf")
    spans = ingestor.extract_text_spans(TESTMAIN, 14, sheet.id)
    drawing_boxes = _trade_drawing_boxes(
        spans,
        sheet.width_pt,
        sheet.height_pt,
        {"flooring"},
    )
    assert len(drawing_boxes) == 1
    detection = DetectedObject(
        sheet_id=sheet.id,
        label="floor_area",
        bbox=drawing_boxes[0],
        confidence=1.0,
        detector="vector_heuristic",
    )

    total = _floor_area_label_total(spans, [detection])

    assert total is not None
    sqft, span_ids = total
    selected = {
        int(span.text.upper().replace("SF", "").replace(",", "").strip())
        for span in spans
        if span.id in span_ids
    }
    assert sqft == 3354
    assert len(span_ids) == 13
    assert selected == {30, 35, 58, 70, 78, 136, 150, 175, 198, 201, 330, 532, 1361}


def test_testmain_floor_polygons_subtract_columns_and_existing_regions():
    ingestor = PyMuPDFIngestor()
    sheet = ingestor.extract_sheet(TESTMAIN, 14, "project", "testmain.pdf")
    spans = ingestor.extract_text_spans(TESTMAIN, 14, sheet.id)
    detections, _, geometries, exclusions = run_candidates(
        np.zeros((1, 1), dtype=np.uint8),
        sheet.id,
        1.0,
        _NoDetections(),
        _NoMasks(),
        GeometryEngine(),
        vector_paths=ingestor.extract_vector_paths(TESTMAIN, 14, sheet.id),
        ocr_spans=spans,
        include_existing=False,
        requested_trades={"flooring"},
    )
    detection_by_id = {d.id: d for d in detections}
    floors = []
    columns = []
    for geometry in geometries:
        detection = next(
            (detection_by_id[source] for source in geometry.derived_from if source in detection_by_id),
            None,
        )
        if detection is None:
            continue
        polygon = Polygon(geometry.exterior, geometry.holes)
        if detection.label in {"floor_area", "room"}:
            floors.append(polygon)
        elif detection.label in {"square_column", "round_column"}:
            columns.append(polygon)

    excluded = exclusion_polygons(exclusions)
    assert len(floors) == 9
    assert sum(len(poly.interiors) for poly in floors) == 12
    assert len(columns) == 24
    assert not any(
        floor.covers(column.representative_point())
        for floor in floors
        for column in columns
    )
    assert all(
        sum(floor.intersection(region).area for region in excluded) == pytest.approx(0.0)
        for floor in floors
    )


def test_testmain_wall_schedule_supplies_actual_unit_sizes():
    ingestor = PyMuPDFIngestor()
    spans = [
        span.model_dump(mode="json")
        for span in ingestor.extract_text_spans(TESTMAIN, 6, "wall-schedule")
    ]
    expected = {
        "S1-0-3": 2.5,
        "S1-0-4": 3.625,
        "S2-0-4": 3.625,
        "S2-0-6": 6.0,
    }

    for code, expected_size in expected.items():
        candidates = [
            _row_local_wall_detail(code, span, spans)
            for span in spans
            if code in str(span.get("text", "")).upper()
        ]
        assert candidates
        _, unit_size, _ = max(candidates, key=lambda candidate: candidate[2])
        assert unit_size == pytest.approx(expected_size)
        metadata = _wall_dimension_metadata(code, unit_size)
        assert metadata["thickness_in"] == pytest.approx(expected_size)
        assert metadata["thickness_basis"] == "wall_schedule_unit_size"
