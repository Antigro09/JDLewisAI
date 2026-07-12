import os

from fastapi.testclient import TestClient
from sqlalchemy import text


def _client(tmp_path):
    os.environ["TAKEOFF_STORAGE_ROOT"] = str(tmp_path / "data")
    os.environ["TAKEOFF_DATABASE_URL"] = "sqlite:///:memory:"

    from app.config import get_settings
    from app.db import database

    get_settings.cache_clear()
    database.reset_engine_for_tests()

    from app.main import create_app

    return TestClient(create_app())


def test_corrections_log_tolerates_legacy_blank_created_at(tmp_path):
    client = _client(tmp_path)
    with client:
        project = client.post("/api/projects", json={"name": "legacy corrections"}).json()
        project_id = project["id"]

        from app.db.database import session_scope
        from app.db.orm import QuantityRow, SheetRow
        from app.schemas.core import new_id

        sheet_id = new_id()
        quantity_id = new_id()
        decision_id = new_id()
        with session_scope() as db:
            db.add(
                SheetRow(
                    id=sheet_id,
                    project_id=project_id,
                    page_number=1,
                    data={"id": sheet_id, "page_number": 1},
                )
            )
            db.add(
                QuantityRow(
                    id=quantity_id,
                    project_id=project_id,
                    sheet_id=sheet_id,
                    item_type="flooring",
                    unit="SF",
                    quantity=10,
                    data={
                        "id": quantity_id,
                        "project_id": project_id,
                        "sheet_id": sheet_id,
                        "page_number": 1,
                        "item_type": "flooring",
                        "description": "Room finish",
                        "quantity": 10,
                        "unit": "SF",
                        "formula": "fixture",
                    },
                )
            )
            db.flush()
            db.execute(
                text(
                    """
                    INSERT INTO review_decisions
                        (id, quantity_item_id, project_id, action, data, created_at)
                    VALUES
                        (:id, :quantity_id, :project_id, 'accept', :data, '')
                    """
                ),
                {
                    "id": decision_id,
                    "quantity_id": quantity_id,
                    "project_id": project_id,
                    "data": '{"reviewer":"tester","machine_snapshot":{}}',
                },
            )

        corrections = client.get(f"/api/projects/{project_id}/corrections")
        assert corrections.status_code == 200
        assert corrections.json()[0]["id"] == decision_id
        assert corrections.json()[0]["created_at"] is None

        export = client.post(f"/api/projects/{project_id}/export", json={"format": "json"})
        assert export.status_code == 201
