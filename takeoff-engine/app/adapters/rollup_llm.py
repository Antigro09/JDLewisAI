"""Text-LLM rollup adapter (Llama 3.3 70B / Qwen text).

Scope is deliberately narrow: map item types + attributes to CSI-style
assemblies, units, and clean descriptions. Quantities pass through untouched —
the adapter output contains NO numbers, and the caller ignores any it emits.
The builtin table (rollup_mock.BUILTIN_ASSEMBLIES) always wins over the LLM
for known item types; the LLM only covers the long tail.

Hosting: SageMaker real-time endpoint or OpenAI-compatible vLLM server.
"""

from __future__ import annotations

import json
import re
from typing import Any

from app.adapters.base import RollupLLMAdapter, RollupRow
from app.adapters.rollup_mock import BUILTIN_ASSEMBLIES
from app.adapters.transport import (
    AdapterNotConfigured,
    ModelTransport,
    OpenAICompatTransport,
    SageMakerTransport,
)

PROMPT = """You map construction takeoff items to CSI MasterFormat categories.
For each input item return: item_type, csi_code (level-2/3 like "03 30 00"),
assembly_name, description (short, estimator-style), unit (echo the given unit),
confidence (0-1). Do NOT output quantities or any other numbers.
Respond with a JSON array only.

Items:
{items}"""


class TextLLMRollupAdapter(RollupLLMAdapter):
    name = "text-llm-rollup"

    def __init__(self, transport: ModelTransport):
        self.transport = transport

    @classmethod
    def from_settings(cls, settings) -> TextLLMRollupAdapter:
        if settings.rollup_transport == "sagemaker":
            return cls(SageMakerTransport(settings.rollup_sagemaker_endpoint, settings.aws_region))
        if settings.rollup_transport == "openai_compat":
            return cls(
                OpenAICompatTransport(
                    settings.rollup_openai_base_url,
                    settings.rollup_openai_model,
                    settings.openai_api_key,
                )
            )
        raise AdapterNotConfigured(
            "Rollup LLM", "Set TAKEOFF_ROLLUP_TRANSPORT to sagemaker or openai_compat"
        )

    def map_assemblies(self, items: list[dict[str, Any]]) -> list[RollupRow]:
        rows: list[RollupRow] = []
        unknown: list[tuple[int, dict]] = []
        for i, item in enumerate(items):
            builtin = BUILTIN_ASSEMBLIES.get(item.get("item_type", ""))
            if builtin is not None:
                rows.append(builtin)
            else:
                rows.append(RollupRow(item_type=item.get("item_type", "unknown")))
                unknown.append((i, item))
        if not unknown:
            return rows

        safe_items = [
            {k: v for k, v in item.items() if k in ("item_type", "description", "unit", "attributes")}
            for _, item in unknown
        ]
        resp = self.transport.invoke(
            {"messages": [{"role": "user", "content": PROMPT.format(items=json.dumps(safe_items))}]}
        )
        for (idx, item), mapped in zip(unknown, self._parse(resp.get("content", "")), strict=False):
            if mapped.item_type == item.get("item_type"):
                mapped.unit = item.get("unit", mapped.unit)  # unit is ours, not the LLM's
                rows[idx] = mapped
        return rows

    def _parse(self, raw: str) -> list[RollupRow]:
        m = re.search(r"\[.*\]", raw, re.DOTALL)
        if not m:
            return []
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            return []
        out = []
        for d in data:
            try:
                out.append(
                    RollupRow(
                        item_type=str(d.get("item_type", "")),
                        csi_code=str(d.get("csi_code", "")),
                        assembly_name=str(d.get("assembly_name", "")),
                        description=str(d.get("description", "")),
                        unit=str(d.get("unit", "")),
                        confidence=max(0.0, min(1.0, float(d.get("confidence", 0.0)))),
                    )
                )
            except (TypeError, ValueError):
                continue
        return out
