import pytest

from app.pipeline.scale_calibration import (
    manual_calibration,
    parse_scale_note,
    resolve_scale,
)
from app.schemas.core import Sheet
from app.schemas.ocr import OCRSpan
from app.schemas.scale import ScaleSource

PT_PER_IN = 72.0


def span(text: str, conf: float = 1.0) -> OCRSpan:
    return OCRSpan(sheet_id="s1", text=text, bbox=(0, 0, 100, 10), confidence=conf)


def sheet() -> Sheet:
    return Sheet(id="s1", project_id="p1", source_file="f.pdf", page_number=1,
                 width_pt=792, height_pt=612)


class TestParseScaleNote:
    @pytest.mark.parametrize(
        ("text", "ft_per_in"),
        [
            ('1/8" = 1\'-0"', 8.0),
            ('1/4"=1\'-0"', 4.0),
            ('3/32" = 1\'-0"', 32 / 3),
            ('1/2" = 1\'', 2.0),
            ('1" = 20\'', 20.0),
            ('1" = 100\'-0"', 100.0),
            ('1 1/2" = 1\'-0"', 2 / 3),
            ('SCALE: 1/8" = 1\'-0"', 8.0),
            ('Scale = 1/4" = 1\'-0"', 4.0),
        ],
    )
    def test_architectural_scales(self, text, ft_per_in):
        ft_per_pt, canonical = parse_scale_note(text)
        assert ft_per_pt == pytest.approx(ft_per_in / PT_PER_IN)
        assert canonical

    def test_hyphenated_mixed_number(self):
        # '1-1/2" = 1'-0"' must parse as 1.5", not grab the '1/2' (which mis-scaled 3x).
        ft_per_pt, _ = parse_scale_note("1-1/2\" = 1'-0\"")
        assert ft_per_pt == pytest.approx((2 / 3) / PT_PER_IN)  # 1'-0" over 1.5"

    def test_detail_scale_not_rejected(self):
        # A near-full-scale detail (12" = 1'-0") must pass the sanity floor.
        ft_per_pt, canonical = parse_scale_note("12\" = 1'-0\"")
        assert ft_per_pt == pytest.approx((1 / 12) / PT_PER_IN)
        assert canonical

    @pytest.mark.parametrize(("text", "ratio"), [("1:100", 100), ("1:50", 50), ("1 : 20", 20)])
    def test_metric_ratios(self, text, ratio):
        ft_per_pt, canonical = parse_scale_note(text)
        # 1 pt of paper = 1/864 ft real at 1:1
        assert ft_per_pt == pytest.approx(ratio / 864.0)
        assert canonical == f"1:{ratio}"

    @pytest.mark.parametrize("text", ["N.T.S.", "NTS", "NOT TO SCALE", "Scale: nts"])
    def test_nts(self, text):
        ft_per_pt, canonical = parse_scale_note(text)
        assert ft_per_pt is None
        assert canonical == "NTS"

    @pytest.mark.parametrize("text", ["FLOOR PLAN", "OFFICE 101", "24'-6\"", "", "1/8"])
    def test_non_scale_text(self, text):
        ft_per_pt, canonical = parse_scale_note(text)
        assert ft_per_pt is None
        assert canonical == ""

    def test_curly_quotes(self):
        ft_per_pt, _ = parse_scale_note("1/8” = 1’-0”")
        assert ft_per_pt == pytest.approx(8.0 / PT_PER_IN)


class TestResolveScale:
    def test_scale_note_wins_without_metadata(self):
        cal = resolve_scale(sheet(), [span("FLOOR PLAN"), span('SCALE: 1/8" = 1\'-0"')])
        assert cal.source == ScaleSource.SCALE_NOTE
        assert cal.usable
        assert cal.ft_per_pt == pytest.approx(8.0 / 72.0)
        assert cal.source_ocr_span_ids  # evidence attached

    def test_pdf_metadata_outranks_note(self):
        cal = resolve_scale(sheet(), [span('1/8" = 1\'-0"')], pdf_metadata_ft_per_pt=0.1)
        assert cal.source == ScaleSource.PDF_METADATA
        assert cal.ft_per_pt == 0.1

    def test_nts_refusal(self):
        cal = resolve_scale(sheet(), [span("N.T.S."), span("DETAIL 3")])
        assert cal.source == ScaleSource.NTS
        assert not cal.usable
        assert cal.confidence == 0.0

    def test_nothing_found(self):
        cal = resolve_scale(sheet(), [span("FLOOR PLAN")])
        assert cal.source == ScaleSource.NONE
        assert not cal.usable

    def test_conflicting_scale_notes_flagged(self):
        cal = resolve_scale(sheet(), [span('1/8" = 1\'-0"'), span('1/4" = 1\'-0"')])
        assert cal.source == ScaleSource.SCALE_NOTE
        assert cal.dimension_conflict  # two distinct scales on one sheet → review

    def test_corroborating_scale_notes_boost_confidence(self):
        one = resolve_scale(sheet(), [span('1/8" = 1\'-0"')]).confidence
        two = resolve_scale(sheet(), [span('1/8" = 1\'-0"'), span('1/8" = 1\'-0"')]).confidence
        assert two > one and not resolve_scale(
            sheet(), [span('1/8" = 1\'-0"'), span('1/8" = 1\'-0"')]
        ).dimension_conflict

    def test_ocr_confidence_propagates(self):
        high = resolve_scale(sheet(), [span('1/8" = 1\'-0"', conf=1.0)])
        low = resolve_scale(sheet(), [span('1/8" = 1\'-0"', conf=0.5)])
        assert low.confidence < high.confidence


class TestManualCalibration:
    def test_two_click(self):
        # 90 pt apart, user says it's 10 ft → 1/9 ft per pt
        cal = manual_calibration("s1", (0, 0), (90, 0), 10.0)
        assert cal.source == ScaleSource.MANUAL
        assert cal.ft_per_pt == pytest.approx(10.0 / 90.0)
        assert cal.confidence > 0.9

    def test_rejects_degenerate(self):
        with pytest.raises(ValueError):
            manual_calibration("s1", (5, 5), (5, 5), 10.0)
        with pytest.raises(ValueError):
            manual_calibration("s1", (0, 0), (90, 0), 0.0)
