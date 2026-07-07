"""Vector-first boundaries — the accurate measurement path.

Most construction PDFs are plotted from CAD: the walls, room boundaries, and
slab edges are REAL vector polylines with exact coordinates already in the file.
When they exist, the measured area should come from that geometry — not from a
neural segmentation mask, which is only an approximation.

This module reconstructs the enclosed polygon "faces" implied by the linework
(Shapely `polygonize` over the noded network of segments) and matches a face to
a detector box, so the detector only has to *locate* a room/slab while the area
comes from the drawing itself. The neural mask stays as the fallback for raster
sheets that carry no linework.
"""

from __future__ import annotations

from shapely.geometry import LineString, Polygon
from shapely.geometry import box as shp_box
from shapely.ops import polygonize, unary_union

from app.schemas.core import VectorPath

Coords = list[tuple[float, float]]


def polygonize_faces(vector_paths: list[VectorPath], min_area_pt2: float = 200.0) -> list[Polygon]:
    """Enclosed faces implied by the linework, largest first, noise filtered.

    `min_area_pt2` drops hatch/text/dimension-tick slivers (200 pt² ≈ a 14×14 pt
    box of paper) so only real rooms/slabs survive.
    """
    segments: list[LineString] = []
    for vp in vector_paths:
        for sub in vp.points:
            if len(sub) >= 2:
                segments.append(LineString(sub))
    if not segments:
        return []
    # unary_union nodes the network (splits every segment at intersections) so
    # polygonize can find the minimal enclosed cycles.
    noded = unary_union(segments)
    faces = [p for p in polygonize(noded) if p.is_valid and p.area >= min_area_pt2]
    faces.sort(key=lambda p: p.area, reverse=True)
    return faces


def face_for_detection(
    faces: list[Polygon],
    bbox_pt: tuple[float, float, float, float],
    label: str,
    contain_frac: float = 0.8,
    area_slack: float = 1.2,
) -> Polygon | None:
    """Pick the vector geometry that a detection box points at.

    A face counts as "inside" the box when >= contain_frac of its area lies
    within the box (so we never grab a neighbouring room). Then:
      - room  → the single largest contained face (its interior, holes kept, so
                a column/void inside the room is subtracted from floor area).
      - slab/wall → the OUTER footprint: union the contained faces and take the
                exterior, because concrete is poured under the interior
                partitions too (the slab is the whole footprint, not
                footprint-minus-rooms).
    Returns None when no vector face matches (→ caller falls back to the mask).
    """
    bx = shp_box(*bbox_pt)
    box_area = bx.area
    if box_area <= 0:
        return None
    contained = [
        f for f in faces
        if f.area <= box_area * area_slack and f.intersection(bx).area >= contain_frac * f.area
    ]
    if not contained:
        return None

    if label in ("slab", "wall"):
        merged = unary_union(contained).buffer(0)  # heal any seams
        if merged.is_empty:
            return None
        if merged.geom_type == "MultiPolygon":
            merged = max(merged.geoms, key=lambda p: p.area)
        return Polygon(merged.exterior)  # filled footprint, interior partitions ignored
    return max(contained, key=lambda f: f.area)


def polygon_to_rings(poly: Polygon) -> tuple[Coords, list[Coords]]:
    """Shapely polygon → (exterior ring, interior hole rings) in page points."""
    exterior = [(float(x), float(y)) for x, y in poly.exterior.coords]
    holes = [[(float(x), float(y)) for x, y in ring.coords] for ring in poly.interiors]
    return exterior, holes
