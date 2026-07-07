"""GeometryEngine — deterministic geometry on Shapely. The measurement source
of truth: every area/length/count flows through here, never through a model."""

from __future__ import annotations

import math

from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union
from shapely.validation import make_valid

from app.schemas.detection import PolygonGeometry

Coords = list[tuple[float, float]]


def _polygonal_parts(g):
    """Extract the polygonal part(s) of any geometry make_valid() returns.
    A self-intersecting ring can come back as a GeometryCollection (polygon +
    stray line); keep only the polygon area instead of discarding it as zero."""
    if g.is_empty:
        return None
    if g.geom_type in ("Polygon", "MultiPolygon"):
        return g
    parts = [p for p in getattr(g, "geoms", []) if p.geom_type in ("Polygon", "MultiPolygon")]
    return unary_union(parts) if parts else None


class GeometryEngine:
    # Endpoints closer than this (page points; ~1/24 inch of paper) are snapped closed.
    CLOSE_TOLERANCE_PT = 3.0

    def build_polygon(
        self,
        sheet_id: str,
        exterior: Coords,
        holes: list[Coords] | None = None,
        derived_from: list[str] | None = None,
        refinement: str = "",
        assume_closed: bool = True,
        boundary_source: str = "unknown",
    ) -> PolygonGeometry:
        """Validate a candidate ring and compute deterministic area/length.

        assume_closed=True (mask contours, detector boxes): the last→first
        edge is implied, as in standard polygon rings.
        assume_closed=False (chains traced from vector linework): the ring
        must actually close — a gap <= CLOSE_TOLERANCE_PT is snapped shut,
        a larger gap yields is_closed=False and ZERO area so downstream
        flags it for review instead of guessing.
        """
        geom = PolygonGeometry(
            sheet_id=sheet_id,
            exterior=list(exterior),
            holes=[list(h) for h in (holes or [])],
            derived_from=list(derived_from or []),
            refinement=refinement,
            boundary_source=boundary_source,
        )
        if len(exterior) < 3:
            geom.is_closed = False
            geom.is_valid = False
            return geom

        first, last = exterior[0], exterior[-1]
        ring = list(exterior)
        if first != last:
            gap = math.dist(first, last)
            if not assume_closed and gap > self.CLOSE_TOLERANCE_PT:
                geom.is_closed = False
                geom.is_valid = False
                geom.length_pt = LineString(ring).length
                return geom
            if not assume_closed:
                ring[-1] = first  # snap: collapse the near-duplicate seam (no sliver vertex)
            else:
                ring.append(first)  # assume_closed: the last→first edge is implied

        # Keep only holes that actually sit inside the exterior — a mis-traced
        # void outside the ring would otherwise ADD area via make_valid/union.
        ext_poly = Polygon(ring)
        valid_holes = []
        for h in holes or []:
            if len(h) < 3:
                continue
            hp = Polygon(h)
            if hp.is_valid and not hp.is_empty and ext_poly.contains(hp.representative_point()):
                valid_holes.append(h)
        if len(valid_holes) < len(holes or []):
            geom.refinement = (geom.refinement + " + dropped out-of-bounds hole(s)").strip(" +")
        poly = Polygon(ring, valid_holes)
        if not poly.is_valid:
            fixed = _polygonal_parts(make_valid(poly))
            if fixed is None or fixed.is_empty:
                geom.is_valid = False
                return geom
            poly = fixed
            geom.refinement = (geom.refinement + " + make_valid").strip(" +")
        geom.area_pt2 = poly.area
        geom.length_pt = poly.length
        return geom

    def build_polyline(self, sheet_id: str, points: Coords, **kw) -> PolygonGeometry:
        geom = PolygonGeometry(sheet_id=sheet_id, kind="polyline", exterior=list(points), **kw)
        geom.is_closed = False
        geom.is_valid = len(points) >= 2
        if geom.is_valid:
            geom.length_pt = LineString(points).length
        return geom

    # --- spatial relations used by review flagging ----------------------

    def label_distance_pt(self, label_bbox: tuple[float, float, float, float], polygon: PolygonGeometry) -> float:
        """Distance from a label's center to the polygon (0 if inside)."""
        cx = (label_bbox[0] + label_bbox[2]) / 2
        cy = (label_bbox[1] + label_bbox[3]) / 2
        poly = self._to_shapely(polygon)
        if poly is None:
            return float("inf")
        pt = Point(cx, cy)
        return 0.0 if poly.contains(pt) else poly.distance(pt)

    def union_area_pt2(self, polygons: list[PolygonGeometry]) -> float:
        shapes = [s for p in polygons if (s := self._to_shapely(p)) is not None]
        if not shapes:
            return 0.0
        return unary_union(shapes).area

    def overlap_ratio(self, a: PolygonGeometry, b: PolygonGeometry) -> float:
        sa, sb = self._to_shapely(a), self._to_shapely(b)
        if sa is None or sb is None or sa.area == 0:
            return 0.0
        return sa.intersection(sb).area / sa.area

    def _to_shapely(self, g: PolygonGeometry) -> Polygon | None:
        if not g.is_closed or not g.is_valid or len(g.exterior) < 3:
            return None
        ring = list(g.exterior)
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        poly = Polygon(ring, [h for h in g.holes if len(h) >= 3])
        return poly if poly.is_valid else make_valid(poly)
