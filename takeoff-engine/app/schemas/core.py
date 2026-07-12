"""Core document schemas.

Coordinate convention (the shared page coordinate system):
  Every artifact — OCR span, vector path, detection box, mask polygon —
  is stored in PAGE POINTS: PDF points (1/72 inch of paper) with the origin
  at the TOP-LEFT of the page, x right, y down. Raster pixels convert via
  `dpi / 72`; TIFF-only sheets use their native pixel grid scaled to points
  by the file's DPI tag (or an assumed default recorded on the RasterPage).
  Real-world feet are only produced by applying a ScaleCalibration.
"""

from datetime import UTC, datetime
from enum import Enum
from uuid import uuid4

from pydantic import BaseModel, Field


def new_id() -> str:
    return uuid4().hex


def utcnow() -> datetime:
    return datetime.now(UTC)


BBox = tuple[float, float, float, float]  # x0, y0, x1, y1 in page points


class Project(BaseModel):
    id: str = Field(default_factory=new_id)
    name: str
    description: str = ""
    status: str = "created"  # created | processing | processed | failed
    settings: dict = Field(default_factory=dict)  # per-project overrides (waste factors, etc.)
    created_at: datetime = Field(default_factory=utcnow)


class SheetType(str, Enum):
    ARCHITECTURAL_PLAN = "architectural_plan"
    STRUCTURAL_PLAN = "structural_plan"
    FINISH_PLAN = "finish_plan"
    DEMOLITION_PLAN = "demolition_plan"   # demo-only sheets: never a takeoff target
    LIFE_SAFETY = "life_safety"           # duplicates plan geometry: never a takeoff target
    DETAIL = "detail"
    SCHEDULE = "schedule"
    MEP = "mep"
    TITLE_SHEET = "title_sheet"
    UNKNOWN = "unknown"


class Sheet(BaseModel):
    id: str = Field(default_factory=new_id)
    project_id: str
    source_file: str          # storage-relative path of the uploaded PDF/TIFF
    page_number: int          # 1-based page index within the source file
    sheet_number: str = ""    # title-block sheet number, e.g. "A-101"
    sheet_title: str = ""
    sheet_type: SheetType = SheetType.UNKNOWN
    sheet_type_confidence: float = 0.0
    width_pt: float = 0.0
    height_pt: float = 0.0
    rotation_deg: int = 0
    is_nts: bool = False      # sheet declares "NTS" / not to scale
    created_at: datetime = Field(default_factory=utcnow)


class RasterPage(BaseModel):
    """A rendered raster of a sheet at a specific DPI."""

    id: str = Field(default_factory=new_id)
    sheet_id: str
    dpi: int
    width_px: int
    height_px: int
    image_path: str           # storage-relative path (PNG)
    source: str = "pdf_render"  # pdf_render | tiff_native
    native_dpi: tuple[float, float] | None = None  # TIFF: (x, y) DPI actually used
    dpi_assumed: bool = False   # True when no DPI tag was found → scale is a guess
    created_at: datetime = Field(default_factory=utcnow)

    @property
    def px_per_pt(self) -> float:
        return self.dpi / 72.0


class VectorPath(BaseModel):
    """A native PDF vector path (linework) in page points."""

    id: str = Field(default_factory=new_id)
    sheet_id: str
    kind: str = "stroke"      # stroke | fill | fill_stroke
    points: list[list[tuple[float, float]]] = Field(default_factory=list)  # subpaths
    is_closed: bool = False
    stroke_width: float = 0.0
    color: str = ""           # stroke color hex (fill color for fill-only paths)
    fill_color: str = ""      # fill color hex, when the path has a fill
    dashes: list[float] = Field(default_factory=list)
    layer: str = ""           # OCG/layer name when the PDF exposes it
    bbox: BBox = (0.0, 0.0, 0.0, 0.0)


class DrawingViewport(BaseModel):
    """A region of a sheet containing an actual drawing (vs title block/notes).

    Scale is per-viewport: a plan and its blown-up detail on the same sheet
    have different scales.
    """

    id: str = Field(default_factory=new_id)
    sheet_id: str
    bbox: BBox
    label: str = ""           # e.g. "1/A-101 FLOOR PLAN"
    kind: str = "drawing"     # drawing | title_block | notes | legend | schedule
    scale_id: str | None = None
    confidence: float = 0.0
