"""Sheet classification — deterministic heuristics first, VLM assist optional.

Two signals, in order:
  1. Title-block sheet number prefix (A-101 → architectural, S- → structural,
     M/E/P- → MEP...). Discipline prefixes are a near-universal convention.
  2. Keyword votes over OCR text ("FLOOR PLAN", "SCHEDULE", "FINISH", ...).

A fine-tuned lightweight classifier replaces this at production quality
(docs/fine-tuning-roadmap.md); the VLM is only consulted when heuristics
land below a confidence floor and the caller opts in.
"""

from __future__ import annotations

import re

from app.schemas.core import Sheet, SheetType
from app.schemas.ocr import OCRSpan

_PREFIX_MAP: list[tuple[str, SheetType]] = [
    (r"^A[\s.-]?\d", SheetType.ARCHITECTURAL_PLAN),
    (r"^S[\s.-]?\d", SheetType.STRUCTURAL_PLAN),
    (r"^LS[\s.-]?\d", SheetType.LIFE_SAFETY),
    (r"^D[\s.-]?\d", SheetType.DEMOLITION_PLAN),
    (r"^(?:M|E|P|MEP|FP)[\s.-]?\d", SheetType.MEP),
    (r"^(?:G|T|CS)[\s.-]?\d", SheetType.TITLE_SHEET),
    (r"^ID?[\s.-]?\d", SheetType.FINISH_PLAN),
]

_KEYWORDS: list[tuple[str, SheetType, float]] = [
    ("FINISH PLAN", SheetType.FINISH_PLAN, 0.9),
    ("FINISH SCHEDULE", SheetType.SCHEDULE, 0.8),
    ("DOOR SCHEDULE", SheetType.SCHEDULE, 0.9),
    ("WINDOW SCHEDULE", SheetType.SCHEDULE, 0.9),
    ("SCHEDULE", SheetType.SCHEDULE, 0.4),
    ("FOUNDATION PLAN", SheetType.STRUCTURAL_PLAN, 0.9),
    ("FRAMING PLAN", SheetType.STRUCTURAL_PLAN, 0.9),
    ("SLAB PLAN", SheetType.STRUCTURAL_PLAN, 0.8),
    ("FLOOR PLAN", SheetType.ARCHITECTURAL_PLAN, 0.8),
    ("REFLECTED CEILING", SheetType.ARCHITECTURAL_PLAN, 0.7),
    ("DETAIL", SheetType.DETAIL, 0.5),
    ("SECTION", SheetType.DETAIL, 0.4),
    ("MECHANICAL", SheetType.MEP, 0.7),
    ("ELECTRICAL", SheetType.MEP, 0.7),
    ("PLUMBING", SheetType.MEP, 0.7),
    ("COVER SHEET", SheetType.TITLE_SHEET, 0.9),
    ("SHEET INDEX", SheetType.TITLE_SHEET, 0.8),
]

_TYPE_PRIORITY = {
    SheetType.SCHEDULE,
    SheetType.DETAIL,
    SheetType.TITLE_SHEET,
}

_TITLE_LABELS = {
    "SHEET TITLE",
    "SHEET NUMBER",
    "PROJECT TITLE",
    "PROJECT NUMBER",
    "DRAWN BY:",
    "CHECKED BY:",
    "DATE",
    "REVISIONS",
    "DESCRIPTION",
    "NO.",
}


def _clean_text(text: str) -> str:
    return " ".join(text.upper().replace("\uFFFD", "").split())


def _title_block_text(sheet: Sheet, spans: list[OCRSpan], sheet_number: str) -> str:
    """Extract the title value from the right-side title block when present."""
    if not sheet.width_pt or not sheet.height_pt:
        return ""
    right_x = sheet.width_pt * 0.82
    label_y = None
    number_y = None
    for span in spans:
        text = _clean_text(span.text)
        if span.bbox[0] < right_x:
            continue
        if text == "SHEET TITLE":
            label_y = span.bbox[1]
        elif text == "SHEET NUMBER":
            number_y = span.bbox[1]

    lines: list[tuple[float, float, str]] = []
    if label_y is not None and number_y is not None and number_y > label_y:
        for span in spans:
            text = _clean_text(span.text)
            if not text or text in _TITLE_LABELS or text == _clean_text(sheet_number):
                continue
            if span.bbox[0] >= right_x and label_y < span.bbox[1] < number_y:
                lines.append((span.bbox[1], span.bbox[0], text))
    else:
        for span in spans:
            text = _clean_text(span.text)
            if not text or text in _TITLE_LABELS or text == _clean_text(sheet_number):
                continue
            x_frac = span.bbox[0] / sheet.width_pt
            y_frac = span.bbox[1] / sheet.height_pt
            if x_frac > 0.86 and y_frac > 0.65:
                lines.append((span.bbox[1], span.bbox[0], text))

    lines.sort()
    return " ".join(text for _, _, text in lines)


def _classify_title(title: str) -> tuple[SheetType, float] | None:
    if not title:
        return None
    if "TITLE SHEET" in title or "COVER SHEET" in title or "SHEET INDEX" in title:
        return SheetType.TITLE_SHEET, 0.9
    # A pure demolition sheet is never a takeoff target; a combined
    # "DEMOLITION & CONSTRUCTION" sheet still is (the construction view is
    # isolated downstream).
    if "DEMOLITION" in title and "CONSTRUCTION" not in title:
        return SheetType.DEMOLITION_PLAN, 0.9
    if "LIFE SAFETY" in title:
        return SheetType.LIFE_SAFETY, 0.85
    if "FINISH SCHEDULE" in title or "DOOR" in title and "SCHEDULE" in title:
        return SheetType.SCHEDULE, 0.9
    if "WINDOW" in title and "SCHEDULE" in title:
        return SheetType.SCHEDULE, 0.9
    if "SCHEDULE" in title and "PLAN" not in title:
        return SheetType.SCHEDULE, 0.85
    if "FINISH PLAN" in title:
        return SheetType.FINISH_PLAN, 0.9
    if "REFLECTED CEILING" in title and "PLAN" in title:
        return SheetType.ARCHITECTURAL_PLAN, 0.85
    if "FLOOR PLAN" in title or "FLOOR PLANS" in title:
        return SheetType.ARCHITECTURAL_PLAN, 0.9
    if (
        "ELEVATION" in title
        or "SECTION" in title
        or "DETAIL" in title
        or "PARTITION TYPES" in title
        or "MILLWORK" in title
    ):
        return SheetType.DETAIL, 0.85
    return None


def _looks_like_schedule_sheet(text: str) -> bool:
    """True when schedule/table headers are the page subject, not just references."""
    if "DOOR SCHEDULE" in text or "WINDOW SCHEDULE" in text:
        return True
    if "ROOM FINISH SCHEDULE" in text:
        return True
    if "FINISH SCHEDULE" in text and "FINISH LEGEND" in text:
        return True
    if "FINISH SCHEDULE" in text and "PRODUCT" in text and "MANUFACTURER" in text:
        return True
    return False


def extract_sheet_number(spans: list[OCRSpan], sheet: Sheet) -> str:
    """Best-effort title-block sheet number: short discipline-prefixed tokens
    in the bottom-right ~15% of the page (standard title-block location)."""
    candidates = []
    for span in spans:
        text = span.text.strip().upper()
        if not re.match(r"^[A-Z]{1,3}[\s.-]?\d{1,4}(?:\.\d+)?$", text):
            continue
        x_frac = span.bbox[0] / sheet.width_pt if sheet.width_pt else 0
        y_frac = span.bbox[1] / sheet.height_pt if sheet.height_pt else 0
        if x_frac > 0.75 and y_frac > 0.75:
            candidates.append((y_frac + x_frac, text))
    candidates.sort(reverse=True)  # bottom-right-most wins
    return candidates[0][1] if candidates else ""


def classify_sheet(sheet: Sheet, spans: list[OCRSpan]) -> tuple[SheetType, float, str]:
    """Returns (sheet_type, confidence, sheet_number)."""
    sheet_number = extract_sheet_number(spans, sheet)
    title_type = _classify_title(_title_block_text(sheet, spans, sheet_number))
    if title_type:
        sheet_type, confidence = title_type
        return sheet_type, confidence, sheet_number

    text = " ".join(_clean_text(s.text) for s in spans)
    if _looks_like_schedule_sheet(text):
        return SheetType.SCHEDULE, 0.8, sheet_number
    votes: dict[SheetType, float] = {}
    for keyword, sheet_type, weight in _KEYWORDS:
        if keyword in text:
            votes[sheet_type] = votes.get(sheet_type, 0.0) + weight
    if votes:
        best = max(votes, key=votes.get)
        confidence = min(0.8, votes[best] / 1.5)
        if best in _TYPE_PRIORITY:
            return best, confidence, sheet_number

    if sheet_number:
        for pattern, sheet_type in _PREFIX_MAP:
            if re.match(pattern, sheet_number):
                return sheet_type, 0.85, sheet_number

    if votes:
        return best, confidence, sheet_number
    return SheetType.UNKNOWN, 0.0, sheet_number
