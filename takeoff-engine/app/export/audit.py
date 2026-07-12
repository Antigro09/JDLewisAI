"""Human-readable audit summaries for flat exports."""

from __future__ import annotations

import json
from typing import Any


def _num(attrs: dict[str, Any], key: str) -> float | None:
    value = attrs.get(key)
    return float(value) if isinstance(value, (int, float)) else None


def _fmt_num(value: float) -> str:
    return f"{value:g}"


def _plural(value: float, singular: str, plural: str | None = None) -> str:
    word = singular if value == 1 else (plural or f"{singular}s")
    return f"{_fmt_num(value)} {word}"


def _mark_counts(attrs: dict[str, Any]) -> list[tuple[str, float]]:
    raw = attrs.get("mark_counts")
    if not isinstance(raw, dict):
        return []
    out = []
    for mark, count in raw.items():
        if isinstance(mark, str) and isinstance(count, (int, float)) and count > 0:
            out.append((mark, float(count)))
    return sorted(out)


def audit_summary(quantity: dict[str, Any]) -> str:
    attrs = quantity.get("attributes") or {}
    if not isinstance(attrs, dict):
        return ""
    item_type = str(quantity.get("item_type") or "")
    notes: list[str] = []

    if item_type in {"door", "window"}:
        if attrs.get("count_basis") == "scheduled_plan_marks":
            openings = _num(attrs, "opening_count") or _num(attrs, "symbol_count")
            schedule_rows = _num(attrs, "schedule_row_count")
            if openings is not None:
                notes.append(_plural(openings, "scheduled opening"))
            if schedule_rows is not None:
                notes.append(_plural(schedule_rows, "door schedule row"))
            excluded = attrs.get("existing_schedule_marks_excluded")
            if isinstance(excluded, list) and excluded:
                notes.append(f"existing/ETR excluded: {', '.join(str(mark) for mark in excluded)}")
        else:
            symbols = _num(attrs, "symbol_count")
            unique_marks = _num(attrs, "unique_mark_count")
            unmatched = _num(attrs, "unmatched_symbol_count")
            if symbols is not None:
                notes.append(_plural(symbols, "accepted symbol"))
            if unique_marks is not None:
                notes.append(_plural(unique_marks, "unique scheduled mark"))
            duplicate_marks = [f"{mark} x{_fmt_num(count)}" for mark, count in _mark_counts(attrs) if count > 1]
            if duplicate_marks:
                notes.append(f"duplicate marks: {', '.join(duplicate_marks)}")
            if unmatched:
                notes.append(_plural(unmatched, "unmatched symbol"))

    elif item_type == "wall":
        segments = _num(attrs, "segment_count")
        lengths = attrs.get("segment_lengths_lf")
        if segments is not None:
            notes.append(_plural(segments, "wall segment"))
        if isinstance(lengths, list) and lengths:
            shown = ", ".join(_fmt_num(float(v)) for v in lengths if isinstance(v, (int, float)))
            if shown:
                notes.append(f"segment LF: {shown}")
        wall_code = attrs.get("wall_code")
        if isinstance(wall_code, str) and wall_code:
            notes.append(f"wall code: {wall_code}")
        unit_size = _num(attrs, "unit_size_in")
        if unit_size is not None:
            notes.append(f"unit size: {_fmt_num(unit_size)} in")

    elif item_type == "flooring":
        base = _num(attrs, "base_sqft")
        labels = _num(attrs, "label_area_count")
        waste = _num(attrs, "waste_factor")
        if base is not None:
            if labels is not None:
                notes.append(f"{_fmt_num(base)} base SF from {_plural(labels, 'room label')}")
            else:
                notes.append(f"{_fmt_num(base)} base SF before waste")
        if waste is not None:
            notes.append(f"waste factor {_fmt_num(waste)}")

    elif item_type == "column":
        shape = attrs.get("shape")
        if isinstance(shape, str) and shape:
            notes.append(f"{shape} column")

    return "; ".join(notes)


def attributes_json(quantity: dict[str, Any]) -> str:
    attrs = quantity.get("attributes") or {}
    return json.dumps(attrs, sort_keys=True, default=str) if attrs else ""
