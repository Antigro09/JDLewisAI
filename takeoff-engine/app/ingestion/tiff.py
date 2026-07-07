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
            dpi_x, dpi_y, _ = self._dpi_xy(im)
            return Sheet(
                project_id=project_id,
                source_file=source_file,
                page_number=page_number,
                # Per-axis DPI so anisotropic scans (e.g. 300×150) keep true aspect.
                width_pt=im.width * 72.0 / dpi_x,
                height_pt=im.height * 72.0 / dpi_y,
            )

    def render_page(self, tiff_path: Path, page_number: int, sheet_id: str,
                    dpi: int, out_path: Path) -> RasterPage:
        """`dpi` is the requested working DPI; the frame is resampled to a
        uniform square DPI on both axes so px_per_pt = dpi/72 holds exactly."""
        with Image.open(tiff_path) as im:
            im.seek(page_number - 1)
            dpi_x, dpi_y, assumed = self._dpi_xy(im)
            frame = im.convert("RGB")
            # Resample each axis by its own factor → uniform `dpi` output.
            tw = max(1, round(im.width * dpi / dpi_x))
            th = max(1, round(im.height * dpi / dpi_y))
            if (tw, th) != (frame.width, frame.height):
                frame = frame.resize((tw, th))
            out_path.parent.mkdir(parents=True, exist_ok=True)
            frame.save(out_path, "PNG")
            return RasterPage(
                sheet_id=sheet_id,
                dpi=dpi,
                width_px=frame.width,
                height_px=frame.height,
                image_path=str(out_path),
                source="tiff_native",
                native_dpi=(dpi_x, dpi_y),
                dpi_assumed=assumed,  # true when the DPI tag was missing → measurements suspect
            )

    def _dpi_xy(self, im: Image.Image) -> tuple[float, float, bool]:
        """(x_dpi, y_dpi, assumed). `assumed` is True when the file carried no
        usable DPI tag and DEFAULT_TIFF_DPI was substituted — provenance the
        rest of the system can surface, since an assumed DPI mis-scales."""
        dpi = im.info.get("dpi")
        if dpi and dpi[0] and float(dpi[0]) > 1:
            dpi_y = float(dpi[1]) if len(dpi) > 1 and dpi[1] and float(dpi[1]) > 1 else float(dpi[0])
            return float(dpi[0]), dpi_y, False
        return float(DEFAULT_TIFF_DPI), float(DEFAULT_TIFF_DPI), True
