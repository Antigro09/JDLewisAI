"""Mock rollup - a deterministic builtin CSI/assembly table.

In practice this covers the MVP trades entirely; the LLM adapter only adds
nicer descriptions and coverage of unseen item types.
"""

from __future__ import annotations

from typing import Any

from app.adapters.base import RollupLLMAdapter, RollupRow

BUILTIN_ASSEMBLIES: dict[str, RollupRow] = {
    "concrete_slab": RollupRow(
        item_type="concrete_slab", csi_code="03 30 00",
        assembly_name="Cast-in-Place Concrete - Slab on Grade",
        description="Concrete slab on grade", unit="CY", confidence=1.0,
    ),
    "flooring": RollupRow(
        item_type="flooring", csi_code="09 60 00",
        assembly_name="Flooring - Finish by Room",
        description="Floor finish", unit="SF", confidence=1.0,
    ),
    "wall": RollupRow(
        item_type="wall", csi_code="09 22 16",
        assembly_name="Non-Structural Metal Framing",
        description="Wall segment", unit="LF", confidence=1.0,
    ),
    "column": RollupRow(
        item_type="column", csi_code="03 30 00",
        assembly_name="Cast-in-Place Concrete - Column",
        description="Column", unit="EA", confidence=1.0,
    ),
    "door": RollupRow(
        item_type="door", csi_code="08 11 00",
        assembly_name="Doors and Frames",
        description="Door (per schedule mark)", unit="EA", confidence=1.0,
    ),
    "window": RollupRow(
        item_type="window", csi_code="08 50 00",
        assembly_name="Windows",
        description="Window (per schedule mark)", unit="EA", confidence=1.0,
    ),
}


class MockRollupAdapter(RollupLLMAdapter):
    name = "mock-rollup-builtin"

    def map_assemblies(self, items: list[dict[str, Any]]) -> list[RollupRow]:
        out = []
        for item in items:
            row = BUILTIN_ASSEMBLIES.get(item.get("item_type", ""))
            if row is None:
                row = RollupRow(
                    item_type=item.get("item_type", "unknown"),
                    description=item.get("description", ""),
                    unit=item.get("unit", ""),
                    confidence=0.0,  # unmapped items surface as needing review upstream
                )
            out.append(row)
        return out
