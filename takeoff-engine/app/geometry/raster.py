"""OpenCV raster helpers: mask cleanup, contour extraction, line detection.

Everything here is deterministic image processing used to refine model
candidates — closing pixel gaps, extracting polygon contours from SAM masks,
finding straight linework to snap boundaries to.
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


def detect_line_segments(
    gray: np.ndarray,
    px_per_pt: float,
    min_length_px: float = 40.0,
) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """Probabilistic Hough segments in page points — used to snap mask edges
    to actual drawn linework and to find dimension extension lines."""
    edges = cv2.Canny(gray, 50, 150)
    lines = cv2.HoughLinesP(
        edges, 1, np.pi / 180, threshold=60,
        minLineLength=min_length_px, maxLineGap=4,
    )
    if lines is None:
        return []
    return [
        ((x1 / px_per_pt, y1 / px_per_pt), (x2 / px_per_pt, y2 / px_per_pt))
        for [[x1, y1, x2, y2]] in lines
    ]


def connected_component_boxes(
    binary: np.ndarray, px_per_pt: float, min_area_px: int = 50
) -> list[tuple[float, float, float, float]]:
    """Connected-component bounding boxes in page points (symbol candidates)."""
    n, _, stats, _ = cv2.connectedComponentsWithStats((binary > 0).astype(np.uint8))
    boxes = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < min_area_px:
            continue
        boxes.append((x / px_per_pt, y / px_per_pt, (x + w) / px_per_pt, (y + h) / px_per_pt))
    return boxes
