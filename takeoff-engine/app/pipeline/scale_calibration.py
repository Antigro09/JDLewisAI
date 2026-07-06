"""Scale calibration — ranked-source resolver (real implementation).

Source ranking:
  1. PDF/CAD metadata           (pdf_pymupdf.scale_metadata; rare but exact)
  2. Written scale note         ('1/8" = 1\'-0"', '1"=20\'', '1:100')
  3. Graphic scale bar          (stub hook: detector finds the bar, geometry
                                 measures its ticks; TODO wire when the
                                 detector is fine-tuned to find scale bars)
  4. Known dimension string     (dimension text matched to its extension-line
                                 length: ft_per_pt = dim_ft / line_pt)
  5. Manual two-click           (API: POST /sheets/{id}/calibrate)

NTS sheets get an explicit refusal calibration. The engine never measures a
sheet without a usable, attributed scale.
"""

from __future__ import annotations

import math
import re

from app.geometry.units import parse_feet_inches
from app.schemas.core import Sheet
from app.schemas.ocr import OCRSpan
from app.schemas.scale import SOURCE_BASE_CONFIDENCE, ScaleCalibration, ScaleSource

PT_PER_IN = 72.0
FT_PER_PT_UNITY = 1.0 / (72.0 * 12.0)  # 1:1 → one point of paper is 1/864 ft

_NTS_RE = re.compile(r"\b(?:N\.?\s?T\.?\s?S\.?|NOT\s+TO\s+SCALE)\b", re.IGNORECASE)

# 1/8" = 1'-0"   ·   3/32"=1'   ·   1 1/2" = 1'-0"
_ARCH_SCALE_RE = re.compile(
    r"""(?P<paper>\d+(?:\.\d+)?(?:\s+\d+/\d+)?|\d+/\d+)\s*(?:"|”|″|in\b)\s*
        =\s*
        (?P<real>[\d'\-\s/."”″]+?)\s*$""",
    re.IGNORECASE | re.VERBOSE,
)
# 1" = 20'  (engineering scale) is covered by the same pattern.
# 1:100 / 1:50 metric ratio
_RATIO_RE = re.compile(r"\b1\s*:\s*(?P<ratio>\d{1,5})\b")


def parse_scale_note(text: str) -> tuple[float | None, str]:
    """Parse a written scale note into ft_per_pt.

    Returns (ft_per_pt, canonical_text). (None, 'NTS') for not-to-scale notes,
    (None, '') when the text is not a scale note at all.
    """
    s = (
        text.replace("’", "'").replace("′", "'")
        .replace("“", '"').replace("”", '"').replace("″", '"')
        .replace("⁄", "/").strip()
    )
    # Strip a leading "SCALE:" label.
    s = re.sub(r"^\s*SCALE\s*[:=]?\s*", "", s, flags=re.IGNORECASE)

    if _NTS_RE.search(s):
        return None, "NTS"

    m = _ARCH_SCALE_RE.search(s)
    if m:
        paper_in = parse_feet_inches(m.group("paper"), default_unit="in")
        real_ft = parse_feet_inches(m.group("real"), default_unit="ft")
        if paper_in and real_ft and paper_in > 0 and real_ft > 0:
            paper_in_actual = paper_in * 12.0  # parse gave feet; the token is inches
            ft_per_in = real_ft / paper_in_actual
            # Sanity: architectural/engineering scales live in a known range.
            if 0.5 <= ft_per_in <= 2000:
                return ft_per_in / PT_PER_IN, f'{m.group("paper")}" = {m.group("real").strip()}'

    m = _RATIO_RE.search(s)
    if m:
        ratio = int(m.group("ratio"))
        if 2 <= ratio <= 20000:
            return ratio * FT_PER_PT_UNITY, f"1:{ratio}"

    return None, ""


def find_scale_notes(spans: list[OCRSpan]) -> list[tuple[OCRSpan, float, str]]:
    """All spans that parse as usable scale notes → (span, ft_per_pt, text)."""
    hits = []
    for span in spans:
        ft_per_pt, canonical = parse_scale_note(span.text)
        if ft_per_pt is not None:
            hits.append((span, ft_per_pt, canonical))
    return hits


def sheet_is_nts(spans: list[OCRSpan]) -> OCRSpan | None:
    for span in spans:
        _, canonical = parse_scale_note(span.text)
        if canonical == "NTS":
            return span
    return None


def calibrate_from_known_dimension(
    sheet_id: str, dim_text: str, line_length_pt: float, span_id: str = ""
) -> ScaleCalibration | None:
    """Ranked source #4: a dimension string matched to its measured extension
    line. ft_per_pt = printed_feet / drawn_points."""
    dim_ft = parse_feet_inches(dim_text)
    if not dim_ft or dim_ft <= 0 or line_length_pt <= 0:
        return None
    return ScaleCalibration(
        sheet_id=sheet_id,
        source=ScaleSource.KNOWN_DIMENSION,
        ft_per_pt=dim_ft / line_length_pt,
        scale_text=dim_text,
        source_ocr_span_ids=[span_id] if span_id else [],
        confidence=SOURCE_BASE_CONFIDENCE[ScaleSource.KNOWN_DIMENSION],
    )


def manual_calibration(
    sheet_id: str, p1: tuple[float, float], p2: tuple[float, float], real_distance_ft: float
) -> ScaleCalibration:
    """Ranked source #5: two clicks (page points) plus the real distance."""
    d = math.dist(p1, p2)
    if d <= 0 or real_distance_ft <= 0:
        raise ValueError("calibration points must be distinct and distance positive")
    return ScaleCalibration(
        sheet_id=sheet_id,
        source=ScaleSource.MANUAL,
        ft_per_pt=real_distance_ft / d,
        scale_text=f"manual: {real_distance_ft} ft over {d:.1f} pt",
        confidence=SOURCE_BASE_CONFIDENCE[ScaleSource.MANUAL],
    )


def resolve_scale(
    sheet: Sheet,
    spans: list[OCRSpan],
    pdf_metadata_ft_per_pt: float | None = None,
    known_dimension: ScaleCalibration | None = None,
) -> ScaleCalibration:
    """Pick the best available scale for a sheet, in rank order.

    A cross-check between independent sources adjusts confidence: agreement
    (within 2%) boosts, disagreement (> 5%) cuts — the conflict is surfaced,
    not hidden.
    """
    if pdf_metadata_ft_per_pt:
        return ScaleCalibration(
            sheet_id=sheet.id,
            source=ScaleSource.PDF_METADATA,
            ft_per_pt=pdf_metadata_ft_per_pt,
            scale_text="pdf viewport metadata",
            confidence=SOURCE_BASE_CONFIDENCE[ScaleSource.PDF_METADATA],
        )

    nts_span = sheet_is_nts(spans)
    notes = find_scale_notes(spans)

    if notes:
        span, ft_per_pt, canonical = notes[0]
        cal = ScaleCalibration(
            sheet_id=sheet.id,
            source=ScaleSource.SCALE_NOTE,
            ft_per_pt=ft_per_pt,
            scale_text=canonical,
            source_ocr_span_ids=[span.id],
            confidence=SOURCE_BASE_CONFIDENCE[ScaleSource.SCALE_NOTE] * span.confidence,
        )
        if nts_span is not None:
            # Sheet says NTS *and* carries a scale note — a detail sheet with a
            # scaled viewport, or a conflict. Keep the note but demand review.
            cal.confidence *= 0.6
            cal.notes = "sheet also contains an NTS marking"
        if known_dimension and known_dimension.usable:
            rel = abs(known_dimension.ft_per_pt - ft_per_pt) / ft_per_pt
            if rel <= 0.02:
                cal.confidence = min(0.98, cal.confidence + 0.10)
                cal.notes = (cal.notes + " agrees with known dimension").strip()
            elif rel > 0.05:
                cal.confidence *= 0.5
                cal.notes = (
                    f"{cal.notes} CONFLICT: known dimension implies "
                    f"{known_dimension.ft_per_pt:.6f} ft/pt vs note {ft_per_pt:.6f}"
                ).strip()
        return cal

    if known_dimension and known_dimension.usable:
        return known_dimension

    if nts_span is not None:
        return ScaleCalibration(
            sheet_id=sheet.id,
            source=ScaleSource.NTS,
            ft_per_pt=None,
            scale_text="NTS",
            source_ocr_span_ids=[nts_span.id],
            confidence=0.0,
            notes="not to scale — automatic measurement refused",
        )

    return ScaleCalibration(
        sheet_id=sheet.id,
        source=ScaleSource.NONE,
        ft_per_pt=None,
        confidence=0.0,
        notes="no scale source found — manual calibration required",
    )
