"""OCR schemas. All coordinates are page points (see core.py)."""

from pydantic import BaseModel, Field

from app.schemas.core import BBox, new_id


class OCRSpan(BaseModel):
    id: str = Field(default_factory=new_id)
    sheet_id: str
    text: str
    bbox: BBox
    rotation_deg: float = 0.0
    confidence: float = 1.0
    source: str = "pdf_native"  # pdf_native | paddleocr | got_ocr | manual
    # Semantic tag assigned downstream: room_tag | dimension | scale_note |
    # finish_tag | callout | title_block | schedule_cell | general
    semantic: str = "general"


class OCRTable(BaseModel):
    """A detected table (door schedule, finish schedule, ...)."""

    id: str = Field(default_factory=new_id)
    sheet_id: str
    bbox: BBox
    title: str = ""
    kind: str = "unknown"  # door_schedule | window_schedule | finish_schedule | unknown
    header: list[str] = Field(default_factory=list)
    rows: list[list[str]] = Field(default_factory=list)
    cell_span_ids: list[list[str]] = Field(default_factory=list)  # OCRSpan ids per row
    confidence: float = 0.0
    source: str = "pp_structure"
