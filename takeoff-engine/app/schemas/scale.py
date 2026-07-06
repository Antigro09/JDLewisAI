"""Scale calibration.

A ScaleCalibration converts page points to real-world feet:
    feet = points * ft_per_pt
Sources are ranked; the resolver records which source won and how confident
it is. NTS sheets get an explicit refusal calibration (ft_per_pt = None) —
the engine never silently measures an uncalibrated drawing.
"""

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field

from app.schemas.core import new_id, utcnow


class ScaleSource(str, Enum):
    # Ranked best → worst. Manual is trusted but last-resort automatic.
    PDF_METADATA = "pdf_metadata"
    SCALE_NOTE = "scale_note"          # written note, e.g. 1/8" = 1'-0"
    GRAPHIC_BAR = "graphic_bar"
    KNOWN_DIMENSION = "known_dimension"  # dimension string matched to extension lines
    MANUAL = "manual"                    # two-click calibration
    NTS = "nts"                          # refused: not to scale
    NONE = "none"                        # nothing found


SOURCE_BASE_CONFIDENCE: dict[ScaleSource, float] = {
    ScaleSource.PDF_METADATA: 0.95,
    ScaleSource.SCALE_NOTE: 0.85,
    ScaleSource.GRAPHIC_BAR: 0.75,
    ScaleSource.KNOWN_DIMENSION: 0.70,
    ScaleSource.MANUAL: 0.99,
    ScaleSource.NTS: 0.0,
    ScaleSource.NONE: 0.0,
}


class ScaleCalibration(BaseModel):
    id: str = Field(default_factory=new_id)
    sheet_id: str
    viewport_id: str | None = None       # None = whole-sheet scale
    source: ScaleSource
    ft_per_pt: float | None = None       # None for NTS/NONE — measurement refused
    scale_text: str = ""                 # raw evidence, e.g. '1/8" = 1\'-0"'
    source_ocr_span_ids: list[str] = Field(default_factory=list)
    confidence: float = 0.0
    notes: str = ""
    created_at: datetime = Field(default_factory=utcnow)

    @property
    def usable(self) -> bool:
        return self.ft_per_pt is not None and self.ft_per_pt > 0
