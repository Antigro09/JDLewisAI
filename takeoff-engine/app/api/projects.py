from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.database import get_session
from app.db.orm import FileRow, ProjectRow
from app.schemas.core import new_id
from app.storage.local import LocalStorage

router = APIRouter(prefix="/api/projects", tags=["projects"])

ALLOWED_TYPES = {
    "application/pdf": ".pdf",
    "image/tiff": ".tif",
    "image/tif": ".tif",
}


class ProjectCreate(BaseModel):
    name: str
    description: str = ""
    settings: dict = {}


@router.post("", status_code=201)
def create_project(body: ProjectCreate, db: Session = Depends(get_session)):
    row = ProjectRow(
        id=new_id(), name=body.name,
        data={"description": body.description, "settings": body.settings},
    )
    db.add(row)
    return {"id": row.id, "name": row.name, "status": row.status}


@router.get("")
def list_projects(db: Session = Depends(get_session)):
    return [
        {"id": p.id, "name": p.name, "status": p.status, "created_at": p.created_at}
        for p in db.query(ProjectRow).order_by(ProjectRow.created_at.desc()).all()
    ]


@router.get("/{project_id}")
def get_project(project_id: str, db: Session = Depends(get_session)):
    p = db.get(ProjectRow, project_id)
    if not p:
        raise HTTPException(404, "project not found")
    files = db.query(FileRow).filter_by(project_id=project_id).all()
    return {
        "id": p.id, "name": p.name, "status": p.status, "created_at": p.created_at,
        "files": [{"id": f.id, "filename": f.filename, "media_type": f.media_type} for f in files],
    }


@router.post("/{project_id}/files", status_code=201)
async def upload_file(project_id: str, file: UploadFile, db: Session = Depends(get_session)):
    if not db.get(ProjectRow, project_id):
        raise HTTPException(404, "project not found")
    suffix = ALLOWED_TYPES.get(file.content_type or "")
    if suffix is None:
        name = (file.filename or "").lower()
        if name.endswith(".pdf"):
            suffix = ".pdf"
        elif name.endswith((".tif", ".tiff")):
            suffix = ".tif"
        else:
            raise HTTPException(415, "only PDF and TIFF are supported")

    settings = get_settings()
    storage = LocalStorage(settings.storage_root)
    file_id = new_id()
    key = f"projects/{project_id}/uploads/{file_id}{suffix}"
    storage.save(key, await file.read())
    media_type = "image/tiff" if suffix == ".tif" else "application/pdf"
    db.add(FileRow(
        id=file_id, project_id=project_id, filename=file.filename or f"upload{suffix}",
        storage_path=key, media_type=media_type,
    ))
    return {"id": file_id, "storage_path": key, "media_type": media_type}
