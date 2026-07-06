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
    if sheet_number:
        for pattern, sheet_type in _PREFIX_MAP:
            if re.match(pattern, sheet_number):
                return sheet_type, 0.85, sheet_number

    text = " ".join(s.text.upper() for s in spans)
    votes: dict[SheetType, float] = {}
    for keyword, sheet_type, weight in _KEYWORDS:
        if keyword in text:
            votes[sheet_type] = votes.get(sheet_type, 0.0) + weight
    if votes:
        best = max(votes, key=votes.get)
        return best, min(0.8, votes[best] / 1.5), sheet_number
    return SheetType.UNKNOWN, 0.0, sheet_number
