"""Mock OCR — returns preloaded spans (tests) or nothing.

With mock OCR the pipeline still works on vector PDFs because native PDF
text extraction (ingestion/pdf_pymupdf.py) supplies coordinate text spans;
mock mode simply has no raster-OCR channel.
"""

from __future__ import annotations

import numpy as np

from app.adapters.base import OCRAdapter, OCRResult


class MockOCRAdapter(OCRAdapter):
    name = "mock-ocr"

    def __init__(self, canned: OCRResult | None = None):
        self.canned = canned

    def run(self, image: np.ndarray, sheet_id: str, px_per_pt: float) -> OCRResult:
        if self.canned is not None:
            return self.canned
        return OCRResult()
