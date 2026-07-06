import pytest

from app.geometry.units import (
    apply_waste,
    cubic_yards,
    lf_from_pt,
    parse_feet_inches,
    sqft_from_pt2,
    square_yards,
)


class TestParseFeetInches:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("24'-6\"", 24.5),
            ("24' 6\"", 24.5),
            ("24' 6 1/2\"", 24.0 + 6.5 / 12),
            ("24'", 24.0),
            ("8\"", 8 / 12),
            ("12.5'", 12.5),
            ("3/4\"", 0.75 / 12),
            ("10 ft", 10.0),
            ("1'-0\"", 1.0),
            ("0'-6\"", 0.5),
        ],
    )
    def test_imperial(self, raw, expected):
        assert parse_feet_inches(raw) == pytest.approx(expected)

    def test_metric(self):
        assert parse_feet_inches("3.5 m") == pytest.approx(11.48294)
        assert parse_feet_inches("3500 mm") == pytest.approx(11.48294)
        assert parse_feet_inches("350 cm") == pytest.approx(11.48294)

    def test_default_unit(self):
        assert parse_feet_inches("6", default_unit="in") == pytest.approx(0.5)
        assert parse_feet_inches("6", default_unit="ft") == 6.0
        assert parse_feet_inches(6, default_unit="in") == pytest.approx(0.5)

    def test_unicode(self):
        assert parse_feet_inches("24’-6”") == pytest.approx(24.5)

    @pytest.mark.parametrize("raw", [None, "", "hello", "1/0\"", float("nan"), float("inf")])
    def test_garbage_returns_none(self, raw):
        assert parse_feet_inches(raw) is None


class TestConversions:
    def test_sqft_from_pt2(self):
        # at 1/8"=1'-0" (8/72 ft per pt), 1 sq inch of paper = 64 sqft
        ft_per_pt = 8 / 72
        assert sqft_from_pt2(72 * 72, ft_per_pt) == pytest.approx(64.0)

    def test_lf(self):
        assert lf_from_pt(90, 1 / 9) == pytest.approx(10.0)

    def test_cubic_yards(self):
        # 1250 SF at 4" slab: 1250 * (1/3) / 27
        assert cubic_yards(1250, 4 / 12) == pytest.approx(15.432, abs=1e-3)
        assert cubic_yards(0, 1) == 0.0
        with pytest.raises(ValueError):
            cubic_yards(-1, 0.333)

    def test_square_yards(self):
        assert square_yards(90) == 10.0

    def test_waste(self):
        assert apply_waste(100, 1.1) == pytest.approx(110.0)
        with pytest.raises(ValueError):
            apply_waste(100, 0.9)
