from __future__ import annotations

import time
from pathlib import Path
from types import SimpleNamespace

import fitz
import pytest
from fastapi.testclient import TestClient

from tests.fixtures.make_fixture import FT_PER_PT, PT_PER_FT


def _title_block(page, sheet_number: str):
    page.draw_rect(fitz.Rect(660, 520, 780, 600), color=(0, 0, 0), width=1.0)
    page.insert_text(fitz.Point(668, 585), sheet_number, fontsize=12)


def make_scoped_fixture(out_path: Path) -> Path:
    doc = fitz.open()

    p1 = doc.new_page(width=792, height=612)
    p1.insert_text(fitz.Point(72, 40), "FLOOR PLAN", fontsize=14)
    p1.insert_text(fitz.Point(72, 560), 'SCALE: 1/8" = 1\'-0"', fontsize=10)
    p1.draw_rect(fitz.Rect(100, 116, 190, 124), color=(0, 0, 0), width=1)
    p1.insert_text(fitz.Point(120, 98), "S2-0-6", fontsize=10)
    p1.draw_rect(fitz.Rect(240, 110, 330, 130), color=(0.55, 0.55, 0.55), fill=(0.55, 0.55, 0.55), width=0.5)
    p1.draw_line(fitz.Point(100, 150), fitz.Point(190, 150), color=(0, 0, 0), width=0.5)
    p1.insert_text(fitz.Point(122, 144), "10'-0\"", fontsize=7)
    p1.draw_rect(fitz.Rect(610, 80, 760, 104), color=(0, 0, 0), width=0.5)
    p1.insert_text(fitz.Point(618, 96), "PAPER TYPE A8.11", fontsize=8)
    _title_block(p1, "A1.00")

    p2 = doc.new_page(width=792, height=612)
    p2.insert_text(fitz.Point(72, 40), "FINISH PLAN", fontsize=14)
    p2.insert_text(fitz.Point(72, 560), 'SCALE: 1/8" = 1\'-0"', fontsize=10)
    outer = fitz.Rect(72, 72, 72 + 20 * PT_PER_FT, 72 + 10 * PT_PER_FT)
    etr = fitz.Rect(72 + 5 * PT_PER_FT, 72 + 2 * PT_PER_FT, 72 + 10 * PT_PER_FT, 72 + 7 * PT_PER_FT)
    p2.draw_rect(outer, color=(0, 0, 0), width=1.5)
    p2.draw_rect(etr, color=(0, 0, 0), width=1.0)
    for offset in range(-40, 80, 16):
        p2.draw_line(
            fitz.Point(etr.x0 + offset, etr.y1),
            fitz.Point(etr.x0 + offset + 70, etr.y0),
            color=(0, 0, 0),
            width=0.35,
        )
    p2.insert_text(fitz.Point(etr.x0 + 8, etr.y0 + 24), "ETR", fontsize=10)
    _title_block(p2, "A8.00")

    p3 = doc.new_page(width=792, height=612)
    p3.insert_text(fitz.Point(72, 80), 'WALL TYPES: S2-0-6 6" METAL STUD PARTITION', fontsize=11)
    _title_block(p3, "A9.00")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(out_path)
    doc.close()
    return out_path


def make_schedule_fixture(out_path: Path) -> Path:
    doc = fitz.open()
    page = doc.new_page(width=792, height=612)
    page.insert_text(fitz.Point(72, 40), "FINISH SCHEDULE", fontsize=14)
    page.insert_text(fitz.Point(72, 70), "ROOM FINISH SCHEDULE", fontsize=12)
    for x in (72, 160, 260, 360, 460):
        page.draw_line(fitz.Point(x, 92), fitz.Point(x, 180), color=(0, 0, 0), width=0.5)
    for y in (92, 110, 128, 146, 164, 180):
        page.draw_line(fitz.Point(72, y), fitz.Point(460, y), color=(0, 0, 0), width=0.5)
    page.insert_text(fitz.Point(82, 106), "101", fontsize=8)
    page.insert_text(fitz.Point(172, 106), "FOYER", fontsize=8)
    page.insert_text(fitz.Point(270, 106), "T01", fontsize=8)
    page.insert_text(fitz.Point(82, 124), "102", fontsize=8)
    page.insert_text(fitz.Point(172, 124), "BANQUET ROOM", fontsize=8)
    page.insert_text(fitz.Point(270, 124), "CPT01", fontsize=8)
    _title_block(page, "A8.00")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(out_path)
    doc.close()
    return out_path


def make_column_scope_fixture(out_path: Path) -> Path:
    doc = fitz.open()
    page = doc.new_page(width=792, height=612)
    page.insert_text(fitz.Point(72, 40), "FLOOR PLAN", fontsize=14)
    page.insert_text(fitz.Point(72, 560), 'SCALE: 1/8" = 1\'-0"', fontsize=10)
    page.draw_rect(fitz.Rect(120, 120, 138, 138), color=(0, 0, 0), width=1.0)
    page.draw_rect(
        fitz.Rect(180, 120, 198, 138),
        color=(0.55, 0.55, 0.55),
        fill=(0.55, 0.55, 0.55),
        width=0.5,
    )
    page.insert_text(fitz.Point(176, 112), "ETR", fontsize=8)
    _title_block(page, "A1.00")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(out_path)
    doc.close()
    return out_path


@pytest.fixture
def client(tmp_path):
    import os

    os.environ["TAKEOFF_STORAGE_ROOT"] = str(tmp_path / "data")
    os.environ["TAKEOFF_DATABASE_URL"] = "sqlite:///:memory:"

    from app.config import get_settings
    from app.db import database

    get_settings.cache_clear()
    database.reset_engine_for_tests()

    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c
    get_settings.cache_clear()
    database.reset_engine_for_tests()


def _wait(client: TestClient, job_id: str) -> dict:
    status = {}
    for _ in range(120):
        status = client.get(f"/api/jobs/{job_id}").json()
        if status["status"] in ("done", "failed"):
            return status
        time.sleep(0.1)
    return status


def test_index_then_scoped_takeoff_excludes_existing_regions(client, tmp_path):
    pdf = make_scoped_fixture(tmp_path / "scoped.pdf")
    project = client.post("/api/projects", json={"name": "Scoped"}).json()
    with open(pdf, "rb") as f:
        upload = client.post(
            f"/api/projects/{project['id']}/files",
            files={"file": ("scoped.pdf", f, "application/pdf")},
        )
    assert upload.status_code == 201

    indexed = client.post(f"/api/projects/{project['id']}/index").json()
    assert _wait(client, indexed["job_id"])["status"] == "done"
    sheets = client.get(f"/api/projects/{project['id']}/sheets").json()
    assert {s["sheet_number"] for s in sheets} == {"A1.00", "A8.00", "A9.00"}
    assert client.get(f"/api/projects/{project['id']}/quantities").json() == []

    scope = {
        "instructions": "do wall takeoffs on A1.00 and floor takeoffs on A8.00",
        "requests": [
            {"trade": "walls", "sheet_refs": ["A1.00"], "sheet_ids": [], "include_existing": False},
            {"trade": "flooring", "sheet_refs": ["A8.00"], "sheet_ids": [], "include_existing": False},
        ],
    }
    from app.db.database import session_scope
    from app.db.orm import FileRow
    from app.pipeline.orchestrator import _scoped_pages_from_index
    from app.schemas.takeoff_scope import TakeoffScope

    with session_scope() as s:
        file_row = s.query(FileRow).filter_by(project_id=project["id"]).first()
        file_ref = SimpleNamespace(storage_path=file_row.storage_path)
    assert _scoped_pages_from_index(project["id"], file_ref, TakeoffScope.model_validate(scope), 3) == [1, 2]

    processed = client.post(f"/api/projects/{project['id']}/process", json={"scope": scope}).json()
    assert _wait(client, processed["job_id"])["status"] == "done"

    quantities = client.get(f"/api/projects/{project['id']}/quantities").json()
    active = [q for q in quantities if q["review_status"] != "rejected"]
    assert {q["item_type"] for q in active} == {"wall", "flooring"}

    wall = next(q for q in active if q["item_type"] == "wall")
    assert wall["description"] == "Wall S2-0-6"
    assert wall["needs_review"] is False
    assert "low_confidence" not in wall["review_reason"]
    assert wall["attributes"]["wall_code"] == "S2-0-6"
    assert wall["attributes"]["thickness_in"] == 6
    assert "METAL STUD" in wall["attributes"]["wall_detail"]
    assert wall["quantity"] == pytest.approx(90 * FT_PER_PT, abs=0.05)

    floor = next(q for q in active if q["item_type"] == "flooring")
    assert floor["attributes"]["base_sqft"] == pytest.approx(175.0, abs=0.5)
    assert floor["quantity"] == pytest.approx(192.5, abs=0.6)

    sheet_a8 = next(s for s in sheets if s["sheet_number"] == "A8.00")
    overlay = client.get(f"/api/sheets/{sheet_a8['id']}/overlay").json()
    assert any(feature["holes"] for feature in overlay["features"] if feature["item_type"] == "flooring")


def test_unscoped_reprocess_reuses_stored_takeoff_scope(client, tmp_path):
    pdf = make_scoped_fixture(tmp_path / "stored-scope.pdf")
    project = client.post("/api/projects", json={"name": "Stored Scope"}).json()
    with open(pdf, "rb") as f:
        upload = client.post(
            f"/api/projects/{project['id']}/files",
            files={"file": ("stored-scope.pdf", f, "application/pdf")},
        )
    assert upload.status_code == 201

    indexed = client.post(f"/api/projects/{project['id']}/index").json()
    assert _wait(client, indexed["job_id"])["status"] == "done"

    scope = {
        "instructions": "do wall takeoffs on A1.00",
        "requests": [
            {"trade": "walls", "sheet_refs": ["A1.00"], "sheet_ids": [], "include_existing": False},
        ],
    }
    first = client.post(f"/api/projects/{project['id']}/process", json={"scope": scope}).json()
    assert _wait(client, first["job_id"])["status"] == "done"

    second = client.post(f"/api/projects/{project['id']}/process").json()
    assert _wait(client, second["job_id"])["status"] == "done"

    quantities = client.get(f"/api/projects/{project['id']}/quantities").json()
    active = [q for q in quantities if q["review_status"] != "rejected"]
    assert {q["item_type"] for q in active} == {"wall"}
    assert {q["page_number"] for q in active} == {1}


def test_scope_sheet_refs_match_hyphen_and_dot_variants():
    from app.schemas.takeoff_scope import TakeoffScope

    scope = TakeoffScope.model_validate({
        "instructions": "walls on A1-00",
        "requests": [
            {"trade": "walls", "sheet_refs": ["A1-00"], "sheet_ids": [], "include_existing": False},
        ],
    })

    assert scope.trades_for_sheet(sheet_id="sheet-1", sheet_number="A1.00", page_number=5) == {"walls"}


def test_scope_accepts_columns_trade():
    from app.schemas.takeoff_scope import TakeoffScope

    scope = TakeoffScope.model_validate({
        "instructions": "columns on A1.00",
        "requests": [
            {"trade": "columns", "sheet_refs": ["A1.00"], "sheet_ids": [], "include_existing": False},
        ],
    })

    assert scope.trades_for_sheet(sheet_id="sheet-1", sheet_number="A1.00", page_number=1) == {"columns"}


def test_scoped_columns_skip_existing_shaded_columns(client, tmp_path):
    pdf = make_column_scope_fixture(tmp_path / "columns.pdf")
    project = client.post("/api/projects", json={"name": "Columns"}).json()
    with open(pdf, "rb") as f:
        upload = client.post(
            f"/api/projects/{project['id']}/files",
            files={"file": ("columns.pdf", f, "application/pdf")},
        )
    assert upload.status_code == 201

    indexed = client.post(f"/api/projects/{project['id']}/index").json()
    assert _wait(client, indexed["job_id"])["status"] == "done"

    scope = {
        "instructions": "do column takeoffs on A1.00",
        "requests": [
            {"trade": "columns", "sheet_refs": ["A1.00"], "sheet_ids": [], "include_existing": False},
        ],
    }
    processed = client.post(f"/api/projects/{project['id']}/process", json={"scope": scope}).json()
    assert _wait(client, processed["job_id"])["status"] == "done"

    quantities = client.get(f"/api/projects/{project['id']}/quantities").json()
    active = [q for q in quantities if q["review_status"] != "rejected"]

    assert len(active) == 1
    assert active[0]["item_type"] == "column"
    assert active[0]["quantity"] == 1
    assert active[0]["unit"] == "EA"
    assert active[0]["attributes"]["shape"] == "square"


def test_finish_schedule_classification_overrides_architectural_prefix():
    from app.pipeline.sheet_classify import classify_sheet
    from app.schemas.core import Sheet, SheetType
    from app.schemas.ocr import OCRSpan

    sheet = Sheet(project_id="p", source_file="f", page_number=1, width_pt=792, height_pt=612)
    spans = [
        OCRSpan(sheet_id="s1", text="FINISH SCHEDULE", bbox=(72, 40, 180, 56), confidence=1.0),
        OCRSpan(sheet_id="s1", text="A8.00", bbox=(700, 560, 750, 580), confidence=1.0),
    ]

    sheet_type, _, sheet_number = classify_sheet(sheet, spans)

    assert sheet_number == "A8.00"
    assert sheet_type == SheetType.SCHEDULE


def test_schedule_headers_beat_plan_reference_notes():
    from app.pipeline.sheet_classify import classify_sheet
    from app.schemas.core import Sheet, SheetType
    from app.schemas.ocr import OCRSpan

    sheet = Sheet(project_id="p", source_file="f", page_number=1, width_pt=3024, height_pt=2160)
    spans = [
        OCRSpan(sheet_id="s1", text="FINISH SCHEDULE,", bbox=(2713, 1844, 2916, 1875), confidence=1.0),
        OCRSpan(sheet_id="s1", text="FINISH LEGEND,", bbox=(2713, 1875, 2889, 1906), confidence=1.0),
        OCRSpan(sheet_id="s1", text="ROOM FINISH SCHEDULE", bbox=(359, 456, 580, 481), confidence=1.0),
        OCRSpan(sheet_id="s1", text="REFER TO FINISH FLOOR PLAN FOR SPECIFIC FLOOR PATTERNS.", bbox=(229, 146, 533, 159), confidence=1.0),
        OCRSpan(sheet_id="s1", text="REFLECTED CEILING NOTES", bbox=(229, 160, 410, 173), confidence=1.0),
        OCRSpan(sheet_id="s1", text="A8.00", bbox=(2713, 1986, 2904, 2080), confidence=1.0),
    ]

    sheet_type, _, sheet_number = classify_sheet(sheet, spans)

    assert sheet_number == "A8.00"
    assert sheet_type == SheetType.SCHEDULE


def test_title_block_floor_plan_beats_schedule_references():
    from app.pipeline.sheet_classify import classify_sheet
    from app.schemas.core import Sheet, SheetType
    from app.schemas.ocr import OCRSpan

    sheet = Sheet(project_id="p", source_file="f", page_number=1, width_pt=3024, height_pt=2160)
    spans = [
        OCRSpan(sheet_id="s1", text="SHEET TITLE", bbox=(2713, 1827, 2783, 1843), confidence=1.0),
        OCRSpan(sheet_id="s1", text="DEMOLITION &", bbox=(2713, 1844, 2900, 1875), confidence=1.0),
        OCRSpan(sheet_id="s1", text="CONSTRUCTION", bbox=(2713, 1875, 2900, 1906), confidence=1.0),
        OCRSpan(sheet_id="s1", text="FLOOR PLANS", bbox=(2713, 1906, 2900, 1937), confidence=1.0),
        OCRSpan(sheet_id="s1", text="SHEET NUMBER", bbox=(2713, 1971, 2798, 1987), confidence=1.0),
        OCRSpan(sheet_id="s1", text="A1.00", bbox=(2713, 1986, 2904, 2080), confidence=1.0),
        OCRSpan(sheet_id="s1", text="NEW WALL, DOOR, AND WINDOW AS SCHEDULED", bbox=(100, 100, 360, 120), confidence=1.0),
        OCRSpan(sheet_id="s1", text="REFER TO DOOR SCHEDULE", bbox=(500, 500, 660, 520), confidence=1.0),
    ]

    sheet_type, _, sheet_number = classify_sheet(sheet, spans)

    assert sheet_number == "A1.00"
    assert sheet_type == SheetType.ARCHITECTURAL_PLAN


def test_title_block_finish_plan_beats_finish_schedule_notes():
    from app.pipeline.sheet_classify import classify_sheet
    from app.schemas.core import Sheet, SheetType
    from app.schemas.ocr import OCRSpan

    sheet = Sheet(project_id="p", source_file="f", page_number=1, width_pt=3024, height_pt=2160)
    spans = [
        OCRSpan(sheet_id="s1", text="SHEET TITLE", bbox=(2713, 1827, 2783, 1843), confidence=1.0),
        OCRSpan(sheet_id="s1", text="FINISH PLAN AND", bbox=(2713, 1844, 2915, 1875), confidence=1.0),
        OCRSpan(sheet_id="s1", text="REFLECTED CEILING", bbox=(2713, 1875, 2915, 1906), confidence=1.0),
        OCRSpan(sheet_id="s1", text="PLAN", bbox=(2713, 1906, 2790, 1937), confidence=1.0),
        OCRSpan(sheet_id="s1", text="SHEET NUMBER", bbox=(2713, 1971, 2798, 1987), confidence=1.0),
        OCRSpan(sheet_id="s1", text="A8.10", bbox=(2713, 1986, 2904, 2080), confidence=1.0),
        OCRSpan(sheet_id="s1", text="REFER TO FINISH SCHEDULE FOR PRODUCTS", bbox=(228, 146, 600, 159), confidence=1.0),
    ]

    sheet_type, _, sheet_number = classify_sheet(sheet, spans)

    assert sheet_number == "A8.10"
    assert sheet_type == SheetType.FINISH_PLAN


def test_scoped_flooring_on_finish_schedule_does_not_measure_table_cells(client, tmp_path):
    pdf = make_schedule_fixture(tmp_path / "schedule.pdf")
    project = client.post("/api/projects", json={"name": "Schedule"}).json()
    with open(pdf, "rb") as f:
        upload = client.post(
            f"/api/projects/{project['id']}/files",
            files={"file": ("schedule.pdf", f, "application/pdf")},
        )
    assert upload.status_code == 201

    indexed = client.post(f"/api/projects/{project['id']}/index").json()
    assert _wait(client, indexed["job_id"])["status"] == "done"
    sheets = client.get(f"/api/projects/{project['id']}/sheets").json()
    assert sheets[0]["sheet_number"] == "A8.00"
    assert sheets[0]["sheet_type"] == "schedule"

    scope = {
        "instructions": "do floor takeoffs on A8.00",
        "requests": [
            {"trade": "flooring", "sheet_refs": ["A8.00"], "sheet_ids": [], "include_existing": False},
        ],
    }
    processed = client.post(f"/api/projects/{project['id']}/process", json={"scope": scope}).json()
    assert _wait(client, processed["job_id"])["status"] == "done"

    quantities = client.get(f"/api/projects/{project['id']}/quantities").json()
    assert [q for q in quantities if q["review_status"] != "rejected"] == []


def test_wall_reference_detail_prefers_schedule_row_text():
    from app.pipeline.orchestrator import _row_local_wall_detail

    spans = [
        {"sheet_id": "s1", "text": "TYPE S2 - 4", "bbox": (631.6, 732.7, 737.2, 759.9)},
        {
            "sheet_id": "s1",
            "text": '3 5/8" METAL STUD NON-BEARING PARTITION - GWB ON BOTH SIDES',
            "bbox": (631.6, 756.6, 1050.7, 773.6),
        },
        {"sheet_id": "s1", "text": "PARTITION", "bbox": (631.6, 778.6, 685.4, 792.2)},
        {"sheet_id": "s1", "text": "UNIT", "bbox": (760.2, 778.6, 785.0, 792.2)},
        {"sheet_id": "s1", "text": "SIZE", "bbox": (760.7, 789.8, 781.8, 803.5)},
        {"sheet_id": "s1", "text": "S2-0-4", "bbox": (631.6, 803.2, 669.1, 820.3)},
        {"sheet_id": "s1", "text": '3 5/8"', "bbox": (758.9, 805.6, 783.4, 818.6)},
        {"sheet_id": "s1", "text": "40", "bbox": (856.0, 805.6, 866.5, 818.6)},
        {"sheet_id": "s1", "text": "H1", "bbox": (900.1, 805.6, 912.3, 818.6)},
        {"sheet_id": "s1", "text": "B1", "bbox": (945.4, 805.6, 957.0, 818.6)},
    ]

    detail, unit_size, score = _row_local_wall_detail("S2-0-4", spans[5], spans)

    assert "TYPE S2 - 4" in detail
    assert "METAL STUD" in detail
    assert "S2-0-4" in detail
    assert unit_size == pytest.approx(3.625)
    assert score > 0


def test_wall_schedule_unit_size_is_authoritative_over_nominal_code_suffix():
    from app.pipeline.orchestrator import _wall_dimension_metadata

    scheduled = _wall_dimension_metadata("S2-0-4", 3.625)
    fallback = _wall_dimension_metadata("S2-0-4", None)

    assert scheduled == {
        "thickness_in": 3.625,
        "thickness_basis": "wall_schedule_unit_size",
        "nominal_code_thickness_in": 4.0,
    }
    assert fallback == {
        "thickness_in": 4.0,
        "thickness_basis": "nominal_wall_code",
        "nominal_code_thickness_in": 4.0,
    }


def test_wall_schedule_and_scale_set_drawing_thickness_cap():
    from app.pipeline.orchestrator import _max_wall_thickness_pt
    from app.schemas.scale import ScaleCalibration, ScaleSource

    scale = ScaleCalibration(
        sheet_id="s1",
        source=ScaleSource.SCALE_NOTE,
        ft_per_pt=1 / 13.5,
        confidence=1.0,
    )

    cap = _max_wall_thickness_pt(scale, {
        "S2-0-6": {"unit_size_in": 6.0},
        "S1-0-4": {"unit_size_in": 3.625},
    })

    assert cap == pytest.approx(20.25)


def test_finish_plan_floor_area_label_total_uses_selected_view_only():
    from app.pipeline.orchestrator import _floor_area_label_total
    from app.schemas.detection import DetectedObject
    from app.schemas.ocr import OCRSpan

    spans = [
        OCRSpan(sheet_id="s1", text="330 SF", bbox=(100, 160, 140, 176), confidence=1.0),
        OCRSpan(sheet_id="s1", text="1,361 SF", bbox=(300, 180, 350, 196), confidence=1.0),
        OCRSpan(sheet_id="s1", text="150 SF", bbox=(900, 100, 940, 116), confidence=1.0),
        OCRSpan(sheet_id="s1", text="GROSS SF OF PROJECT AREA: 3,504 SF", bbox=(20, 20, 220, 36), confidence=1.0),
    ]
    detections = [
        DetectedObject(
            sheet_id="s1",
            label="floor_area",
            bbox=(50, 120, 700, 300),
            confidence=0.8,
            detector="vector_heuristic",
        )
    ]

    total = _floor_area_label_total(spans, detections)

    assert total is not None
    assert total[0] == pytest.approx(1691.0)
    assert len(total[1]) == 2
