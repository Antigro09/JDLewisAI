"""pypdfium2 + pdfplumber fallback ingestor (permissive licenses).

Drop-in replacement for PyMuPDFIngestor when AGPL is unacceptable:
  - pypdfium2 (BSD/Apache): page sizes, raster rendering.
  - pdfplumber (MIT): text with coordinates, lines/rects for linework.
Vector-path fidelity is lower than PyMuPDF's get_drawings(); acceptable
because vector paths are a refinement signal, not the only boundary source.

Install: pip install -e '.[pdf-fallback]'
"""

from __future__ import annotations

from pathlib import Path

from app.adapters.transport import AdapterNotConfigured

_INSTALL = "pip install -e '.[pdf-fallback]'  (pypdfium2 + pdfplumber)"


class PdfiumIngestor:
    name = "pdfium"

    def __init__(self):
        try:
            import pdfplumber  # noqa: F401
            import pypdfium2  # noqa: F401
        except ImportError as e:
            raise AdapterNotConfigured("pdfium fallback ingestor", _INSTALL) from e

    def page_count(self, pdf_path: Path) -> int:
        import pypdfium2 as pdfium

        doc = pdfium.PdfDocument(pdf_path)
        try:
            return len(doc)
        finally:
            doc.close()

    # extract_sheet / extract_text_spans / extract_vector_paths / render_page
    # mirror PyMuPDFIngestor's signatures. Implement when the AGPL-free path
    # is actually needed; the interface is stable and the tests for the
    # PyMuPDF path define the expected behavior.
    def extract_sheet(self, *a, **kw):
        raise NotImplementedError("pdfium fallback: implement when needed (see module docstring)")

    def extract_text_spans(self, *a, **kw):
        raise NotImplementedError("pdfium fallback: implement when needed (see module docstring)")

    def extract_vector_paths(self, *a, **kw):
        raise NotImplementedError("pdfium fallback: implement when needed (see module docstring)")

    def render_page(self, *a, **kw):
        raise NotImplementedError("pdfium fallback: implement when needed (see module docstring)")
