"""Qwen3-VL adapter — visual reasoning/audit ONLY.

Hard rule enforced by the interface itself: the VLM answers multiple-choice
ambiguity questions with evidence references. It is never asked to read every
label, never asked for coordinates, never asked to compute a measurement, and
its output can only flip decisions/flags — quantities come from geometry.

Model sizing guidance:
  - Qwen3-VL-8B: default; most matching/audit questions.
  - Qwen3-VL-32B/72B: harder layout reasoning.
  - Qwen3-VL-235B-A22B-Thinking: reserve for escalations (a second-pass queue),
    not the default path.

Hosting: SageMaker real-time endpoint (too large for serverless) or any
vLLM/TGI OpenAI-compatible server. Both transports are supported.

SageMaker payload contract (a thin chat wrapper you implement in the
endpoint container):
  request : {"messages": [...OpenAI-style with image_url b64 parts...]}
  response: {"content": "<model text>"}
"""

from __future__ import annotations

import json
import re
from typing import Any

from app.adapters.base import VLMAdapter, VLMDecision
from app.adapters.transport import (
    AdapterNotConfigured,
    ModelTransport,
    OpenAICompatTransport,
    SageMakerTransport,
)

SYSTEM_PROMPT = """You are an audit assistant for a construction takeoff system.
You answer ONE question at a time about blueprint image crops.
Rules:
- Choose exactly one of the offered options.
- Cite the evidence ids you used (span/geometry ids given in the context).
- NEVER estimate, calculate, or output a measurement, area, length, or count.
- If the crops are insufficient to decide, choose the option named "uncertain".
Respond with JSON only: {"decision": "<option>", "confidence": 0.0-1.0,
"evidence_span_ids": [...], "evidence_geometry_ids": [...], "rationale": "<1-2 sentences>"}"""


class QwenVLAdapter(VLMAdapter):
    name = "qwen3-vl"

    def __init__(self, transport: ModelTransport):
        self.transport = transport

    @classmethod
    def from_settings(cls, settings) -> QwenVLAdapter:
        if settings.vlm_transport == "sagemaker":
            return cls(SageMakerTransport(settings.vlm_sagemaker_endpoint, settings.aws_region))
        if settings.vlm_transport == "openai_compat":
            return cls(
                OpenAICompatTransport(
                    settings.vlm_openai_base_url,
                    settings.vlm_openai_model,
                    settings.openai_api_key,
                )
            )
        raise AdapterNotConfigured(
            "Qwen VLM", "Set TAKEOFF_VLM_TRANSPORT to sagemaker or openai_compat"
        )

    def decide(
        self,
        question_id: str,
        question: str,
        options: list[str],
        image_crops_b64: list[str],
        context: dict[str, Any],
    ) -> VLMDecision:
        content: list[dict] = [
            {
                "type": "text",
                "text": (
                    f"Question: {question}\n"
                    f"Options: {json.dumps(options + ['uncertain'])}\n"
                    f"Context (evidence ids and OCR text): {json.dumps(context, default=str)}"
                ),
            }
        ]
        for crop in image_crops_b64:
            content.append(
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{crop}"}}
            )
        resp = self.transport.invoke(
            {
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": content},
                ]
            }
        )
        return self._parse(question_id, resp.get("content", ""), options)

    def _parse(self, question_id: str, raw: str, options: list[str]) -> VLMDecision:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if not m:
            return VLMDecision(
                question_id=question_id, decision="uncertain", confidence=0.0,
                rationale=f"unparseable VLM output: {raw[:200]}",
            )
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            return VLMDecision(
                question_id=question_id, decision="uncertain", confidence=0.0,
                rationale=f"invalid JSON from VLM: {raw[:200]}",
            )
        decision = str(data.get("decision", "uncertain"))
        if decision not in options and decision != "uncertain":
            decision = "uncertain"  # off-menu answers are treated as abstentions
        return VLMDecision(
            question_id=question_id,
            decision=decision,
            confidence=max(0.0, min(1.0, float(data.get("confidence", 0.0)))),
            evidence_span_ids=[str(s) for s in data.get("evidence_span_ids", [])],
            evidence_geometry_ids=[str(s) for s in data.get("evidence_geometry_ids", [])],
            rationale=str(data.get("rationale", "")),
        )
