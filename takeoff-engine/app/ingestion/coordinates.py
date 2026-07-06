"""Shared page coordinate system.

Canonical unit: PDF POINTS (1/72 inch of paper), origin top-left, y down.
PyMuPDF already uses top-left-origin points, so PDF artifacts pass through.
Raster artifacts convert with px_per_pt = dpi / 72. TIFF-only sheets are
assigned points via the file's DPI tag (default 300 when absent — recorded
so the assumption is auditable).
"""

from __future__ import annotations

DEFAULT_TIFF_DPI = 300


def px_per_pt(dpi: int | float) -> float:
    return float(dpi) / 72.0


def px_to_pt(v: float, dpi: int | float) -> float:
    return v * 72.0 / float(dpi)


def pt_to_px(v: float, dpi: int | float) -> float:
    return v * float(dpi) / 72.0


def bbox_px_to_pt(bbox: tuple[float, float, float, float], dpi: int | float):
    return tuple(px_to_pt(v, dpi) for v in bbox)
