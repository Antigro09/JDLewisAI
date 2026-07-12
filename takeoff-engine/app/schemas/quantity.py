"""Quantity items and assembly mappings — the estimator-facing output."""

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.confidence import ConfidenceBundle, ReviewReason
from app.schemas.core import new_id, utcnow


class OverlayStyle(BaseModel):
    stroke: str = "#2563eb"
    fill: str = "#2563eb33"
    stroke_width: float = 1.5
    dash: str = ""


class QuantityItem(BaseModel):
    id: str = Field(default_factory=new_id)
    project_id: str
    sheet_id: str
    page_number: int
    item_type: str                 # concrete_slab | flooring | wall | column | door | window | ...
    description: str
    quantity: float
    unit: str                      # SF | LF | EA | CY | SY
    formula: str                   # human-readable audit string
    csi_code: str | None = None
    source_geometry_ids: list[str] = Field(default_factory=list)
    source_ocr_span_ids: list[str] = Field(default_factory=list)
    scale_id: str | None = None
    scale_confidence: float = 0.0
    measurement_confidence: float = 0.0
    model_confidence: float = 0.0
    confidence: ConfidenceBundle = Field(default_factory=ConfidenceBundle)
    final_confidence: float = 0.0
    needs_review: bool = False
    review_reason: list[ReviewReason] = Field(default_factory=list)
    review_status: str = "pending"   # pending | accepted | edited | rejected
    overlay_style: OverlayStyle = Field(default_factory=OverlayStyle)
    attributes: dict = Field(default_factory=dict)  # thickness_ft, waste_factor, mark, ...
    version: int = 1
    created_at: datetime = Field(default_factory=utcnow)
