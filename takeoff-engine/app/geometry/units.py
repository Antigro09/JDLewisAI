"""Deterministic unit parsing and conversion. No LLM ever touches this math."""

from __future__ import annotations

import math
import re

FT_PER_M = 3.28084
SF_PER_SY = 9.0
CF_PER_CY = 27.0

_NUM = r"\d+(?:\.\d+)?"
_FRAC = r"\d+\s*/\s*\d+"
# "6", "6 1/2", "1/2" — a number, a number with fraction, or a bare fraction
_MIXED = rf"(?:{_NUM}(?:\s+{_FRAC})?|{_FRAC})"

_METRIC_RE = re.compile(rf"^({_NUM})\s*(mm|cm|m)\b\.?$", re.IGNORECASE)
_FEET_RE = re.compile(rf"^({_MIXED})\s*(?:'|ft\b\.?|feet\b)", re.IGNORECASE)
_INCH_RE = re.compile(rf"^({_MIXED})\s*(?:\"|in\b\.?|inch(?:es)?\b)?\s*$", re.IGNORECASE)


def _normalize(s: str) -> str:
    return (
        s.replace("’", "'")
        .replace("′", "'")
        .replace("“", '"')
        .replace("”", '"')
        .replace("″", '"')
        .replace("⁄", "/")
        .strip()
    )


def _mixed_to_float(s: str) -> float | None:
    """'6', '6 1/2', '1/2' → float."""
    s = s.strip()
    m = re.match(rf"^({_NUM})?\s*(?:(\d+)\s*/\s*(\d+))?$", s)
    if not m or (m.group(1) is None and m.group(2) is None):
        return None
    value = float(m.group(1)) if m.group(1) else 0.0
    if m.group(2):
        den = float(m.group(3))
        if den == 0:
            return None
        value += float(m.group(2)) / den
    return value


def parse_feet_inches(raw: str | float | int | None, default_unit: str = "ft") -> float | None:
    """Parse an architectural dimension string to decimal feet.

    Handles: 24'-6"  ·  24' 6 1/2"  ·  24'  ·  8"  ·  12.5'  ·  3/4"  ·  10 FT  ·  3.5 m
    Bare numbers/fractions use `default_unit` ("ft" or "in").
    Returns None on garbage — never NaN.
    """
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        v = float(raw)
        if not math.isfinite(v):
            return None
        return v / 12.0 if default_unit == "in" else v

    s = _normalize(str(raw))
    if not s:
        return None

    m = _METRIC_RE.match(s)
    if m:
        v = float(m.group(1))
        unit = m.group(2).lower()
        if unit == "mm":
            v /= 1000.0
        elif unit == "cm":
            v /= 100.0
        return v * FT_PER_M

    feet = 0.0
    has_feet = False
    m = _FEET_RE.match(s)
    if m:
        v = _mixed_to_float(m.group(1))
        if v is None:
            return None
        feet, has_feet = v, True
        s = s[m.end() :].lstrip(" -")  # remainder is the inches part, e.g. 6 1/2"

    if not s:
        return feet if has_feet else None

    m = _INCH_RE.match(s)
    if not m:
        return None
    inches = _mixed_to_float(m.group(1))
    if inches is None:
        return None
    explicit_inch_mark = bool(re.search(r"\"|in\b|inch", s, re.IGNORECASE))
    if has_feet or explicit_inch_mark:
        return feet + inches / 12.0
    # Bare number/fraction with no unit marks at all → default unit.
    return inches / 12.0 if default_unit == "in" else inches


def sqft_from_pt2(area_pt2: float, ft_per_pt: float) -> float:
    return area_pt2 * ft_per_pt * ft_per_pt


def lf_from_pt(length_pt: float, ft_per_pt: float) -> float:
    return length_pt * ft_per_pt


def cubic_yards(sqft: float, thickness_ft: float) -> float:
    """Concrete volume: CY = SF × thickness_ft / 27."""
    if sqft < 0 or thickness_ft < 0:
        raise ValueError("negative dimensions")
    return sqft * thickness_ft / CF_PER_CY


def square_yards(sqft: float) -> float:
    return sqft / SF_PER_SY


def apply_waste(quantity: float, waste_factor: float) -> float:
    if waste_factor < 1.0:
        raise ValueError("waste_factor must be >= 1.0")
    return quantity * waste_factor
