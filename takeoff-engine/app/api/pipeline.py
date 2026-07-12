from __future__ import annotations

from functools import partial

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.database import get_session
from app.db.orm import JobRow, ProjectRow
from app.pipeline.orchestrator import index_project_job, process_project_job
from app.schemas.core import new_id
from app.schemas.takeoff_scope import TakeoffScope
from app.workers.base import build_queue

router = APIRouter(prefix="/api", tags=["pipeline"])

_queue = None


def get_queue():
    global _queue
    if _queue is None:
        settings = get_settings()
        _queue = build_queue(settings.job_queue, settings.redis_url)
    return _queue


class ProcessRequest(BaseModel):
    scope: TakeoffScope | None = None


@router.post("/projects/{project_id}/index", status_code=202)
def index_project(project_id: str, db: Session = Depends(get_session)):
    project = db.get(ProjectRow, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    job_id = new_id()
    db.add(JobRow(id=job_id, project_id=project_id, kind="index", status="queued"))
    project.status = "indexing"
    db.commit()
    get_queue().enqueue(job_id, partial(index_project_job, project_id, job_id))
    return {"job_id": job_id, "status": "queued"}


@router.post("/projects/{project_id}/process", status_code=202)
def process_project(project_id: str, body: ProcessRequest | None = None, db: Session = Depends(get_session)):
    project = db.get(ProjectRow, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    job_id = new_id()
    db.add(JobRow(id=job_id, project_id=project_id, kind="process", status="queued"))
    if body and body.scope:
        data = dict(project.data or {})
        data["takeoff_scope"] = body.scope.model_dump(mode="json")
        project.data = data
    project.status = "processing"
    db.commit()
    scope_payload = body.scope.model_dump(mode="json") if body and body.scope else None
    get_queue().enqueue(job_id, partial(process_project_job, project_id, job_id, scope_payload))
    return {"job_id": job_id, "status": "queued"}


@router.get("/jobs/{job_id}")
def get_job(job_id: str, db: Session = Depends(get_session)):
    job = db.get(JobRow, job_id)
    if not job:
        raise HTTPException(404, "job not found")
    return {
        "id": job.id, "project_id": job.project_id, "kind": job.kind,
        "status": job.status, "progress": job.progress, "error": job.error,
        "created_at": job.created_at, "finished_at": job.finished_at,
    }
