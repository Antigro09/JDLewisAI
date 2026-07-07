import pytest

from app.config import Settings
from app.geometry.engine import GeometryEngine
from app.pipeline.measure import derive_concrete_volume, measure_area_item
from app.pipeline.rollup import find_slab_thickness_ft
from app.schemas.confidence import ReviewReason
from app.schemas.core import Sheet
from app.schemas.ocr import OCRSpan
from app.schemas.scale import ScaleCalibration, ScaleSource

engine = GeometryEngine()
settings = Settings(database_url="sqlite:///:memory:")


def make_scale(ft_per_pt=8 / 72) -> ScaleCalibration:
    return ScaleCalibration(sheet_id="s1", source=ScaleSource.SCALE_NOTE,
                            ft_per_pt=ft_per_pt, confidence=0.85)


def make_sheet() -> Sheet:
    return Sheet(id="s1", project_id="p1", source_file="f.pdf", page_number=1)


def slab_item(w_ft=40.0, h_ft=30.0):
    pt_per_ft = 9.0  # at 1/8" = 1'-0"
    geom = engine.build_polygon(
        "s1", [(0, 0), (w_ft * pt_per_ft, 0), (w_ft * pt_per_ft, h_ft * pt_per_ft), (0, h_ft * pt_per_ft)]
    )
    return measure_area_item(
        project_id="p1", sheet=make_sheet(), geometry=geom, scale=make_scale(),
        detection=None, item_type="concrete_slab", settings=settings,
    )


class TestSlabTakeoff:
    def test_sqft_measurement(self):
        item = slab_item()
        assert item.quantity == pytest.approx(1200.0, rel=1e-3)
        assert item.unit == "SF"
        assert "pt²" in item.formula and "ft/pt" in item.formula

    def test_cubic_yards_at_4in(self):
        item = derive_concrete_volume(slab_item(), thickness_ft=4 / 12, thickness_source="callout")
        # 1200 SF * (1/3) ft / 27 = 14.81 CY
        assert item.unit == "CY"
        assert item.quantity == pytest.approx(14.81, abs=0.01)
        assert "/ 27" in item.formula
        assert item.attributes["thickness_ft"] == pytest.approx(1 / 3)
        assert not item.needs_review

    def test_defaulted_thickness_flags_review(self):
        item = derive_concrete_volume(slab_item(), thickness_ft=4 / 12, thickness_source="default")
        assert item.needs_review
        assert "DEFAULTED" in item.formula

    def test_volume_requires_slab_sf(self):
        item = slab_item()
        item.item_type = "flooring"
        with pytest.raises(ValueError):
            derive_concrete_volume(item, 0.333)


class TestThicknessFromNotes:
    def test_finds_callout(self):
        spans = [
            OCRSpan(sheet_id="s1", text="FOUNDATION PLAN", bbox=(0, 0, 1, 1)),
            OCRSpan(sheet_id="s1", text='4" CONC. SLAB', bbox=(0, 0, 1, 1)),
        ]
        thickness, evidence = find_slab_thickness_ft(spans)
        assert thickness == pytest.approx(4 / 12)
        assert evidence == [spans[1].id]

    def test_slab_prefix_form(self):
        spans = [OCRSpan(sheet_id="s1", text='SLAB ON GRADE: 6" W/ WWM', bbox=(0, 0, 1, 1))]
        thickness, _ = find_slab_thickness_ft(spans)
        assert thickness == pytest.approx(6 / 12)

    def test_thk_keyword_forms(self):
        for text, ft in [('6" THK SLAB', 0.5), ('SLAB THK: 8"', 8 / 12)]:
            thickness, _ = find_slab_thickness_ft([OCRSpan(sheet_id="s1", text=text, bbox=(0, 0, 1, 1))])
            assert thickness == pytest.approx(ft), text

    def test_rejects_rebar_spacing(self):
        # The #4 bars at 16" O.C. must NOT be misread as a 16" slab (would ~4x the CY).
        for text in ['SLAB W/ #4 @ 16" O.C.', 'SLAB REINF #5 @ 12" OC', 'SLAB: #4 @ 18" o.c.']:
            thickness, _ = find_slab_thickness_ft([OCRSpan(sheet_id="s1", text=text, bbox=(0, 0, 1, 1))])
            assert thickness is None, text

    def test_no_callout(self):
        spans = [OCRSpan(sheet_id="s1", text="FLOOR PLAN", bbox=(0, 0, 1, 1))]
        assert find_slab_thickness_ft(spans) == (None, [])


class TestNTSRefusal:
    def test_area_item_refused_on_nts(self):
        nts = ScaleCalibration(sheet_id="s1", source=ScaleSource.NTS, ft_per_pt=None)
        geom = engine.build_polygon("s1", [(0, 0), (90, 0), (90, 90), (0, 90)])
        item = measure_area_item(
            project_id="p1", sheet=make_sheet(), geometry=geom, scale=nts,
            detection=None, item_type="flooring", settings=settings,
        )
        assert item.quantity == 0.0
        assert item.needs_review
        assert ReviewReason.NTS_SHEET in item.review_reason
        assert "unmeasured" in item.formula
