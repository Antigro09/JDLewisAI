"""Mock detector — deterministic OpenCV heuristics instead of a neural net.

Finds large enclosed regions (candidate rooms/slabs) via thresholding and
contour detection so the full pipeline produces real, auditable geometry on
vector-drawn fixtures without downloading any model. Marked low-confidence:
the point is exercising the plumbing, not production detection quality.
"""

from __future__ import annotations

import cv2

from app.adapters.base import DetectorAdapter
from app.schemas.detection import DetectedObject


class MockDetectorAdapter(DetectorAdapter):
    name = "mock-detector-opencv"

    def __init__(self, min_area_ratio: float = 0.002, max_area_ratio: float = 0.5):
        self.min_area_ratio = min_area_ratio
        self.max_area_ratio = max_area_ratio

    def detect(self, image, sheet_id, px_per_pt, vocabulary=None) -> list[DetectedObject]:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
        _, binary = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)
        # Seal small gaps in linework so rooms become closed blobs.
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
        contours, hierarchy = cv2.findContours(binary, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        page_area = float(gray.shape[0] * gray.shape[1])

        out: list[DetectedObject] = []
        if hierarchy is None:
            return out
        for c, h in zip(contours, hierarchy[0], strict=True):
            area = cv2.contourArea(c)
            if not (self.min_area_ratio * page_area <= area <= self.max_area_ratio * page_area):
                continue
            # Interior contours (holes in linework blobs) are the room interiors.
            is_interior = h[3] != -1
            x, y, w, hgt = cv2.boundingRect(c)
            out.append(
                DetectedObject(
                    sheet_id=sheet_id,
                    label="room" if is_interior else "slab",
                    bbox=(x / px_per_pt, y / px_per_pt, (x + w) / px_per_pt, (y + hgt) / px_per_pt),
                    confidence=0.5,
                    detector=self.name,
                )
            )
        return out
