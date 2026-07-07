
from app.config import Settings
from app.geometry.engine import GeometryEngine
from app.pipeline.confidence import finalize_item
from app.schemas.confidence import ConfidenceBundle, ReviewReason
from app.schemas.detection import DetectedObject, SegmentationMask
from app.schemas.quantity import QuantityItem
from app.schemas.scale import ScaleCalibration, ScaleSource

engine = GeometryEngine()
settings = Settings(database_url="sqlite:///:memory:")

GOOD_SCALE = ScaleCalibration(sheet_id="s1", source=ScaleSource.SCALE_NOTE,
                              ft_per_pt=8 / 72, confidence=0.85)


def make_item(**kw) -> QuantityItem:
    defaults = dict(
        project_id="p1", sheet_id="s1", page_number=1, item_type="flooring",
        description="Room", quantity=300.0, unit="SF", formula="SF = ...",
        confidence=ConfidenceBundle(ocr=0.9, scale=0.85, geometry=1.0, detector=0.9),
    )
    defaults.update(kw)
    return QuantityItem(**defaults)


def closed_geom():
    return engine.build_polygon("s1", [(0, 0), (100, 0), (100, 100), (0, 100)])


def open_geom():
    return engine.build_polygon("s1", [(0, 0), (100, 0), (100, 100), (0, 60)],
                                assume_closed=False)


class TestFlagRules:
    def test_clean_item_not_flagged(self):
        g = closed_geom()
        item = finalize_item(make_item(source_geometry_ids=[g.id]), settings=settings,
                             scale=GOOD_SCALE, geometries={g.id: g})
        assert not item.needs_review
        assert item.final_confidence > 0.5

    def test_nts_sheet(self):
        nts = ScaleCalibration(sheet_id="s1", source=ScaleSource.NTS, ft_per_pt=None)
        item = finalize_item(make_item(), settings=settings, scale=nts, geometries={})
        assert ReviewReason.NTS_SHEET in item.review_reason

    def test_no_reliable_scale(self):
        weak = ScaleCalibration(sheet_id="s1", source=ScaleSource.SCALE_NOTE,
                                ft_per_pt=8 / 72, confidence=0.2)
        item = finalize_item(make_item(), settings=settings, scale=weak, geometries={})
        assert ReviewReason.NO_RELIABLE_SCALE in item.review_reason

    def test_count_items_ignore_scale(self):
        nts = ScaleCalibration(sheet_id="s1", source=ScaleSource.NTS, ft_per_pt=None)
        item = finalize_item(
            make_item(unit="EA", item_type="door", quantity=5,
                      confidence=ConfidenceBundle(detector=0.9)),
            settings=settings, scale=nts, geometries={},
        )
        assert ReviewReason.NTS_SHEET not in item.review_reason

    def test_open_polygon(self):
        g = open_geom()
        item = finalize_item(make_item(source_geometry_ids=[g.id]), settings=settings,
                             scale=GOOD_SCALE, geometries={g.id: g})
        assert ReviewReason.OPEN_POLYGON in item.review_reason

    def test_scale_dimension_conflict(self):
        conflicted = ScaleCalibration(
            sheet_id="s1", source=ScaleSource.SCALE_NOTE, ft_per_pt=8 / 72,
            confidence=0.4, dimension_conflict=True,
        )
        item = finalize_item(make_item(), settings=settings, scale=conflicted, geometries={})
        assert ReviewReason.SCALE_DIMENSION_CONFLICT in item.review_reason

    def test_schedule_plan_mismatch(self):
        item = finalize_item(make_item(), settings=settings, scale=GOOD_SCALE,
                             geometries={}, schedule_plan_mismatch=True)
        assert ReviewReason.SCHEDULE_PLAN_MISMATCH in item.review_reason

    def test_version_delta(self):
        item = finalize_item(make_item(quantity=300.0), settings=settings, scale=GOOD_SCALE,
                             geometries={}, previous_quantity=200.0)
        assert ReviewReason.VERSION_DELTA in item.review_reason
        assert item.attributes["delta_pct"] == 50.0

    def test_small_version_delta_ok(self):
        item = finalize_item(make_item(quantity=205.0), settings=settings, scale=GOOD_SCALE,
                             geometries={}, previous_quantity=200.0)
        assert ReviewReason.VERSION_DELTA not in item.review_reason

    def test_mask_overreach(self):
        g = closed_geom()
        mask = SegmentationMask(sheet_id="s1", polygons=[g.exterior],
                                line_overreach_ratio=0.6)
        g.derived_from = [mask.id]
        item = finalize_item(make_item(source_geometry_ids=[g.id]), settings=settings,
                             scale=GOOD_SCALE, geometries={g.id: g}, masks={mask.id: mask})
        assert ReviewReason.MASK_OVERREACH in item.review_reason

    def test_label_far_from_polygon(self):
        g = closed_geom()  # 100pt square; at 8/72 ft/pt, 100pt ≈ 11ft away
        label = DetectedObject(sheet_id="s1", label="room_label",
                               bbox=(190, 40, 210, 60), confidence=0.9, detector="t")
        item = finalize_item(make_item(source_geometry_ids=[g.id]), settings=settings,
                             scale=GOOD_SCALE, geometries={g.id: g}, label_detection=label)
        assert ReviewReason.LABEL_FAR_FROM_POLYGON in item.review_reason

    def test_assumed_dpi_flags_and_downweights(self):
        item = finalize_item(make_item(), settings=settings, scale=GOOD_SCALE,
                             geometries={}, dpi_assumed=True)
        assert ReviewReason.ASSUMED_DPI in item.review_reason
        assert abs(item.confidence.scale - 0.85 * 0.7) < 1e-9
        assert abs(item.confidence.geometry - 1.0 * 0.7) < 1e-9

    def test_low_confidence(self):
        item = finalize_item(
            make_item(confidence=ConfidenceBundle(ocr=0.5, scale=0.85, geometry=1.0, detector=0.6)),
            settings=settings, scale=GOOD_SCALE, geometries={},
        )
        assert ReviewReason.LOW_CONFIDENCE in item.review_reason
        assert item.needs_review


class TestConfidenceBundle:
    def test_final_is_pessimistic(self):
        strong_chain_weak_link = ConfidenceBundle(ocr=1.0, scale=1.0, geometry=1.0, detector=0.2)
        assert strong_chain_weak_link.final() < 0.3  # min dominates, average would hide it

    def test_perfect(self):
        assert ConfidenceBundle().final() == 1.0

    def test_bounds(self):
        assert 0.0 <= ConfidenceBundle(ocr=0, scale=0, geometry=0, detector=0).final() <= 1.0
