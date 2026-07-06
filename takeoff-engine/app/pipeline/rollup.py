"""Estimator rollup: deterministic derivations + CSI/assembly mapping.

Derivations (thickness→CY, waste factors) are pure code in measure.py.
The rollup LLM adapter only decorates items with CSI codes/assembly names/
descriptions; a builtin table covers the MVP trades without any LLM.
"""

from __future__ import annotations

import re

from app.adapters.base import RollupLLMAdapter
from app.config import Settings
from app.geometry.units import parse_feet_inches
from app.pipeline.measure import derive_concrete_volume, derive_flooring
from app.schemas.ocr import OCRSpan
from app.schemas.quantity import QuantityItem

_THICKNESS_RE = re.compile(
    r"""(\d+(?:\s+\d/\d)?(?:\.\d+)?\s*(?:"|”|″))\s*
        (?:THK\.?|THICK(?:NESS)?)?\s*
        (?:CONC(?:RETE)?\.?\s*)?SLAB
      | SLAB[^.\n]{0,30}?(\d+(?:\s+\d/\d)?(?:\.\d+)?\s*(?:"|”|″))""",
    re.IGNORECASE | re.VERBOSE,
)


def find_slab_thickness_ft(spans: list[OCRSpan]) -> tuple[float | None, list[str]]:
    """Scan notes/callouts for a slab thickness, e.g. '4" CONC. SLAB'.
    Returns (thickness_ft, evidence span ids)."""
    for span in spans:
        m = _THICKNESS_RE.search(span.text)
        if not m:
            continue
        token = m.group(1) or m.group(2)
        thickness_ft = parse_feet_inches(token, default_unit="in")
        if thickness_ft and 0.5 / 12 <= thickness_ft <= 4.0:  # 0.5"–48" plausible slab range
            return thickness_ft, [span.id]
    return None, []


def rollup_items(
    items: list[QuantityItem],
    spans: list[OCRSpan],
    rollup_llm: RollupLLMAdapter,
    settings: Settings,
) -> list[QuantityItem]:
    # Deterministic derivations first.
    thickness_ft, thickness_spans = find_slab_thickness_ft(spans)
    for item in items:
        if item.item_type == "concrete_slab" and item.unit == "SF":
            if thickness_ft is not None:
                derive_concrete_volume(item, thickness_ft, thickness_source="callout")
                item.source_ocr_span_ids.extend(thickness_spans)
            else:
                derive_concrete_volume(
                    item, settings.default_slab_thickness_in / 12.0, thickness_source="default"
                )
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
