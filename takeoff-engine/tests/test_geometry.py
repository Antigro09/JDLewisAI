import pytest

from app.geometry.engine import GeometryEngine

engine = GeometryEngine()

SQUARE = [(0, 0), (100, 0), (100, 100), (0, 100)]


class TestBuildPolygon:
    def test_square_area(self):
        g = engine.build_polygon("s1", SQUARE)
        assert g.is_closed and g.is_valid
        assert g.area_pt2 == pytest.approx(10_000.0)
        assert g.length_pt == pytest.approx(400.0)

    def test_polygon_with_hole(self):
        hole = [(25, 25), (75, 25), (75, 75), (25, 75)]
        g = engine.build_polygon("s1", SQUARE, holes=[hole])
        assert g.area_pt2 == pytest.approx(10_000.0 - 2_500.0)

    def test_nearly_closed_vector_chain_snaps(self):
        ring = [(0, 0), (100, 0), (100, 100), (0, 100), (0.5, 1.0)]  # 1.1pt gap
        g = engine.build_polygon("s1", ring, assume_closed=False)
        assert g.is_closed
        assert g.area_pt2 == pytest.approx(10_000.0, rel=0.02)

    def test_open_vector_chain_refused(self):
        open_ring = [(0, 0), (100, 0), (100, 100), (0, 60)]  # 40pt gap back to start
        g = engine.build_polygon("s1", open_ring, assume_closed=False)
        assert not g.is_closed
        assert g.area_pt2 == 0.0  # never guesses an area for open geometry

    def test_degenerate(self):
        g = engine.build_polygon("s1", [(0, 0), (1, 1)])
        assert not g.is_valid

    def test_self_intersecting_repaired(self):
        bowtie = [(0, 0), (100, 100), (100, 0), (0, 100)]
        g = engine.build_polygon("s1", bowtie)
        assert g.is_valid
        assert g.area_pt2 > 0
        assert "make_valid" in g.refinement

    def test_make_valid_geometry_collection_recovered(self):
        # A square with a zero-width dangling spike: make_valid returns a
        # GeometryCollection (polygon + stray line). The polygonal area must be
        # recovered, not discarded to zero.
        spiked = [(0, 0), (100, 0), (100, 100), (0, 100), (0, 50), (-50, 50), (0, 50)]
        g = engine.build_polygon("s1", spiked)
        assert g.is_valid
        assert g.area_pt2 == pytest.approx(10_000.0)
        assert "make_valid" in g.refinement

    def test_snapped_vector_ring_has_no_sliver(self):
        # Near-closed vector chain: the seam must collapse, not add a sliver
        # vertex that dents the area.
        ring = [(0, 0), (100, 0), (100, 100), (0, 100), (0.5, 1.5)]  # ~1.6pt gap
        g = engine.build_polygon("s1", ring, assume_closed=False)
        assert g.is_closed
        assert g.area_pt2 == pytest.approx(10_000.0, rel=0.01)

    def test_hole_inside_subtracted(self):
        hole = [(25, 25), (75, 25), (75, 75), (25, 75)]
        g = engine.build_polygon("s1", SQUARE, holes=[hole])
        assert g.area_pt2 == pytest.approx(10_000.0 - 2_500.0)

    def test_hole_outside_exterior_dropped(self):
        # A mis-traced void outside the ring must NOT subtract (or add) area.
        outside = [(200, 200), (210, 200), (210, 210), (200, 210)]
        g = engine.build_polygon("s1", SQUARE, holes=[outside])
        assert g.area_pt2 == pytest.approx(10_000.0)
        assert "dropped out-of-bounds hole" in g.refinement


class TestSpatialRelations:
    def test_label_inside_polygon(self):
        g = engine.build_polygon("s1", SQUARE)
        assert engine.label_distance_pt((40, 40, 60, 60), g) == 0.0

    def test_label_outside_polygon(self):
        g = engine.build_polygon("s1", SQUARE)
        d = engine.label_distance_pt((190, 40, 210, 60), g)  # center (200,50), 100pt away
        assert d == pytest.approx(100.0)

    def test_union_area_dedupes_overlap(self):
        a = engine.build_polygon("s1", SQUARE)
        b = engine.build_polygon("s1", [(50, 0), (150, 0), (150, 100), (50, 100)])
        assert engine.union_area_pt2([a, b]) == pytest.approx(15_000.0)

    def test_polyline_length(self):
        g = engine.build_polyline("s1", [(0, 0), (30, 40)])
        assert g.length_pt == pytest.approx(50.0)
        assert g.area_pt2 == 0.0
