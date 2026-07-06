"""PaddleOCR / PP-StructureV3 adapter — primary raster OCR.

Chosen because it emits coordinate-level text boxes and table structure,
which this system requires (every span must land in page points).

Two run modes:
  local      — pip install -e '.[ocr]'; runs PaddleOCR in-process.
  sagemaker  — package PaddleOCR in a SageMaker serverless container
               (it fits comfortably); payload contract below.

SageMaker payload contract:
  request : {"image_b64": <png/jpeg b64>, "structure": true}
  response: {"spans": [{"text","bbox_px":[x0,y0,x1,y1],"rotation","confidence"}],
             "tables": [{"bbox_px", "html" or {"header","rows"}}]}
"""

from __future__ import annotations

import numpy as np

from app.adapters.base import OCRAdapter, OCRResult
from app.adapters.transport import AdapterNotConfigured, SageMakerTransport
from app.schemas.ocr import OCRSpan, OCRTable

_INSTALL = "pip install -e '.[ocr]'  (paddleocr + paddlepaddle)"


class PaddleOCRAdapter(OCRAdapter):
    name = "paddleocr"

    def __init__(self, sagemaker_endpoint: str = "", region: str = "us-east-1"):
        self.transport = None
        self._engine = None
        if sagemaker_endpoint:
            self.transport = SageMakerTransport(sagemaker_endpoint, region)

    def _local_engine(self):
        if self._engine is None:
            try:
                from paddleocr import PaddleOCR
            except ImportError as e:
                raise AdapterNotConfigured("PaddleOCR", _INSTALL) from e
            self._engine = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
        return self._engine

    def run(self, image: np.ndarray, sheet_id: str, px_per_pt: float) -> OCRResult:
        if self.transport is not None:
            return self._run_remote(image, sheet_id, px_per_pt)
        return self._run_local(image, sheet_id, px_per_pt)

    def _run_local(self, image, sheet_id, px_per_pt) -> OCRResult:
        engine = self._local_engine()
        result = engine.ocr(image, cls=True)
        spans: list[OCRSpan] = []
        for line in result[0] or []:
            quad, (text, conf) = line
            xs = [p[0] for p in quad]
            ys = [p[1] for p in quad]
            spans.append(
                OCRSpan(
                    sheet_id=sheet_id,
                    text=text,
                    bbox=(
                        min(xs) / px_per_pt, min(ys) / px_per_pt,
                        max(xs) / px_per_pt, max(ys) / px_per_pt,
                    ),
                    confidence=float(conf),
                    source="paddleocr",
                )
            )
        # PP-StructureV3 table extraction is wired in the same way; kept as a
        # follow-up because its output parsing (HTML cells → rows) is verbose.
        return OCRResult(spans=spans)

    def _run_remote(self, image, sheet_id, px_per_pt) -> OCRResult:
        import base64

        import cv2

        ok, buf = cv2.imencode(".png", image)
        if not ok:
            raise RuntimeError("failed to encode image for OCR endpoint")
        resp = self.transport.invoke(
            {"image_b64": base64.b64encode(buf.tobytes()).decode(), "structure": True}
        )
        spans = [
            OCRSpan(
                sheet_id=sheet_id,
                text=s["text"],
                bbox=tuple(v / px_per_pt for v in s["bbox_px"]),
                rotation_deg=s.get("rotation", 0.0),
                confidence=s.get("confidence", 0.0),
                source="paddleocr",
            )
            for s in resp.get("spans", [])
        ]
        tables = [
            OCRTable(
                sheet_id=sheet_id,
                bbox=tuple(v / px_per_pt for v in t["bbox_px"]),
                header=t.get("header", []),
                rows=t.get("rows", []),
                confidence=t.get("confidence", 0.0),
            )
            for t in resp.get("tables", [])
        ]
        return OCRResult(spans=spans, tables=tables)
