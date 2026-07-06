"""Candidate detection/segmentation stage.

detector boxes → SAM 2 masks → deterministic geometry refinement.
The output is PolygonGeometry (the measurement source of truth) linked back
to every artifact that produced it, plus counted symbol detections.
"""

from __future__ import annotations

import numpy as np

from app.adapters.base import DetectorAdapter, SegmenterAdapter
from app.geometry.engine import GeometryEngine
from app.schemas.detection import DetectedObject, PolygonGeometry, SegmentationMask

AREA_LABELS = {"room", "slab", "wall"}
COUNT_LABELS = {"door", "window"}
TAG_LABELS = {"room_label", "finish_tag", "dimension", "callout"}


def run_candidates(
    image: np.ndarray,
    sheet_id: str,
    px_per_pt: float,
    detector: DetectorAdapter,
    segmenter: SegmenterAdapter,
    geometry: GeometryEngine,
) -> tuple[list[DetectedObject], list[SegmentationMask], list[PolygonGeometry]]:
    detections = detector.detect(image, sheet_id, px_per_pt)

    area_dets = [d for d in detections if d.label in AREA_LABELS]
    masks = segmenter.segment(image, sheet_id, px_per_pt, [d.bbox for d in area_dets])

    geometries: list[PolygonGeometry] = []
    for det, mask in zip(area_dets, masks, strict=False):
        mask.detected_object_id = det.id
        if not mask.polygons:
            continue
        # Largest ring is the object boundary; the rest are noise or holes —
        # holes-in-mask handling is a refinement for later.
        ring = max(mask.polygons, key=_ring_area)
        geom = geometry.build_polygon(
            sheet_id=sheet_id,
            exterior=ring,
            derived_from=[det.id, mask.id],
            refinement=f"{mask.segmenter} mask → largest contour",
        )
        geometries.append(geom)
    return detections, masks, geometries


def _ring_area(ring: list[tuple[float, float]]) -> float:
    # Shoelace, absolute — cheap ranking without building Shapely objects.
    n = len(ring)
    if n < 3:
        return 0.0
    s = 0.0
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0
