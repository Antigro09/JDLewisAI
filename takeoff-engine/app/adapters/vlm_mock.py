"""Mock VLM — deterministic, conservative answers for offline runs/tests."""

from __future__ import annotations

from typing import Any

from app.adapters.base import VLMAdapter, VLMDecision


class MockVLMAdapter(VLMAdapter):
    name = "mock-vlm"

    def __init__(self, scripted: dict[str, VLMDecision] | None = None):
        self.scripted = scripted or {}
        self.questions_asked: list[str] = []

    def decide(
        self,
        question_id: str,
        question: str,
        options: list[str],
        image_crops_b64: list[str],
        context: dict[str, Any],
    ) -> VLMDecision:
        self.questions_asked.append(question_id)
        if question_id in self.scripted:
            return self.scripted[question_id]
        # Conservative default: pick the first option with modest confidence
        # and say so — the mock never pretends to certainty.
        return VLMDecision(
            question_id=question_id,
            decision=options[0] if options else "unknown",
            confidence=0.6,
            rationale="mock-vlm default: first option, no visual reasoning performed",
        )
