"""Mock segmenter — deterministic contour fill inside each prompt box.

Approximates SAM 2 by taking the largest enclosed region within the box
(OpenCV flood/contour), falling back to the box rectangle itself. Confidence
is capped low so downstream review logic treats it honestly.
"""

from __future__ import annotations

import cv2
import numpy as np

from app.adapters.base import SegmenterAdapter
from app.geometry.raster import mask_to_polygons
from app.schemas.detection import SegmentationMask


class MockSegmenterAdapter(SegmenterAdapter):
    name = "mock-segmenter-opencv"

    def segment(self, image, sheet_id, px_per_pt, boxes) -> list[SegmentationMask]:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
        h, w = gray.shape[:2]
        masks: list[SegmentationMask] = []
        # Contract: exactly one mask per input box, in order — callers associate
        # masks to boxes positionally, so a dropped box would misalign the rest.
        for i, box in enumerate(boxes):
            box_rect = [
                (box[0], box[1]), (box[2], box[1]), (box[2], box[3]), (box[0], box[3])
            ]
            x0 = max(0, int(box[0] * px_per_pt))
            y0 = max(0, int(box[1] * px_per_pt))
            x1 = min(w, int(box[2] * px_per_pt))
            y1 = min(h, int(box[3] * px_per_pt))
            if x1 - x0 < 4 or y1 - y0 < 4:
                # Degenerate box → fall back to the box rectangle (low confidence)
                # rather than dropping it and shifting every later mask.
                masks.append(SegmentationMask(
                    sheet_id=sheet_id, polygons=[box_rect], confidence=0.2,
                    segmenter=self.name, prompt_kind="box", source_box_index=i,
                ))
                continue
            crop = gray[y0:y1, x0:x1]
            _, binary = cv2.threshold(crop, 200, 255, cv2.THRESH_BINARY)  # white interior
            mask = np.zeros_like(gray)
            mask[y0:y1, x0:x1] = binary
            polygons = mask_to_polygons(mask, px_per_pt, min_area_px=64.0) or [box_rect]
            masks.append(
                SegmentationMask(
                    sheet_id=sheet_id,
                    polygons=polygons,
                    confidence=0.5,
                    segmenter=self.name,
                    prompt_kind="box",
                    source_box_index=i,
                )
            )
        return masks
