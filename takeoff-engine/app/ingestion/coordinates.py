"""Shared page coordinate system.

Canonical unit: PDF POINTS (1/72 inch of paper), origin top-left, y down.
PyMuPDF already uses top-left-origin points, so PDF artifacts pass through.
Raster artifacts convert with px_per_pt = dpi / 72. TIFF-only sheets are
assigned points via the file's DPI tag (default 300 when absent — recorded
so the assumption is auditable).
"""

from __future__ import annotations

# The only shared constant needed here: the DPI assumed for TIFFs with no tag.
# Actual px↔pt conversion lives where a concrete DPI is known (RasterPage.px_per_pt,
# ingestors), so the standalone helpers that used to sit here were dead weight.
DEFAULT_TIFF_DPI = 300
