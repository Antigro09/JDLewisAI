"""GOT-OCR-2.0 — optional secondary OCR checker for hard regions.

Not a primary source: GOT reads dense/stylized text well but its coordinate
output is weaker than PaddleOCR's. Use it to RE-READ a specific crop when
PaddleOCR confidence is low (e.g. a smudged scale note), then compare.

Integration: host on a SageMaker endpoint or local transformers pipeline.
  request : {"image_b64": <crop b64>, "task": "ocr"}
  response: {"text": str, "confidence": float}
"""

from __future__ import annotations

from app.adapters.transport import AdapterNotConfigured, ModelTransport


class GOTOCRChecker:
    name = "got-ocr-2.0"

    def __init__(self, transport: ModelTransport | None = None):
        if transport is None:
            raise AdapterNotConfigured(
                "GOT-OCR-2.0",
                "Provide a transport: SageMakerTransport('got-ocr-endpoint', region) "
                "or a local transformers wrapper. See docs/adapters.md.",
            )
        self.transport = transport

    def read_region(self, crop_b64: str) -> tuple[str, float]:
        resp = self.transport.invoke({"image_b64": crop_b64, "task": "ocr"})
        return resp.get("text", ""), float(resp.get("confidence", 0.0))
