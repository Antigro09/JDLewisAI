"""Export jobs."""

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field

from app.schemas.core import new_id, utcnow


class ExportFormat(str, Enum):
    XLSX = "xlsx"
    JSON = "json"
    CSV = "csv"


class ExportJob(BaseModel):
    id: str = Field(default_factory=new_id)
    project_id: str
    format: ExportFormat
    status: str = "pending"        # pending | running | done | failed
    file_path: str = ""            # storage-relative output path
    include_rejected: bool = False
    error: str = ""
    created_at: datetime = Field(default_factory=utcnow)
    finished_at: datetime | None = None
