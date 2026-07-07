import pytest

from app.geometry.linework import face_for_detection, polygon_to_rings, polygonize_faces
from app.schemas.core import VectorPath


def vp(ring):
    return VectorPath(sheet_id="s1", points=[ring])


RECT = [(0, 0), (100, 0), (100, 100), (0, 100), (0, 0)]


class TestPolygonize:
    def test_recovers_rectangle_face_exactly(self):
        faces = polygonize_faces([vp(RECT)], min_area_pt2=100)
        assert len(faces) == 1
        assert faces[0].area == pytest.approx(10_000.0)

    def test_noise_below_threshold_dropped(self):
        tiny = [(0, 0), (5, 0), (5, 5), (0, 5), (0, 0)]  # 25 pt²
        assert polygonize_faces([vp(tiny)], min_area_pt2=200) == []

    def test_open_linework_yields_no_face(self):
        open_chain = [(0, 0), (100, 0), (100, 100)]  # not closed
        assert polygonize_faces([vp(open_chain)]) == []


class TestFaceForDetection:
    def test_room_returns_single_interior_face(self):
        faces = polygonize_faces([vp(RECT)])
        f = face_for_detection(faces, (0, 0, 100, 100), "room")
        assert f is not None
        assert f.area == pytest.approx(10_000.0)

    def test_slab_fills_interior_partitions(self):
        # A room drawn inside a slab: the SLAB is the whole footprint (concrete
        # is poured under the room too), the ROOM is just its interior.
        outer = [(0, 0), (200, 0), (200, 200), (0, 200), (0, 0)]
        inner = [(50, 50), (150, 50), (150, 150), (50, 150), (50, 50)]
        faces = polygonize_faces([vp(outer), vp(inner)])
        slab = face_for_detection(faces, (0, 0, 200, 200), "slab")
        assert slab.area == pytest.approx(40_000.0)          # filled footprint
        assert len(list(slab.interiors)) == 0
        room = face_for_detection(faces, (50, 50, 150, 150), "room")
        assert room.area == pytest.approx(10_000.0)          # interior only

    def test_no_faces_returns_none(self):
        assert face_for_detection([], (0, 0, 10, 10), "room") is None

    def test_polygon_to_rings(self):
        faces = polygonize_faces([vp(RECT)])
        exterior, holes = polygon_to_rings(faces[0])
        assert len(exterior) >= 4 and holes == []


class TestDedupPrefersVector:
    def test_vector_boundary_kept_over_overlapping_mask(self):
        from app.geometry.engine import GeometryEngine
        from app.pipeline.orchestrator import _dedupe_geometries

        eng = GeometryEngine()
        # Same region, captured twice: an exact vector face and an approximate
        # (even slightly larger) mask. Dedup must keep the vector one.
        vector = eng.build_polygon("s1", RECT, boundary_source="vector")
        mask = eng.build_polygon(
            "s1", [(-1, -1), (101, -1), (101, 101), (-1, 101)], boundary_source="mask"
        )
        kept = _dedupe_geometries([mask, vector], eng)
        assert len(kept) == 1
        assert kept[0].boundary_source == "vector"
