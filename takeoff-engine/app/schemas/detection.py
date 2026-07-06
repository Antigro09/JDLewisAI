"""Detection / segmentation / geometry artifacts. Coordinates in page points."""

from pydantic import BaseModel, Field

from app.schemas.core import BBox, new_id


class DetectedObject(BaseModel):
    id: str = Field(default_factory=new_id)
    sheet_id: str
    viewport_id: str | None = None
    # room | slab | wall | door | window | room_label | finish_tag |
    # dimension | callout | scale_bar | north_arrow | symbol
    label: str
    bbox: BBox
    confidence: float
    detector: str  # rf-detr | grounding-dino | vector_heuristic | mock
    matched_ocr_span_ids: list[str] = Field(default_factory=list)
    schedule_ref: str = ""  # e.g. door mark "101A" matched to schedule row


class SegmentationMask(BaseModel):
    """A raster mask from SAM 2 (or another segmenter), stored as polygons
    already lifted to page points; the raw mask PNG stays on disk."""

    id: str = Field(default_factory=new_id)
    sheet_id: str
    detected_object_id: str | None = None
    polygons: list[list[tuple[float, float]]] = Field(default_factory=list)
    mask_path: str = ""            # optional storage-relative raw mask
    confidence: float = 0.0
    segmenter: str = "sam2"
    prompt_kind: str = "box"       # box | points
    line_overreach_ratio: float = 0.0  # fraction of mask boundary crossing unrelated linework


class PolygonGeometry(BaseModel):
    """Validated deterministic geometry — the measurement source of truth."""

    id: str = Field(default_factory=new_id)
    sheet_id: str
    kind: str = "polygon"           # polygon | polyline | point
    exterior: list[tuple[float, float]] = Field(default_factory=list)
    holes: list[list[tuple[float, float]]] = Field(default_factory=list)
    is_closed: bool = True
    is_valid: bool = True
    area_pt2: float = 0.0           # deterministic, from Shapely
    length_pt: float = 0.0
    derived_from: list[str] = Field(default_factory=list)  # mask/vector/detection ids
    refinement: str = ""            # e.g. "sam2_mask + vector_snap + opencv_close"
