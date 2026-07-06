from __future__ import annotations

from functools import partial

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.database import get_session
from app.db.orm import JobRow, ProjectRow
from app.pipeline.orchestrator import process_project_job
from app.schemas.core import new_id
from app.workers.base import build_queue

router = APIRouter(prefix="/api", tags=["pipeline"])

_queue = None


def get_queue():
    global _queue
    if _queue is None:
        settings = get_settings()
        _queue = build_queue(settings.job_queue, settings.redis_url)
    return _queue


@router.post("/projects/{project_id}/process", status_code=202)
def process_project(project_id: str, db: Session = Depends(get_session)):
    project = db.get(ProjectRow, project_id)
    if not project:
        raise HTTPException(404, "project not found")
    job_id = new_id()
    db.add(JobRow(id=job_id, project_id=project_id, kind="process", status="queued"))
    project.status = "processing"
    db.commit()
    get_queue().enqueue(job_id, partial(process_project_job, project_id, job_id))
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
