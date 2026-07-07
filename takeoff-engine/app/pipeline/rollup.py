"""Estimator rollup: deterministic derivations + CSI/assembly mapping.

Derivations (thickness→CY, waste factors) are pure code in measure.py.
The rollup LLM adapter only decorates items with CSI codes/assembly names/
descriptions; a builtin table covers the MVP trades without any LLM.
"""

from __future__ import annotations

import re
from collections import Counter

from app.adapters.base import RollupLLMAdapter
from app.config import Settings
from app.geometry.engine import GeometryEngine
from app.geometry.units import parse_feet_inches
from app.pipeline.measure import derive_concrete_volume, derive_flooring
from app.schemas.confidence import ReviewReason
from app.schemas.detection import PolygonGeometry
from app.schemas.ocr import OCRSpan
from app.schemas.quantity import QuantityItem

# Plausible cast slab thickness: 2"–24". A token outside this band is a misparse
# (e.g. a plan dimension near "SLAB"); returning None routes to the DEFAULTED +
# review path rather than silently multiplying CY by a bogus depth.
_MIN_SLAB_FT = 2.0 / 12
_MAX_SLAB_FT = 24.0 / 12

# Two shapes:
#   forward  — a dimension that directly qualifies SLAB: 4" CONC. SLAB · 6" THK SLAB · 6" SLAB
#   reversed — SLAB ... <dim>, but the gap excludes rebar/spacing markers (@ # ) and the
#              dimension may not be followed by O.C., so `SLAB W/ #4 @ 16" O.C.` (bar spacing)
#              is NOT misread as depth while `SLAB ON GRADE: 6" W/ WWM` still parses to 6".
_THICKNESS_RE = re.compile(
    r"""
    (?P<fwd>\d+(?:\s+\d/\d)?(?:\.\d+)?\s*(?:"|”|″))\s*
        (?:THK\.?|THICK(?:NESS)?\.?)?\s*(?:CONC(?:RETE)?\.?\s*)?SLAB
    |
    SLAB[^.@#\n]{0,25}?
        (?P<rev>\d+(?:\s+\d/\d)?(?:\.\d+)?\s*(?:"|”|″))
        (?!\s*(?:o\.?\s?c\.?|oc\b))
    """,
    re.IGNORECASE | re.VERBOSE,
)


def find_slab_thicknesses(spans: list[OCRSpan]) -> list[tuple[float, OCRSpan]]:
    """Every plausible slab-thickness callout as (thickness_ft, span)."""
    out: list[tuple[float, OCRSpan]] = []
    for span in spans:
        m = _THICKNESS_RE.search(span.text)
        if not m:
            continue
        t = parse_feet_inches(m.group("fwd") or m.group("rev"), default_unit="in")
        if t and _MIN_SLAB_FT <= t <= _MAX_SLAB_FT:
            out.append((t, span))
    return out


def find_slab_thickness_ft(spans: list[OCRSpan]) -> tuple[float | None, list[str]]:
    """First plausible slab thickness (thickness_ft, [span_id]) — or (None, [])."""
    hits = find_slab_thicknesses(spans)
    if not hits:
        return None, []
    t, span = hits[0]
    return t, [span.id]


def _apply_slab_thickness(
    item: QuantityItem,
    thicknesses: list[tuple[float, OCRSpan]],
    geometries: dict[str, PolygonGeometry] | None,
    engine: GeometryEngine | None,
    settings: Settings,
) -> None:
    if not thicknesses:
        derive_concrete_volume(
            item, settings.default_slab_thickness_in / 12.0, thickness_source="default"
        )
        return

    distinct = {round(t, 4) for t, _ in thicknesses}
    if len(distinct) == 1:
        t, span = thicknesses[0]
        derive_concrete_volume(item, t, thickness_source="callout")
        item.source_ocr_span_ids.append(span.id)
        return

    # Several DIFFERENT thicknesses on the sheet — associate each slab with the
    # spatially nearest callout when we have geometry; otherwise pick the most
    # common and flag, never silently apply the wrong one to every slab.
    chosen = None
    geom = (geometries or {}).get(item.source_geometry_ids[0]) if item.source_geometry_ids else None
    if geom is not None and engine is not None:
        chosen = min(thicknesses, key=lambda ts: engine.label_distance_pt(ts[1].bbox, geom))
    if chosen is not None:
        t, span = chosen
        derive_concrete_volume(item, t, thickness_source="callout")
        item.source_ocr_span_ids.append(span.id)
    else:
        common = Counter(round(t, 4) for t, _ in thicknesses).most_common(1)[0][0]
        derive_concrete_volume(item, common, thickness_source="callout")
        item.needs_review = True
        if ReviewReason.MULTI_THICKNESS not in item.review_reason:
            item.review_reason.append(ReviewReason.MULTI_THICKNESS)


def rollup_items(
    items: list[QuantityItem],
    spans: list[OCRSpan],
    rollup_llm: RollupLLMAdapter,
    settings: Settings,
    geometries: dict[str, PolygonGeometry] | None = None,
    engine: GeometryEngine | None = None,
) -> list[QuantityItem]:
    # Deterministic derivations first.
    thicknesses = find_slab_thicknesses(spans)
    for item in items:
        if item.item_type == "concrete_slab" and item.unit == "SF":
            _apply_slab_thickness(item, thicknesses, geometries, engine, settings)
        elif item.item_type == "flooring" and item.unit == "SF":
            waste = float(
                item.attributes.get("waste_factor", settings.default_flooring_waste_factor)
            )
            derive_flooring(item, waste)

    # CSI / assembly decoration (quantities pass through untouched).
    rows = rollup_llm.map_assemblies([i.model_dump(mode="json") for i in items])
    for item, row in zip(items, rows, strict=False):
        if row.item_type != item.item_type:
            continue
        item.csi_code = row.csi_code or item.csi_code
        if row.assembly_name:
            item.attributes["assembly_name"] = row.assembly_name
        if row.description and item.description == item.item_type.replace("_", " ").title():
            item.description = row.description
    return items
