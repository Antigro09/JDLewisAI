"""Wall-network extraction from CAD linework.

Architect plans draw walls in one of a few styles (the sheet's own legend/key
says which): NEW partitions as pairs of parallel solid face lines (hollow),
occasionally as solid filled poché, and furred walls as a single new face line
against an existing (gray-filled) wall. Existing/demo work is drawn gray,
hatched, or dashed and is excluded upstream.

This module reconstructs wall RUNS rather than isolated rectangles:

  1. every solid sub-segment is projected into (angle, offset) "lanes" and
     collinear pieces are chained into maximal face lines;
  2. face lines are paired nearest-gap-first at plausible wall thickness,
     consuming intervals so a face can only belong to one wall;
  3. leftover face lines running along existing gray poché become single-face
     furring walls;
  4. filled dark poché (plans that draw new walls solid) and enclosed thin
     faces supplement the pair strips;
  5. collinear strips merge across small gaps (wall intersections), but never
     across a door opening.

Wall-type tags do NOT gate extraction — a tag marks a wall's type ("TYP"
means every similar wall), so tags are used later for attribution only.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from shapely import get_coordinates as shapely_get_coordinates
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry import box as shp_box
from shapely.strtree import STRtree

from app.geometry.linework import (
    _angle_delta,
    _axis_aligned_rect_parts,
    _is_gray_linework,
    _polygon_from_path,
    _rect_sides,
    polygonize_faces,
)
from app.schemas.core import VectorPath

_DOOR_VETO_PAD_PT = 18.0  # door leaves/panels are drawn beside their mark


def _is_strongly_colored(color: str) -> bool:
    """Red/green/blue markup strokes (grids, demo lines) are never wall faces."""
    if not color.startswith("#") or len(color) != 7:
        return False
    try:
        r = int(color[1:3], 16)
        g = int(color[3:5], 16)
        b = int(color[5:7], 16)
    except ValueError:
        return False
    return max(r, g, b) - min(r, g, b) > 40

BBox = tuple[float, float, float, float]

_ANGLE_BIN_DEG = 2.0
_LANE_OFFSET_TOL_PT = 0.8
_LANE_INTERVAL_BRIDGE_PT = 1.5


# --------------------------------------------------------------------------
# interval bookkeeping
# --------------------------------------------------------------------------

class _Intervals:
    """Sorted, disjoint [t0, t1] interval set with subtract/intersect."""

    def __init__(self, spans: list[tuple[float, float]] | None = None):
        self.spans: list[tuple[float, float]] = []
        for t0, t1 in spans or []:
            self.add(t0, t1)

    def add(self, t0: float, t1: float, bridge: float = 0.0) -> None:
        if t1 <= t0:
            return
        merged = [(t0, t1)]
        rest = []
        for s0, s1 in self.spans:
            m0, m1 = merged[0]
            if s1 + bridge < m0 or s0 - bridge > m1:
                rest.append((s0, s1))
            else:
                merged = [(min(s0, m0), max(s1, m1))]
        rest.append(merged[0])
        rest.sort()
        self.spans = rest

    def rebridge(self, bridge: float) -> None:
        spans, self.spans = self.spans, []
        for t0, t1 in spans:
            self.add(t0, t1, bridge=bridge)

    def intersect(self, other: _Intervals) -> list[tuple[float, float]]:
        out = []
        for a0, a1 in self.spans:
            for b0, b1 in other.spans:
                lo, hi = max(a0, b0), min(a1, b1)
                if hi > lo:
                    out.append((lo, hi))
        return out

    def subtract(self, t0: float, t1: float) -> None:
        out = []
        for s0, s1 in self.spans:
            if s1 <= t0 or s0 >= t1:
                out.append((s0, s1))
                continue
            if s0 < t0:
                out.append((s0, t0))
            if s1 > t1:
                out.append((t1, s1))
        self.spans = out

    def pieces(self, min_length: float) -> list[tuple[float, float]]:
        return [(t0, t1) for t0, t1 in self.spans if t1 - t0 >= min_length]


@dataclass
class _Lane:
    """A maximal collinear family of solid face-line segments."""

    u: tuple[float, float]
    n: tuple[float, float]
    angle: float
    ncoord: float
    intervals: _Intervals = field(default_factory=_Intervals)
    weight: float = 0.0
    max_stroke: float = 0.0

    def merge_stats(self, ncoord: float, length: float, stroke: float) -> None:
        total = self.weight + length
        if total > 0:
            self.ncoord = (self.ncoord * self.weight + ncoord * length) / total
        self.weight = total
        self.max_stroke = max(self.max_stroke, stroke)


@dataclass
class WallStrip:
    """One extracted wall segment: an exact rectangle plus its centerline data."""

    poly: Polygon
    length_pt: float
    thickness_pt: float
    angle: float
    u: tuple[float, float]
    n: tuple[float, float]
    ncenter: float
    t0: float
    t1: float
    source: str  # pair | furring | body | face
    bridged_pt: float = 0.0     # footage measured THROUGH door/window openings
    bridged_openings: int = 0


def _segment_basis(a: tuple[float, float], b: tuple[float, float]):
    length = math.dist(a, b)
    if length <= 0:
        return None
    ux, uy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
    if ux < -1e-9 or (abs(ux) <= 1e-9 and uy < 0):
        ux, uy = -ux, -uy
    nx, ny = -uy, ux
    t0 = a[0] * ux + a[1] * uy
    t1 = b[0] * ux + b[1] * uy
    if t1 < t0:
        t0, t1 = t1, t0
    ncoord = a[0] * nx + a[1] * ny
    angle = math.degrees(math.atan2(uy, ux)) % 180.0
    return ux, uy, nx, ny, t0, t1, ncoord, angle, length


def _strip_polygon(u, n, t0, t1, n0, n1) -> Polygon:
    def pt(t, nc):
        return (u[0] * t + n[0] * nc, u[1] * t + n[1] * nc)

    return Polygon([pt(t0, n0), pt(t1, n0), pt(t1, n1), pt(t0, n1), pt(t0, n0)])


def _build_lanes(
    vector_paths: list[VectorPath],
    *,
    min_segment_pt: float = 2.5,
    min_stroke_pt: float = 0.0,
    axis_tolerance_deg: float = 12.0,
) -> list[_Lane]:
    """Chain every solid sub-segment into collinear lanes (per angle+offset).

    Off-axis segments are excluded: diagonal hatch fills pair at exactly wall
    spacing, and both test plan sets draw partitions rectilinear. Diagonal
    walls remain a known gap (they need a hatch-density-aware relaxation).
    """
    lanes: dict[int, list[_Lane]] = {}
    for vp in vector_paths:
        if vp.dashes:
            continue
        if "stroke" not in vp.kind and vp.kind != "fill_stroke":
            # pure fills contribute poché bodies, not face lines
            continue
        if vp.stroke_width and vp.stroke_width < min_stroke_pt:
            continue
        if _is_gray_linework(vp.color) or _is_strongly_colored(vp.color):
            continue
        for sub in vp.points:
            for a, b in zip(sub, sub[1:], strict=False):
                basis = _segment_basis(a, b)
                if basis is None:
                    continue
                ux, uy, nx, ny, t0, t1, ncoord, angle, length = basis
                if length < min_segment_pt:
                    continue
                if (
                    _angle_delta(angle, 0) > axis_tolerance_deg
                    and _angle_delta(angle, 90) > axis_tolerance_deg
                ):
                    continue
                key = int(round(angle / _ANGLE_BIN_DEG)) % int(180 / _ANGLE_BIN_DEG)
                lane = None
                for candidate in lanes.get(key, []):
                    if (
                        abs(candidate.ncoord - ncoord) <= _LANE_OFFSET_TOL_PT
                        and _angle_delta(candidate.angle, angle) <= _ANGLE_BIN_DEG
                    ):
                        lane = candidate
                        break
                if lane is None:
                    lane = _Lane(u=(ux, uy), n=(nx, ny), angle=angle, ncoord=ncoord)
                    lanes.setdefault(key, []).append(lane)
                lane.intervals.add(t0, t1, bridge=_LANE_INTERVAL_BRIDGE_PT)
                lane.merge_stats(ncoord, length, vp.stroke_width or 0.0)
    out = [lane for group in lanes.values() for lane in group if lane.intervals.spans]
    return out


def _wall_stroke_floor(lanes: list[_Lane]) -> float:
    """Adaptive wall-lineweight floor: walls plot with the heaviest pen that
    still carries substantial total length on the sheet. When the drawing uses
    one uniform width (or no widths at all), the floor degrades to 0 and the
    geometric filters carry the load alone."""
    total = sum(lane.weight for lane in lanes)
    if total <= 0:
        return 0.0
    by_width: dict[float, float] = {}
    for lane in lanes:
        by_width[round(lane.max_stroke, 2)] = by_width.get(round(lane.max_stroke, 2), 0.0) + lane.weight
    # A thin sliver of extra-heavy strokes (sheet borders, section flags) must
    # not claim the wall-pen slot: the wall class carries a meaningful share
    # of the sheet's ink (RCPs plot walls one pen lighter than floor plans).
    need = max(400.0, total * 0.06)
    cumulative = 0.0
    for width in sorted(by_width, reverse=True):
        cumulative += by_width[width]
        if cumulative >= need:
            if width <= 0.01:
                return 0.0
            return width * 0.72
    return 0.0


def _pair_lanes(
    lanes: list[_Lane],
    *,
    min_thickness_pt: float,
    max_thickness_pt: float,
    min_length_pt: float,
    stroke_floor_pt: float = 0.0,
    excluded: list[Polygon] | None = None,
) -> list[WallStrip]:
    """Nearest-gap-first pairing; intervals are consumed so each face line can
    belong to at most one wall (prevents cross-room and 3-lane double pairing).
    A pairing that lands inside an exclusion is skipped WITHOUT consuming, so
    the face line stays available to the furring pass (a new lining wall's
    face would otherwise be eaten by its pairing with the existing outline)."""
    exc_tree = STRtree(excluded) if excluded else None
    by_key: dict[int, list[_Lane]] = {}
    for lane in lanes:
        key = int(round(lane.angle / (_ANGLE_BIN_DEG * 2)))
        by_key.setdefault(key, []).append(lane)

    pairings: list[tuple[float, _Lane, _Lane]] = []
    for _key, group in by_key.items():
        group.sort(key=lambda lane: lane.ncoord)
        for i, a in enumerate(group):
            for b in group[i + 1:]:
                gap = b.ncoord - a.ncoord
                if gap > max_thickness_pt:
                    break
                if gap < min_thickness_pt:
                    continue
                # a lining/furred wall pairs its heavy new face with a lighter
                # existing outline, so only ONE face must carry the wall pen —
                # but the other may not be featherweight detail linework
                if max(a.max_stroke, b.max_stroke) < stroke_floor_pt:
                    continue
                if min(a.max_stroke, b.max_stroke) < stroke_floor_pt * 0.5:
                    continue
                if _angle_delta(a.angle, b.angle) > _ANGLE_BIN_DEG * 1.5:
                    continue
                pairings.append((gap, a, b))
    pairings.sort(key=lambda item: item[0])

    strips: list[WallStrip] = []
    for gap, a, b in pairings:
        overlap = _Intervals(a.intervals.spans).intersect(b.intervals)
        for t0, t1 in overlap:
            piece_min = max(min_length_pt, gap * 1.6)
            if t1 - t0 < piece_min:
                continue
            poly = _strip_polygon(a.u, a.n, t0, t1, a.ncoord, b.ncoord)
            if not poly.is_valid or poly.is_empty:
                continue
            if exc_tree is not None:
                probe = poly.representative_point()
                skip = False
                for idx in exc_tree.query(poly):
                    other = excluded[int(idx)]
                    if other.covers(probe) or other.intersection(poly).area >= 0.3 * poly.area:
                        skip = True
                        break
                if skip:
                    continue  # do NOT consume the intervals
            strips.append(
                WallStrip(
                    poly=poly,
                    length_pt=t1 - t0,
                    thickness_pt=gap,
                    angle=a.angle,
                    u=a.u,
                    n=a.n,
                    ncenter=(a.ncoord + b.ncoord) / 2,
                    t0=t0,
                    t1=t1,
                    source="pair",
                )
            )
            a.intervals.subtract(t0, t1)
            b.intervals.subtract(t0, t1)
    return strips


def _furring_strips(
    lanes: list[_Lane],
    poche_polys: list[Polygon],
    *,
    min_thickness_pt: float,
    max_thickness_pt: float,
    min_length_pt: float,
    stroke_floor_pt: float = 0.0,
) -> list[WallStrip]:
    """A single new face line running along existing gray poché is a furred
    wall: pair the leftover face line with the poché edge."""
    if not poche_polys:
        return []
    tree = STRtree(poche_polys)
    strips: list[WallStrip] = []
    for lane in lanes:
        if lane.max_stroke < stroke_floor_pt:
            continue
        for t0, t1 in lane.intervals.pieces(max(min_length_pt, 18.0)):
            mid_t = (t0 + t1) / 2
            for direction in (1.0, -1.0):
                # probe outward from the face line for a parallel poché band
                hit_distance = None
                for step in (2.0, 3.0, 4.5, 6.0, 8.0, 10.0):
                    if step > max_thickness_pt + 2.0:
                        break
                    probe = Point(
                        lane.u[0] * mid_t + lane.n[0] * (lane.ncoord + direction * step),
                        lane.u[1] * mid_t + lane.n[1] * (lane.ncoord + direction * step),
                    )
                    idx = tree.query(probe, predicate="covers")
                    if len(idx):
                        hit_distance = step
                        break
                if hit_distance is None:
                    continue
                # confirm the poché runs the length of the piece, not a corner
                quarter = t0 + (t1 - t0) * 0.25
                three_q = t0 + (t1 - t0) * 0.75
                confirmed = 0
                for tt in (quarter, three_q):
                    probe = Point(
                        lane.u[0] * tt + lane.n[0] * (lane.ncoord + direction * hit_distance),
                        lane.u[1] * tt + lane.n[1] * (lane.ncoord + direction * hit_distance),
                    )
                    if len(tree.query(probe, predicate="covers")):
                        confirmed += 1
                if confirmed < 2:
                    continue
                thickness = min(max(hit_distance, min_thickness_pt), max_thickness_pt)
                n1 = lane.ncoord
                n2 = lane.ncoord + direction * thickness
                poly = _strip_polygon(lane.u, lane.n, t0, t1, min(n1, n2), max(n1, n2))
                if not poly.is_valid or poly.is_empty:
                    continue
                strips.append(
                    WallStrip(
                        poly=poly,
                        length_pt=t1 - t0,
                        thickness_pt=thickness,
                        angle=lane.angle,
                        u=lane.u,
                        n=lane.n,
                        ncenter=(n1 + n2) / 2,
                        t0=t0,
                        t1=t1,
                        source="furring",
                    )
                )
                lane.intervals.subtract(t0, t1)
                break
    return strips


def _is_dark_fill(color: str) -> bool:
    if not color.startswith("#") or len(color) != 7:
        return False
    try:
        r = int(color[1:3], 16)
        g = int(color[3:5], 16)
        b = int(color[5:7], 16)
    except ValueError:
        return False
    return (r + g + b) / 3 <= 90


def _body_strips(
    vector_paths: list[VectorPath],
    *,
    min_thickness_pt: float,
    max_thickness_pt: float,
    min_length_pt: float,
) -> list[WallStrip]:
    """Solid dark poché bodies, for plan sets that fill new walls black."""
    strips: list[WallStrip] = []
    for vp in vector_paths:
        if "fill" not in vp.kind or vp.dashes:
            continue
        if not _is_dark_fill(vp.fill_color or vp.color):
            continue
        poly = _polygon_from_path(vp)
        if poly is None:
            continue
        parts = [poly]
        short, long_side = _rect_sides(poly)
        rectangularity = poly.area / max(1.0, short * long_side)
        if not (short <= max_thickness_pt and rectangularity >= 0.72):
            parts = _axis_aligned_rect_parts(poly)
        for part in parts:
            strip = _strip_from_rect(part, source="body")
            if strip is None:
                continue
            if not (min_thickness_pt <= strip.thickness_pt <= max_thickness_pt):
                continue
            if strip.length_pt < max(min_length_pt, strip.thickness_pt * 1.6):
                continue
            strips.append(strip)
    return strips


def _strip_from_rect(poly: Polygon, source: str) -> WallStrip | None:
    if poly.is_empty or not poly.is_valid:
        return None
    rect = poly.minimum_rotated_rectangle
    if not isinstance(rect, Polygon):
        return None
    coords = list(rect.exterior.coords)
    edges = [(coords[i], coords[i + 1], math.dist(coords[i], coords[i + 1])) for i in range(4)]
    (a, b, long_len) = max(edges, key=lambda e: e[2])
    short_len = min(e[2] for e in edges)
    if long_len <= 0 or short_len <= 0:
        return None
    basis = _segment_basis(a, b)
    if basis is None:
        return None
    ux, uy, nx, ny, t0, t1, ncoord, angle, _ = basis
    center = rect.centroid
    ncenter = center.x * nx + center.y * ny
    return WallStrip(
        poly=rect,
        length_pt=long_len,
        thickness_pt=short_len,
        angle=angle,
        u=(ux, uy),
        n=(nx, ny),
        ncenter=ncenter,
        t0=t0,
        t1=t1,
        source=source,
    )


def _face_strips(
    faces: list[Polygon],
    existing: list[WallStrip],
    *,
    min_thickness_pt: float,
    max_thickness_pt: float,
    min_length_pt: float,
) -> list[WallStrip]:
    """Enclosed thin faces (hollow wall segments capped at both ends) that the
    lane pairing did not already cover."""
    strips: list[WallStrip] = []
    kept_polys = [s.poly for s in existing]
    tree = STRtree(kept_polys) if kept_polys else None
    for face in faces:
        short, long_side = _rect_sides(face)
        if not (min_thickness_pt <= short <= max_thickness_pt):
            continue
        if long_side < max(min_length_pt, short * 1.6):
            continue
        if long_side / max(short, 0.001) < 1.6:
            continue
        if face.area / max(1.0, short * long_side) < 0.72:
            continue
        strip_probe = _strip_from_rect(face, source="face")
        if strip_probe is None or (
            _angle_delta(strip_probe.angle, 0) > 12.0
            and _angle_delta(strip_probe.angle, 90) > 12.0
        ):
            # diagonal thin faces are almost always hatch slivers
            continue
        if tree is not None:
            covered = 0.0
            for idx in tree.query(face):
                other = kept_polys[int(idx)]
                covered += face.intersection(other).area
            if covered >= 0.45 * face.area:
                continue
        strip = _strip_from_rect(face, source="face")
        if strip is not None:
            strips.append(strip)
    return strips


def _boxes_between(t_a: float, t_b: float, strip: WallStrip, boxes: list[BBox]) -> bool:
    """Is a door/opening box straddling the gap [t_a, t_b] along the strip axis?"""
    if not boxes:
        return False
    gap_mid_t = (t_a + t_b) / 2
    px = strip.u[0] * gap_mid_t + strip.n[0] * strip.ncenter
    py = strip.u[1] * gap_mid_t + strip.n[1] * strip.ncenter
    pad = 4.0
    return any(
        (x0 - pad) <= px <= (x1 + pad) and (y0 - pad) <= py <= (y1 + pad)
        for x0, y0, x1, y1 in boxes
    )


def merge_collinear_strips(
    strips: list[WallStrip],
    *,
    merge_gap_pt: float = 8.0,
    door_boxes: list[BBox] | None = None,
) -> list[WallStrip]:
    """Merge collinear same-thickness strips across small gaps (intersection
    cuts and CAD joints) but never across a door/opening box."""
    door_boxes = door_boxes or []
    groups: dict[int, list[WallStrip]] = {}
    for strip in strips:
        key = int(round(strip.angle / (_ANGLE_BIN_DEG * 2)))
        groups.setdefault(key, []).append(strip)

    merged: list[WallStrip] = []
    for group in groups.values():
        group.sort(key=lambda s: (round(s.ncenter, 1), s.t0))
        chains: list[list[WallStrip]] = []
        for strip in group:
            chain = None
            for existing in chains:
                last = existing[-1]
                if (
                    abs(last.ncenter - strip.ncenter) <= max(1.4, last.thickness_pt * 0.35)
                    and abs(last.thickness_pt - strip.thickness_pt) <= max(1.8, last.thickness_pt * 0.5)
                    and strip.t0 - last.t1 <= merge_gap_pt
                    and strip.t1 > last.t1 - 0.5
                    and not _boxes_between(last.t1, strip.t0, last, door_boxes)
                ):
                    chain = existing
                    break
            if chain is None:
                chains.append([strip])
            else:
                chain.append(strip)
        for chain in chains:
            if len(chain) == 1:
                merged.append(chain[0])
                continue
            t0 = min(s.t0 for s in chain)
            t1 = max(s.t1 for s in chain)
            weight = sum(s.length_pt for s in chain)
            thickness = sum(s.thickness_pt * s.length_pt for s in chain) / max(weight, 0.001)
            ncenter = sum(s.ncenter * s.length_pt for s in chain) / max(weight, 0.001)
            first = chain[0]
            poly = _strip_polygon(
                first.u, first.n, t0, t1, ncenter - thickness / 2, ncenter + thickness / 2
            )
            merged.append(
                WallStrip(
                    poly=poly,
                    length_pt=t1 - t0,
                    thickness_pt=thickness,
                    angle=first.angle,
                    u=first.u,
                    n=first.n,
                    ncenter=ncenter,
                    t0=t0,
                    t1=t1,
                    source="+".join(sorted({s.source for s in chain})),
                )
            )
    return merged


def existing_wall_bands(
    poche_polys: list[Polygon],
    *,
    tag_points: list[tuple[float, float]] | None = None,
    bridge_gap_pt: float = 60.0,
    max_band_thickness_pt: float = 24.0,
) -> list[Polygon]:
    """Bridge collinear existing-wall poché pieces across their door/window
    openings: the glazing or door drawn in an existing wall's opening is
    existing too, and must not pair into a "new wall". A gap that carries a
    wall-type tag is genuinely new infill and is left open."""
    strips: list[WallStrip] = []
    for poly in poche_polys:
        strip = _strip_from_rect(poly, source="poche")
        if strip is None:
            continue
        if strip.thickness_pt > max_band_thickness_pt:
            continue
        if strip.length_pt < strip.thickness_pt * 1.2:
            continue
        strips.append(strip)
    merged = merge_collinear_strips(strips, merge_gap_pt=bridge_gap_pt, door_boxes=[])
    out: list[Polygon] = []
    tag_points = tag_points or []
    for strip in merged:
        poly = strip.poly
        if tag_points and any(poly.distance(Point(x, y)) <= 14.0 for x, y in tag_points):
            continue  # a tagged gap is new work — keep it takeable
        out.append(poly)
    return out


def extend_rect_bands(polys: list[Polygon], extend_pt: float = 60.0) -> list[Polygon]:
    """Stretch wall rectangles along their long axis — the openings (windows,
    doors) punched through an EXISTING wall are existing too, and the glazing
    drawn inside them must not read as a thin new wall."""
    out: list[Polygon] = []
    for poly in polys:
        strip = _strip_from_rect(poly, source="band")
        if strip is None:
            continue
        band = _strip_polygon(
            strip.u,
            strip.n,
            strip.t0 - extend_pt,
            strip.t1 + extend_pt,
            strip.ncenter - strip.thickness_pt / 2 - 0.5,
            strip.ncenter + strip.thickness_pt / 2 + 0.5,
        )
        if band.is_valid and not band.is_empty:
            out.append(band)
    return out


def _interior_tick_count(strip: WallStrip, all_lanes: list[_Lane], stroke_floor_pt: float = 0.0) -> int:
    """Full-span perpendicular HEAVY ticks through the strip interior, away
    from its ends. Real wall interiors are clean (jamb caps sit at segment
    ends and crossing partitions stop at the wall face); banquettes, casework,
    shelving and tile bands are subdivided every couple of feet. Light
    dimension/extension lines crossing a wall must not count against it."""
    end_margin = max(3.0, strip.thickness_pt * 1.5)
    lo_t, hi_t = strip.t0 + end_margin, strip.t1 - end_margin
    if hi_t <= lo_t:
        return 0
    lo_n = strip.ncenter - strip.thickness_pt / 2 + 0.6
    hi_n = strip.ncenter + strip.thickness_pt / 2 - 0.6
    if hi_n <= lo_n:
        return 0
    count = 0
    max_tick_extent = max(strip.thickness_pt * 3.5, 30.0)
    for lane in all_lanes:
        if lane.max_stroke < stroke_floor_pt:
            continue
        if _angle_delta(lane.angle, strip.angle + 90.0) > 3.0:
            continue
        # a crossing PARTITION's face line is long; a millwork divider tick is
        # barely longer than the strip is thick — only the short ones count
        if sum(s1 - s0 for s0, s1 in lane.intervals.spans) > max_tick_extent:
            continue
        for s0, s1 in lane.intervals.spans:
            pa = (lane.u[0] * s0 + lane.n[0] * lane.ncoord, lane.u[1] * s0 + lane.n[1] * lane.ncoord)
            pb = (lane.u[0] * s1 + lane.n[0] * lane.ncoord, lane.u[1] * s1 + lane.n[1] * lane.ncoord)
            t_a = pa[0] * strip.u[0] + pa[1] * strip.u[1]
            t_b = pb[0] * strip.u[0] + pb[1] * strip.u[1]
            n_a = pa[0] * strip.n[0] + pa[1] * strip.n[1]
            n_b = pb[0] * strip.n[0] + pb[1] * strip.n[1]
            t_mid = (t_a + t_b) / 2
            if not (lo_t < t_mid < hi_t):
                continue
            if min(n_a, n_b) <= lo_n + 0.5 and max(n_a, n_b) >= hi_n - 0.5:
                count += 1
                break  # one tick per lane is enough evidence
    return count


def _strip_interior_conflicts(
    strip: WallStrip,
    lanes_by_key: dict[int, list[_Lane]],
    stroke_floor_pt: float = 0.0,
) -> bool:
    """A third parallel HEAVY face line INSIDE the strip means we paired across
    two different walls — reject. Light finish/pattern lines inside a wall
    body are normal and must not kill it."""
    key = int(round(strip.angle / (_ANGLE_BIN_DEG * 2)))
    inner_margin = min(1.2, strip.thickness_pt * 0.25)
    lo = strip.ncenter - strip.thickness_pt / 2 + inner_margin
    hi = strip.ncenter + strip.thickness_pt / 2 - inner_margin
    if hi <= lo:
        return False
    foreign = 0.0
    for lane in lanes_by_key.get(key, []):
        if lane.max_stroke < stroke_floor_pt:
            continue
        if not (lo < lane.ncoord < hi):
            continue
        if _angle_delta(lane.angle, strip.angle) > _ANGLE_BIN_DEG * 1.5:
            continue
        overlap = _Intervals(lane.intervals.spans).intersect(
            _Intervals([(strip.t0, strip.t1)])
        )
        foreign += sum(t1 - t0 for t0, t1 in overlap)
    return foreign > 0.18 * strip.length_pt


def extract_wall_strips(
    vector_paths: list[VectorPath],
    faces: list[Polygon],
    *,
    exclude_polygons: list[Polygon] | None = None,
    poche_polygons: list[Polygon] | None = None,
    text_boxes: list[Polygon] | None = None,
    door_boxes: list[BBox] | None = None,
    min_thickness_pt: float = 2.2,
    max_thickness_pt: float = 20.0,
    min_length_pt: float = 6.0,
    merge_gap_pt: float = 8.0,
    tagged_wall_polys: list[Polygon] | None = None,
) -> list[WallStrip]:
    """Extract merged wall runs from plan linework. See module docstring.

    `tagged_wall_polys` are wall bodies a wall-type tag's leader points at —
    authoritative NEW walls regardless of their drawing style (some sets poché
    a new partition gray when it matches existing construction)."""
    excluded = [poly.buffer(0.5) for poly in (exclude_polygons or [])]
    text_boxes = text_boxes or []
    door_boxes = door_boxes or []

    lanes = _build_lanes(vector_paths, min_stroke_pt=0.0)
    stroke_floor = _wall_stroke_floor(lanes)
    # keep a snapshot of every lane for the interior-conflict test (pairing
    # consumes intervals destructively)
    lanes_by_key: dict[int, list[_Lane]] = {}
    for lane in lanes:
        snapshot = _Lane(u=lane.u, n=lane.n, angle=lane.angle, ncoord=lane.ncoord)
        snapshot.intervals = _Intervals(lane.intervals.spans)
        snapshot.max_stroke = lane.max_stroke
        key = int(round(lane.angle / (_ANGLE_BIN_DEG * 2)))
        lanes_by_key.setdefault(key, []).append(snapshot)

    strips = _pair_lanes(
        lanes,
        min_thickness_pt=min_thickness_pt,
        max_thickness_pt=max_thickness_pt,
        min_length_pt=min_length_pt,
        stroke_floor_pt=stroke_floor,
        excluded=excluded,
    )
    for poly in tagged_wall_polys or []:
        strip = _strip_from_rect(poly, source="tagged")
        if strip is not None and strip.thickness_pt <= max_thickness_pt * 1.2:
            strips.append(strip)
    strips.extend(
        _furring_strips(
            lanes,
            poche_polygons or [],
            min_thickness_pt=min_thickness_pt,
            max_thickness_pt=max_thickness_pt,
            min_length_pt=max(min_length_pt, 18.0),
            stroke_floor_pt=stroke_floor,
        )
    )
    strips.extend(
        _body_strips(
            vector_paths,
            min_thickness_pt=min_thickness_pt,
            max_thickness_pt=max_thickness_pt,
            min_length_pt=min_length_pt,
        )
    )

    strips = _filter_strips(
        strips,
        excluded=excluded,
        text_boxes=text_boxes,
        door_boxes=door_boxes,
        lanes_by_key=lanes_by_key,
        stroke_floor_pt=stroke_floor,
    )
    # Enclosed thin faces catch capped wall segments the lane pairing missed.
    # When lineweights exist, only heavy linework may form these faces —
    # otherwise every drawn cavity (niches, pockets, casework) becomes a wall.
    if stroke_floor > 0:
        heavy_paths = [
            vp for vp in vector_paths
            if not vp.dashes
            and ("stroke" in vp.kind or vp.kind == "fill_stroke")
            and (vp.stroke_width or 0.0) >= stroke_floor
            and not _is_gray_linework(vp.color)
            and not _is_strongly_colored(vp.color)
        ]
        wall_faces = polygonize_faces(heavy_paths, min_area_pt2=24.0)
    else:
        wall_faces = faces
    strips.extend(
        _filter_strips(
            _face_strips(
                wall_faces,
                strips,
                min_thickness_pt=min_thickness_pt,
                max_thickness_pt=max_thickness_pt,
                min_length_pt=min_length_pt,
            ),
            excluded=excluded,
            text_boxes=text_boxes,
            door_boxes=door_boxes,
            lanes_by_key=None,
            stroke_floor_pt=stroke_floor,
        )
    )
    strips = _dedupe_strips(strips)
    strips = _drop_dashed_chains(strips)
    merged = merge_collinear_strips(strips, merge_gap_pt=merge_gap_pt, door_boxes=door_boxes)
    all_lanes = [lane for group in lanes_by_key.values() for lane in group]
    diag_lines = _diagonal_lines(vector_paths)
    diag_tree = STRtree(diag_lines) if diag_lines else None
    out = []
    for strip in merged:
        if strip.length_pt < max(6.0, strip.thickness_pt * 1.5):
            continue
        if strip.thickness_pt > max_thickness_pt * 1.1:
            continue  # merged past any scheduled size → graphic block, not a wall
        if _interior_tick_count(strip, all_lanes, stroke_floor) >= 3:
            continue  # subdivided every few feet → millwork/banquette/tile, not a wall
        if diag_tree is not None and _is_hatch_filled(strip, diag_tree, diag_lines):
            continue  # diagonal hatch running through the body → hatched band, not a wall
        out.append(strip)
    # estimators measure walls THROUGH their openings: connect runs across
    # doors/windows, then extend door-adjacent ends to the wall beyond
    out = bridge_runs_across_openings(out, door_boxes=door_boxes, all_lanes=all_lanes)
    out = extend_ends_through_openings(
        out, door_boxes=door_boxes, poche_polys=poche_polygons or []
    )
    return out


def _fuse(a: WallStrip, b: WallStrip, gap: float) -> WallStrip:
    """One continuous run from two collinear strips, measuring THROUGH the gap."""
    weight = a.length_pt + b.length_pt
    thickness = (a.thickness_pt * a.length_pt + b.thickness_pt * b.length_pt) / max(weight, 0.001)
    ncenter = (a.ncenter * a.length_pt + b.ncenter * b.length_pt) / max(weight, 0.001)
    poly = _strip_polygon(a.u, a.n, a.t0, b.t1, ncenter - thickness / 2, ncenter + thickness / 2)
    return WallStrip(
        poly=poly,
        length_pt=b.t1 - a.t0,
        thickness_pt=thickness,
        angle=a.angle,
        u=a.u,
        n=a.n,
        ncenter=ncenter,
        t0=a.t0,
        t1=b.t1,
        source=a.source if a.source == b.source else f"{a.source}+{b.source}",
        bridged_pt=a.bridged_pt + b.bridged_pt + max(gap, 0.0),
        bridged_openings=a.bridged_openings + b.bridged_openings + 1,
    )


def _gap_has_opening_evidence(
    run: WallStrip,
    gap_t0: float,
    gap_t1: float,
    door_boxes: list[BBox],
    all_lanes: list[_Lane],
) -> bool:
    """A gap between collinear runs is an OPENING (bridge it) when a door box
    sits in it, or a sill/header/glazing line runs along it. A bare gap is a
    genuine wall end (corridor mouth) and must stay open."""
    if _boxes_between(gap_t0, gap_t1, run, door_boxes):
        return True
    gap_len = gap_t1 - gap_t0
    if gap_len <= 0:
        return False
    corridor = run.thickness_pt / 2 + 1.5
    for lane in all_lanes:
        if _angle_delta(lane.angle, run.angle) > 3.0:
            continue
        if abs(lane.ncoord - run.ncenter) > corridor:
            continue
        covered = sum(
            max(0.0, min(s1, gap_t1) - max(s0, gap_t0)) for s0, s1 in lane.intervals.spans
        )
        if covered >= 0.6 * gap_len:
            return True
    return False


def bridge_runs_across_openings(
    strips: list[WallStrip],
    *,
    door_boxes: list[BBox],
    all_lanes: list[_Lane],
    opening_gap_pt: float = 100.0,
) -> list[WallStrip]:
    """Estimators measure a wall THROUGH its door/window openings: fuse
    collinear same-thickness runs whose gap shows opening evidence."""
    groups: dict[int, list[WallStrip]] = {}
    for strip in strips:
        groups.setdefault(int(round(strip.angle / (_ANGLE_BIN_DEG * 2))), []).append(strip)

    out: list[WallStrip] = []
    for group in groups.values():
        group.sort(key=lambda s: (round(s.ncenter, 1), s.t0))
        fused: list[WallStrip] = []
        for strip in group:
            last = fused[-1] if fused else None
            if (
                last is not None
                and abs(last.ncenter - strip.ncenter) <= max(1.6, last.thickness_pt * 0.4)
                and abs(last.thickness_pt - strip.thickness_pt) <= max(2.0, last.thickness_pt * 0.5)
                and 0.0 < strip.t0 - last.t1 <= opening_gap_pt
                and _gap_has_opening_evidence(last, last.t1, strip.t0, door_boxes, all_lanes)
            ):
                fused[-1] = _fuse(last, strip, strip.t0 - last.t1)
            else:
                fused.append(strip)
        out.extend(fused)
    return out


def extend_ends_through_openings(
    strips: list[WallStrip],
    *,
    door_boxes: list[BBox],
    poche_polys: list[Polygon],
    opening_gap_pt: float = 100.0,
) -> list[WallStrip]:
    """A run ending at a door/window against an EXISTING wall (or a
    perpendicular new wall) extends through the opening to touch it."""
    if not strips:
        return strips
    targets: list[Polygon] = [s.poly for s in strips] + list(poche_polys)
    tree = STRtree(targets)
    door_polys = [shp_box(*b) for b in door_boxes]
    door_tree = STRtree(door_polys) if door_polys else None

    out: list[WallStrip] = []
    for idx, strip in enumerate(strips):
        current = strip
        for direction, t_end in ((1.0, current.t1), (-1.0, current.t0)):
            t_end = current.t1 if direction > 0 else current.t0
            lo = t_end if direction > 0 else t_end - opening_gap_pt
            hi = t_end + opening_gap_pt if direction > 0 else t_end
            probe = _strip_polygon(
                current.u, current.n, lo, hi,
                current.ncenter - current.thickness_pt / 2,
                current.ncenter + current.thickness_pt / 2,
            )
            if door_tree is None:
                break
            has_door = any(
                door_polys[int(i)].intersection(probe).area >= 24.0
                for i in door_tree.query(probe)
            )
            if not has_door:
                continue
            # nearest target edge along the probe direction
            best: float | None = None
            for i in tree.query(probe):
                if int(i) == idx:
                    continue
                inter = targets[int(i)].intersection(probe)
                if inter.is_empty or inter.area < 1.0:
                    continue
                for x, y in shapely_get_coordinates(inter):
                    t = x * current.u[0] + y * current.u[1]
                    dist = (t - t_end) * direction
                    if dist > 0.5 and (best is None or dist < best):
                        best = dist
            if best is not None and best <= opening_gap_pt:
                new_t0 = current.t0 - best if direction < 0 else current.t0
                new_t1 = current.t1 + best if direction > 0 else current.t1
                current = WallStrip(
                    poly=_strip_polygon(
                        current.u, current.n, new_t0, new_t1,
                        current.ncenter - current.thickness_pt / 2,
                        current.ncenter + current.thickness_pt / 2,
                    ),
                    length_pt=new_t1 - new_t0,
                    thickness_pt=current.thickness_pt,
                    angle=current.angle,
                    u=current.u,
                    n=current.n,
                    ncenter=current.ncenter,
                    t0=new_t0,
                    t1=new_t1,
                    source=current.source,
                    bridged_pt=current.bridged_pt + best,
                    bridged_openings=current.bridged_openings + 1,
                )
        out.append(current)
    return out


def _drop_dashed_chains(
    strips: list[WallStrip],
    *,
    max_piece_pt: float = 48.0,
    max_gap_pt: float = 30.0,
    min_run: int = 4,
) -> list[WallStrip]:
    """Drop chains of many short collinear pieces with regular small gaps.

    CAD plots dash-dot linetypes (soffits, ceiling breaks, items above) as
    SEPARATE short solid strokes, so the dash-pattern skip never sees them —
    but paired dashes masquerade as runs of foot-long walls. Real short wall
    pieces don't come 4-in-a-row with sub-2ft gaps: door piers are separated
    by full openings and column wraps by whole bays."""
    groups: dict[tuple[int, int, int], list[WallStrip]] = {}
    for strip in strips:
        key = (
            int(round(strip.angle / (_ANGLE_BIN_DEG * 2))),
            int(round(strip.ncenter / 2.0)),
            int(round(strip.thickness_pt / 2.0)),
        )
        groups.setdefault(key, []).append(strip)

    doomed: set[int] = set()
    for group in groups.values():
        if len(group) < min_run:
            continue
        group.sort(key=lambda s: s.t0)
        chain: list[WallStrip] = []
        for strip in group:
            if (
                chain
                and strip.t0 - chain[-1].t1 <= max_gap_pt
                and strip.length_pt <= max_piece_pt
                and chain[-1].length_pt <= max_piece_pt
            ):
                chain.append(strip)
            else:
                if len(chain) >= min_run:
                    doomed.update(id(s) for s in chain)
                chain = [strip]
        if len(chain) >= min_run:
            doomed.update(id(s) for s in chain)
    return [s for s in strips if id(s) not in doomed]


def _diagonal_lines(vector_paths: list[VectorPath]) -> list[LineString]:
    out: list[LineString] = []
    for vp in vector_paths:
        # hatch fills are sometimes plotted dashed — keep them: crossing
        # diagonals mark a hatched (existing/rated) band either way
        for sub in vp.points:
            for a, b in zip(sub, sub[1:], strict=False):
                if math.dist(a, b) < 2.0:
                    continue
                angle = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180.0
                if 15.0 <= angle <= 75.0 or 105.0 <= angle <= 165.0:
                    out.append(LineString([a, b]))
    return out


def _is_hatch_filled(strip: WallStrip, tree: STRtree, lines: list[LineString]) -> bool:
    """Diagonal hatch INSIDE the body marks an existing/rated band. Fires on
    ≥3 full crossings (line hatch) or on dense short ticks (brick pattern)."""
    interior = strip.poly.buffer(-min(0.6, strip.thickness_pt * 0.15))
    if interior.is_empty:
        interior = strip.poly
    full_crossing = strip.thickness_pt * 0.7
    crossings = 0
    total = 0.0
    for idx in tree.query(interior):
        length = interior.intersection(lines[int(idx)]).length
        if length <= 0.5:
            continue
        total += length
        if length >= full_crossing:
            crossings += 1
            if crossings >= 3:
                return True
    return total >= 0.5 * strip.length_pt and total >= 24.0


def _filter_strips(
    strips: list[WallStrip],
    *,
    excluded: list[Polygon],
    text_boxes: list[Polygon],
    door_boxes: list[BBox],
    lanes_by_key: dict[int, list[_Lane]] | None,
    stroke_floor_pt: float = 0.0,
) -> list[WallStrip]:
    exc_tree = STRtree(excluded) if excluded else None
    text_tree = STRtree(text_boxes) if text_boxes else None
    door_polys = [
        shp_box(
            b[0] - _DOOR_VETO_PAD_PT,
            b[1] - _DOOR_VETO_PAD_PT,
            b[2] + _DOOR_VETO_PAD_PT,
            b[3] + _DOOR_VETO_PAD_PT,
        )
        for b in door_boxes
    ]
    door_tree = STRtree(door_polys) if door_polys else None

    out: list[WallStrip] = []
    for strip in strips:
        poly = strip.poly
        if exc_tree is not None:
            hit = False
            probe = poly.representative_point()
            for idx in exc_tree.query(poly):
                other = excluded[int(idx)]
                if other.covers(probe) or other.intersection(poly).area >= 0.3 * poly.area:
                    hit = True
                    break
            if hit:
                continue
        if door_tree is not None:
            hit = False
            center = poly.centroid
            for idx in door_tree.query(poly):
                other = door_polys[int(idx)]
                unpadded = shp_box(
                    other.bounds[0] + _DOOR_VETO_PAD_PT,
                    other.bounds[1] + _DOOR_VETO_PAD_PT,
                    other.bounds[2] - _DOOR_VETO_PAD_PT,
                    other.bounds[3] - _DOOR_VETO_PAD_PT,
                )
                # a door LEAF lies inside its opening; a wall piece running
                # beside the swing arc merely grazes the box and must survive
                if unpadded.covers(center) or unpadded.intersection(poly).area >= 0.45 * poly.area:
                    hit = True
                    break
            if hit:
                continue
        if text_tree is not None:
            covered = 0.0
            for idx in text_tree.query(poly):
                covered += text_boxes[int(idx)].intersection(poly).area
            if covered >= 0.5 * poly.area:
                continue
        if (
            lanes_by_key is not None
            and strip.source == "pair"
            and _strip_interior_conflicts(strip, lanes_by_key, stroke_floor_pt)
        ):
            continue
        out.append(strip)
    return out


def _dedupe_strips(strips: list[WallStrip]) -> list[WallStrip]:
    kept: list[WallStrip] = []
    for strip in sorted(strips, key=lambda s: s.poly.area, reverse=True):
        if any(strip.poly.intersection(other.poly).area >= 0.55 * strip.poly.area for other in kept):
            continue
        kept.append(strip)
    return kept
