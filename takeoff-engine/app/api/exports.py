from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.review import _review_decisions_for_project
from app.config import get_settings
from app.db.database import get_session
from app.db.orm import (
    ArtifactRow,
    ExportJobRow,
    ProjectRow,
    QuantityRow,
    SheetRow,
)
from app.export.csv_export import CSVExportAdapter
from app.export.excel import ExcelExportAdapter
from app.export.json_export import JSONExportAdapter
from app.schemas.core import new_id
from app.schemas.export import ExportFormat
from app.storage.local import LocalStorage

router = APIRouter(prefix="/api", tags=["exports"])

ADAPTERS = {
    ExportFormat.XLSX: ExcelExportAdapter(),
    ExportFormat.JSON: JSONExportAdapter(),
    ExportFormat.CSV: CSVExportAdapter(),
}
MEDIA = {
    ExportFormat.XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ExportFormat.JSON: "application/json",
    ExportFormat.CSV: "text/csv",
}


class ExportRequest(BaseModel):
    format: ExportFormat = ExportFormat.XLSX
    include_rejected: bool = False


@router.post("/projects/{project_id}/export", status_code=201)
def create_export(project_id: str, body: ExportRequest, db: Session = Depends(get_session)):
    project = db.get(ProjectRow, project_id)
    if not project:
        raise HTTPException(404, "project not found")

    quantities = []
    for r in db.query(QuantityRow).filter_by(project_id=project_id).all():
        if not body.include_rejected and r.review_status == "rejected":
            continue
        quantities.append(r.data | {"id": r.id, "review_status": r.review_status})
    sheets = [
        r.data | {"id": r.id}
        for r in db.query(SheetRow).filter_by(project_id=project_id).all()
    ]
    sheet_ids = [s["id"] for s in sheets]
    artifacts = {}
    if sheet_ids:
        for a in db.query(ArtifactRow).filter(ArtifactRow.sheet_id.in_(sheet_ids)).all():
            artifacts[a.id] = {"kind": a.kind, "data": a.data}
    decisions = _review_decisions_for_project(project_id, db)

    storage = LocalStorage(get_settings().storage_root)
    export_id = new_id()
    key = f"projects/{project_id}/exports/{export_id}.{body.format.value}"
    out_path = storage.open_path(key)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    job = ExportJobRow(id=export_id, project_id=project_id, format=body.format.value,
                       status="running")
    db.add(job)
    try:
        ADAPTERS[body.format].export(
            project_id,
            {
                "project": {"id": project.id, "name": project.name},
                "quantities": quantities,
                "sheets": sheets,
                "artifacts": artifacts,
                "review_decisions": decisions,
            },
            str(out_path),
        )
        job.status = "done"
        job.file_path = key
    except Exception as e:
        job.status = "failed"
        job.error = f"{type(e).__name__}: {e}"
        raise HTTPException(500, job.error) from e
    return {"export_id": export_id, "status": job.status,
            "download": f"/api/exports/{export_id}/download"}


@router.get("/exports/{export_id}/download")
def download_export(export_id: str, db: Session = Depends(get_session)):
    job = db.get(ExportJobRow, export_id)
    if not job or job.status != "done":
        raise HTTPException(404, "export not found or not finished")
    storage = LocalStorage(get_settings().storage_root)
    path = storage.open_path(job.file_path)
    if not path.exists():
        raise HTTPException(410, "export file missing")
    fmt = ExportFormat(job.format)
    return FileResponse(path, media_type=MEDIA[fmt],
                        filename=f"takeoff-{job.project_id[:8]}.{job.format}")
