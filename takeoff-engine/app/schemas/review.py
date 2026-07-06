"""Human review decisions — also the training-data corrections log."""

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field

from app.schemas.core import new_id, utcnow


class ReviewAction(str, Enum):
    ACCEPT = "accept"
    EDIT = "edit"
    REJECT = "reject"


class ReviewDecision(BaseModel):
    id: str = Field(default_factory=new_id)
    quantity_item_id: str
    project_id: str
    sheet_id: str
    action: ReviewAction
    reviewer: str = "anonymous"
    # Corrections (present for EDIT): what the human changed.
    corrected_quantity: float | None = None
    corrected_unit: str | None = None
    corrected_description: str | None = None
    corrected_geometry: list[tuple[float, float]] | None = None  # page points
    comment: str = ""
    # Snapshot of the machine output at decision time, for training data.
    machine_snapshot: dict = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utcnow)
