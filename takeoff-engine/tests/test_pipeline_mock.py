"""End-to-end: synthetic fixture PDF → full pipeline with mock adapters →
quantities + exports + review, all through the FastAPI app. No models, no
Postgres (in-memory SQLite), no network."""

import pytest
from fastapi.testclient import TestClient

from tests.fixtures.make_fixture import FT_PER_PT, make_fixture


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    import os

    tmp = tmp_path_factory.mktemp("e2e")
    os.environ["TAKEOFF_STORAGE_ROOT"] = str(tmp / "data")
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


@pytest.fixture(scope="module")
def processed_project(client, tmp_path_factory):
    pdf = make_fixture(tmp_path_factory.mktemp("fixture") / "plan.pdf")

    project = client.post("/api/projects", json={"name": "E2E Test"}).json()
    with open(pdf, "rb") as f:
        r = client.post(
            f"/api/projects/{project['id']}/files",
            files={"file": ("plan.pdf", f, "application/pdf")},
        )
    assert r.status_code == 201

    job = client.post(f"/api/projects/{project['id']}/process").json()
    # LocalJobQueue runs in a thread; poll briefly.
    import time

    for _ in range(120):
        status = client.get(f"/api/jobs/{job['job_id']}").json()
        if status["status"] in ("done", "failed"):
            break
        time.sleep(0.25)
    assert status["status"] == "done", status
    return project["id"]


class TestPipeline:
    def test_sheet_ingested_and_classified(self, client, processed_project):
        sheets = client.get(f"/api/projects/{processed_project}/sheets").json()
        assert len(sheets) == 1
        sheet = sheets[0]
        # "FOUNDATION PLAN" text + S-101 title block → structural
        assert sheet["sheet_type"] == "structural_plan"
        assert sheet["sheet_number"] == "S-101"

    def test_scale_resolved_from_note(self, client, processed_project):
        sheets = client.get(f"/api/projects/{processed_project}/sheets").json()
        overlay = client.get(f"/api/sheets/{sheets[0]['id']}/overlay").json()
        scale = overlay["scale"]
        assert scale["source"] == "scale_note"
        assert scale["ft_per_pt"] == pytest.approx(FT_PER_PT)
        assert scale["source_ocr_span_ids"]  # evidence chain intact

    def test_concrete_slab_quantity(self, client, processed_project):
        quantities = client.get(f"/api/projects/{processed_project}/quantities").json()
        slabs = [q for q in quantities if q["item_type"] == "concrete_slab" and q["unit"] == "CY"]
        assert slabs, f"no slab CY item in {[q['item_type'] for q in quantities]}"
        # Largest slab ≈ the 40x30 outline: 1200 SF × 4"/12 / 27 ≈ 14.8 CY.
        # Mock detector/segmenter are approximate — generous tolerance; the
        # exactness lives in the unit tests, this asserts end-to-end plumbing.
        slab = max(slabs, key=lambda q: q["quantity"])
        assert slab["quantity"] == pytest.approx(14.8, rel=0.25)
        assert "/ 27" in slab["formula"]
        assert slab["attributes"]["thickness_source"] == "callout"  # from '4" CONC. SLAB'
        assert slab["source_geometry_ids"] and slab["scale_id"]
        assert slab["csi_code"] == "03 30 00"

    def test_overlay_serves_features(self, client, processed_project):
        sheets = client.get(f"/api/projects/{processed_project}/sheets").json()
        overlay = client.get(f"/api/sheets/{sheets[0]['id']}/overlay").json()
        assert overlay["features"]
        assert any(f["polygons"] for f in overlay["features"])
        img = client.get(f"/api/sheets/{sheets[0]['id']}/image")
        assert img.status_code == 200 and img.headers["content-type"] == "image/png"

    def test_review_accept_and_correction_log(self, client, processed_project):
        quantities = client.get(f"/api/projects/{processed_project}/quantities").json()
        q = quantities[0]
        r = client.post(
            f"/api/quantities/{q['id']}/review",
            json={"action": "edit", "reviewer": "tester", "corrected_quantity": 99.0},
        ).json()
        assert r["review_status"] == "edited"
        corrections = client.get(f"/api/projects/{processed_project}/corrections").json()
        assert any(
            c["quantity_item_id"] == q["id"]
            and c["machine_snapshot"]["quantity"] == q["quantity"]
            for c in corrections
        )

    def test_exports(self, client, processed_project):
        for fmt in ("xlsx", "json", "csv"):
            r = client.post(f"/api/projects/{processed_project}/export", json={"format": fmt})
            assert r.status_code == 201, r.text
            dl = client.get(r.json()["download"])
            assert dl.status_code == 200
            if fmt == "json":
                doc = dl.json()
                assert doc["quantities"] and "evidence" in doc and doc["disclaimer"]

    def test_manual_calibration_endpoint(self, client, processed_project):
        sheets = client.get(f"/api/projects/{processed_project}/sheets").json()
        r = client.post(
            f"/api/sheets/{sheets[0]['id']}/calibrate",
            json={"p1": [0, 0], "p2": [90, 0], "real_distance_ft": 10},
        )
        assert r.status_code == 201
        assert r.json()["ft_per_pt"] == pytest.approx(10 / 90)


class TestReprocess:
    """Its own project so it doesn't interact with the module-shared one."""

    def _run(self, client, proj):
        job = client.post(f"/api/projects/{proj}/process").json()["job_id"]
        import time

        for _ in range(160):
            st = client.get(f"/api/jobs/{job}").json()["status"]
            if st in ("done", "failed"):
                return st
            time.sleep(0.25)
        return "timeout"

    def test_idempotent_reprocess_and_manual_calibration(self, client, tmp_path_factory):
        pdf = make_fixture(tmp_path_factory.mktemp("reproc") / "plan.pdf")
        proj = client.post("/api/projects", json={"name": "reproc"}).json()["id"]
        with open(pdf, "rb") as f:
            client.post(f"/api/projects/{proj}/files",
                        files={"file": ("plan.pdf", f, "application/pdf")})

        assert self._run(client, proj) == "done"
        first = client.get(f"/api/projects/{proj}/quantities").json()
        assert len(first) >= 1
        area = next(q for q in first if q["unit"] in ("SF", "CY"))

        # Re-process: stable ids → same rows, no duplication.
        assert self._run(client, proj) == "done"
        second = client.get(f"/api/projects/{proj}/quantities").json()
        assert len(second) == len(first)
        assert {q["id"] for q in second} == {q["id"] for q in first}

        # A manual two-click calibration must actually change the measurement.
        sheet = client.get(f"/api/projects/{proj}/sheets").json()[0]
        client.post(f"/api/sheets/{sheet['id']}/calibrate",
                    json={"p1": [0, 0], "p2": [90, 0], "real_distance_ft": 100})
        assert self._run(client, proj) == "done"
        after = {q["id"]: q for q in client.get(f"/api/projects/{proj}/quantities").json()}
        assert after[area["id"]]["quantity"] != area["quantity"]
        # And the scale the item cites is now the manual one.
        overlay = client.get(f"/api/sheets/{sheet['id']}/overlay").json()
        assert overlay["scale"]["source"] == "manual"
