"""Wall-type tag anchoring.

A wall tag (hexagon like S2-0-6, boxed letter like "A") marks a wall via a
LEADER line whose far end lands on the wall itself. Attributing by the leader
endpoint instead of raw text proximity matters twice:

  * two tags can be nearly equidistant from a wall — the leader disambiguates;
  * a tag's leader can land on a gray-pochéd band, overriding the "gray means
    existing" default for that band (drafters poché a new partition gray when
    it matches existing construction thickness).

"TYP" semantics (one tag stands for every similar wall) are handled later by
thickness propagation during attribution — the anchor is only the tag's own
wall.
"""

from __future__ import annotations

import math

from app.schemas.core import VectorPath
from app.schemas.ocr import OCRSpan


def _span_center(span: OCRSpan) -> tuple[float, float]:
    return ((span.bbox[0] + span.bbox[2]) / 2, (span.bbox[1] + span.bbox[3]) / 2)


def leader_anchor(
    span: OCRSpan,
    vector_paths: list[VectorPath],
    *,
    max_start_dist_pt: float = 10.0,
    min_leader_pt: float = 8.0,
    max_leader_pt: float = 320.0,
) -> tuple[float, float] | None:
    """Far endpoint of the leader line attached to a tag span, if one exists.

    The leader must actually LEAVE the tag vicinity — the hexagon/box outline
    around the tag starts just as close but ends nearby, and must never win
    over the true leader."""
    cx, cy = _span_center(span)
    half_w = (span.bbox[2] - span.bbox[0]) / 2
    half_h = (span.bbox[3] - span.bbox[1]) / 2
    start_radius = max(half_w, half_h) + max_start_dist_pt
    best: tuple[float, tuple[float, float]] | None = None
    for vp in vector_paths:
        if vp.dashes or "stroke" not in vp.kind:
            continue
        for sub in vp.points:
            if len(sub) < 2:
                continue
            length = sum(math.dist(a, b) for a, b in zip(sub, sub[1:], strict=False))
            if not (min_leader_pt <= length <= max_leader_pt):
                continue
            for near, far in ((sub[0], sub[-1]), (sub[-1], sub[0])):
                d_near = math.dist(near, (cx, cy))
                d_far = math.dist(far, (cx, cy))
                if d_near > start_radius or d_far <= start_radius + 6.0:
                    continue
                if best is None or d_near < best[0]:
                    best = (d_near, far)
    return best[1] if best else None


def tag_anchors(
    tag_spans: list[tuple[str, OCRSpan]],
    vector_paths: list[VectorPath],
) -> list[tuple[str, OCRSpan, tuple[float, float]]]:
    """(code, span, anchor point) per tag — leader endpoint, else span center."""
    out = []
    for code, span in tag_spans:
        anchor = leader_anchor(span, vector_paths) or _span_center(span)
        out.append((code, span, anchor))
    return out


def is_boxed_tag(span: OCRSpan, vector_paths: list[VectorPath]) -> bool:
    """True when a small square/hex outline encloses the span — how plan sets
    with single-letter wall types (A, B, X2...) distinguish a wall tag from
    structural grid bubbles (circles) and plain-text letters."""
    cx, cy = _span_center(span)
    for vp in vector_paths:
        if "stroke" not in vp.kind or vp.dashes:
            continue
        x0, y0, x1, y1 = vp.bbox
        w, h = x1 - x0, y1 - y0
        if not (5.0 <= w <= 34.0 and 5.0 <= h <= 34.0):
            continue
        if not (x0 <= cx <= x1 and y0 <= cy <= y1):
            continue
        if max(w, h) / max(1.0, min(w, h)) > 1.9:
            continue
        # enough ink to be a box (not a stray tick), overwhelmingly
        # axis-aligned (a grid bubble's flattened circle is not)
        total = 0.0
        axis = 0.0
        for sub in vp.points:
            for a, b in zip(sub, sub[1:], strict=False):
                seg = math.dist(a, b)
                total += seg
                angle = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180.0
                if min(angle, 180.0 - angle) <= 8.0 or abs(angle - 90.0) <= 8.0:
                    axis += seg
        if total >= 0.9 * (w + h) and axis >= 0.7 * total:
            return True
    return False


def is_circled(span: OCRSpan, vector_paths: list[VectorPath]) -> bool:
    """A letter inside a small circle is a structural grid bubble or callout,
    never a wall tag."""
    cx, cy = _span_center(span)
    for vp in vector_paths:
        x0, y0, x1, y1 = vp.bbox
        w, h = x1 - x0, y1 - y0
        if not (10.0 <= w <= 45.0 and 10.0 <= h <= 45.0):
            continue
        if max(w, h) / max(1.0, min(w, h)) > 1.35:
            continue
        if not (x0 <= cx <= x1 and y0 <= cy <= y1):
            continue
        if sum(len(sub) for sub in vp.points) >= 12:  # flattened circle
            return True
    return False


def find_tag_spans(
    spans: list[OCRSpan],
    code_regex,
    lexicon: dict[str, dict] | None = None,
    vector_paths: list[VectorPath] | None = None,
) -> list[tuple[str, OCRSpan]]:
    """Wall-tag text spans. Regex codes (S2-0-6 style) match anywhere. Short
    catalog codes (single letters) are wall tags when boxed or bare — but a
    circled letter is a structural grid bubble, not a tag."""
    lexicon = lexicon or {}
    out: list[tuple[str, OCRSpan]] = []
    for span in spans:
        text = span.text.strip().upper()
        match = code_regex.search(text)
        if match:
            out.append((match.group(0).upper(), span))
            continue
        if text in lexicon:
            if len(text) <= 2 and vector_paths is not None and is_circled(span, vector_paths):
                continue
            out.append((text, span))
    return out
