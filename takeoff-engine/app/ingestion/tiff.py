"""TIFF ingestion (real). Multi-page TIFFs become one Sheet per frame.

TIFFs have no vector/native-text channel — everything downstream rides on
OCR + detection. Page points are derived from the DPI tag (or the recorded
default), keeping the shared coordinate system intact.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from app.ingestion.coordinates import DEFAULT_TIFF_DPI
from app.schemas.core import RasterPage, Sheet

Image.MAX_IMAGE_PIXELS = 500_000_000  # large-format scans are legitimate here


class TiffIngestor:
    name = "tiff"

    def page_count(self, tiff_path: Path) -> int:
        with Image.open(tiff_path) as im:
            return getattr(im, "n_frames", 1)

    def extract_sheet(self, tiff_path: Path, page_number: int, project_id: str,
                      source_file: str) -> Sheet:
        with Image.open(tiff_path) as im:
            im.seek(page_number - 1)
            dpi = self._dpi(im)
            return Sheet(
                project_id=project_id,
                source_file=source_file,
                page_number=page_number,
                width_pt=im.width * 72.0 / dpi,
                height_pt=im.height * 72.0 / dpi,
            )

    def render_page(self, tiff_path: Path, page_number: int, sheet_id: str,
                    dpi: int, out_path: Path) -> RasterPage:
        """`dpi` is the requested working DPI; the frame is resampled to it so
        px_per_pt stays consistent with PDF renders."""
        with Image.open(tiff_path) as im:
            im.seek(page_number - 1)
            native_dpi = self._dpi(im)
            frame = im.convert("RGB")
            if abs(native_dpi - dpi) > 1:
                scale = dpi / native_dpi
                frame = frame.resize(
                    (max(1, round(im.width * scale)), max(1, round(im.height * scale)))
                )
            out_path.parent.mkdir(parents=True, exist_ok=True)
            frame.save(out_path, "PNG")
            return RasterPage(
                sheet_id=sheet_id,
                dpi=dpi,
                width_px=frame.width,
                height_px=frame.height,
                image_path=str(out_path),
                source="tiff_native",
            )

    def _dpi(self, im: Image.Image) -> float:
        dpi = im.info.get("dpi")
        if dpi and dpi[0] and float(dpi[0]) > 1:
            return float(dpi[0])
        return float(DEFAULT_TIFF_DPI)
