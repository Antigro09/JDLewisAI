"""Candidate detection/segmentation stage.

detector boxes → boundary → deterministic geometry. The boundary comes from
the drawing's REAL vector linework whenever it exists (exact), and only falls
back to the neural segmentation mask on raster sheets with no linework. The
detector's job is to LOCATE and CLASSIFY a region; the area comes from the
geometry, never from the model directly.
"""

from __future__ import annotations

import numpy as np

from app.adapters.base import DetectorAdapter, SegmenterAdapter
from app.geometry.engine import GeometryEngine
from app.geometry.linework import face_for_detection, polygon_to_rings, polygonize_faces
from app.schemas.core import VectorPath
from app.schemas.detection import DetectedObject, PolygonGeometry, SegmentationMask

AREA_LABELS = {"room", "slab", "wall"}
COUNT_LABELS = {"door", "window"}


def run_candidates(
    image: np.ndarray,
    sheet_id: str,
    px_per_pt: float,
    detector: DetectorAdapter,
    segmenter: SegmenterAdapter,
    geometry: GeometryEngine,
    vector_paths: list[VectorPath] | None = None,
) -> tuple[list[DetectedObject], list[SegmentationMask], list[PolygonGeometry]]:
    detections = detector.detect(image, sheet_id, px_per_pt)
    area_dets = [d for d in detections if d.label in AREA_LABELS]

    # Exact enclosed faces from the CAD linework (empty on raster-only sheets).
    faces = polygonize_faces(vector_paths or [])

    # Segment every area box for the raster fallback (and as an audit artifact).
    masks = segmenter.segment(image, sheet_id, px_per_pt, [d.bbox for d in area_dets])
    mask_by_box = {m.source_box_index: m for m in masks}

    geometries: list[PolygonGeometry] = []
    for i, det in enumerate(area_dets):
        face = face_for_detection(faces, det.bbox, det.label) if faces else None
        if face is not None and face.area > 0:
            exterior, holes = polygon_to_rings(face)
            geom = geometry.build_polygon(
                sheet_id=sheet_id,
                exterior=exterior,
                holes=holes,
                derived_from=[det.id],
                refinement="vector linework face (exact)",
                boundary_source="vector",
            )
            geometries.append(geom)
            continue

        # No linework here → fall back to the neural mask (approximate).
        mask = mask_by_box.get(i)
        if mask is None or not mask.polygons:
            continue
        mask.detected_object_id = det.id
        ring = max(mask.polygons, key=_ring_area)
        geom = geometry.build_polygon(
            sheet_id=sheet_id,
            exterior=ring,
            derived_from=[det.id, mask.id],
            refinement=f"{mask.segmenter} mask → largest contour (approximate)",
            boundary_source="mask",
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
