"""OpenCV raster helpers: mask cleanup and contour extraction.

Deterministic image processing used to turn a neural segmentation mask into
polygon rings (page points) — closing pixel gaps, then tracing contours.
"""

from __future__ import annotations

import cv2
import numpy as np

Coords = list[tuple[float, float]]


def clean_mask(mask: np.ndarray, kernel_px: int = 5) -> np.ndarray:
    """Morphological close-then-open to seal hairline gaps and drop specks."""
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_px, kernel_px))
    out = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_CLOSE, kernel)
    return cv2.morphologyEx(out, cv2.MORPH_OPEN, kernel)


def mask_to_polygons(
    mask: np.ndarray,
    px_per_pt: float,
    min_area_px: float = 100.0,
    simplify_eps_px: float = 2.0,
) -> list[Coords]:
    """Binary mask (raster pixels) → polygon rings in PAGE POINTS."""
    contours, _ = cv2.findContours(
        (mask > 0).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    polygons: list[Coords] = []
    for c in contours:
        if cv2.contourArea(c) < min_area_px:
            continue
        approx = cv2.approxPolyDP(c, simplify_eps_px, closed=True)
        ring = [(float(x) / px_per_pt, float(y) / px_per_pt) for [[x, y]] in approx]
        if len(ring) >= 3:
            polygons.append(ring)
    return polygons
