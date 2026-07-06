"""VLM audit stage — the ONLY place a VLM is consulted.

Builds an ambiguity queue (questions the deterministic pipeline could not
settle), sends each to the VLMAdapter as a multiple-choice question with
image crops + evidence ids, and applies the structured decisions:
confidence adjustments and review flags only — never quantity values.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np

from app.adapters.base import VLMAdapter, VLMDecision
from app.schemas.confidence import ReviewReason
from app.schemas.quantity import QuantityItem


@dataclass
class AuditQuestion:
    question_id: str
    kind: str                 # scale_choice | label_match | schedule_row | callout_ref | polygon_check
    question: str
    options: list[str]
    crops_pt: list[tuple[float, float, float, float]]  # regions to crop, page points
    context: dict[str, Any] = field(default_factory=dict)
    quantity_item_id: str = ""


def crop_b64(image: np.ndarray, bbox_pt, px_per_pt: float, pad_pt: float = 20.0) -> str:
    h, w = image.shape[:2]
    x0 = max(0, int((bbox_pt[0] - pad_pt) * px_per_pt))
    y0 = max(0, int((bbox_pt[1] - pad_pt) * px_per_pt))
    x1 = min(w, int((bbox_pt[2] + pad_pt) * px_per_pt))
    y1 = min(h, int((bbox_pt[3] + pad_pt) * px_per_pt))
    ok, buf = cv2.imencode(".png", image[y0:y1, x0:x1])
    return base64.b64encode(buf.tobytes()).decode() if ok else ""


def build_question_queue(items: list[QuantityItem]) -> list[AuditQuestion]:
    """Only flagged/ambiguous items generate VLM work — clean measurements
    never pay the VLM tax."""
    queue: list[AuditQuestion] = []
    for item in items:
        if not item.needs_review:
            continue
        if ReviewReason.LABEL_FAR_FROM_POLYGON in item.review_reason:
            queue.append(
                AuditQuestion(
                    question_id=f"label_match:{item.id}",
                    kind="label_match",
                    question=(
                        "Does the highlighted room label belong to the outlined polygon, "
                        "or to a different room?"
                    ),
                    options=["label_matches_polygon", "label_belongs_elsewhere"],
                    crops_pt=[],
                    context={"quantity_item": item.id, "geometry_ids": item.source_geometry_ids},
                    quantity_item_id=item.id,
                )
            )
        if (
            ReviewReason.MASK_OVERREACH in item.review_reason
            or ReviewReason.OPEN_POLYGON in item.review_reason
        ):
            queue.append(
                AuditQuestion(
                    question_id=f"polygon_check:{item.id}",
                    kind="polygon_check",
                    question=(
                        "Is the outlined polygon a plausible boundary for a single room/slab, "
                        "or is it likely wrong (spanning multiple rooms, cut off, or noise)?"
                    ),
                    options=["polygon_plausible", "polygon_likely_wrong"],
                    crops_pt=[],
                    context={"quantity_item": item.id, "geometry_ids": item.source_geometry_ids},
                    quantity_item_id=item.id,
                )
            )
        if ReviewReason.SCALE_DIMENSION_CONFLICT in item.review_reason:
            queue.append(
                AuditQuestion(
                    question_id=f"scale_choice:{item.id}",
                    kind="scale_choice",
                    question=(
                        "The written scale note and a measured dimension string disagree. "
                        "Looking at the crops, which is more consistent with the drawing?"
                    ),
                    options=["trust_scale_note", "trust_known_dimension"],
                    crops_pt=[],
                    context={"quantity_item": item.id, "scale_id": item.scale_id},
                    quantity_item_id=item.id,
                )
            )
    return queue


def run_audit(
    queue: list[AuditQuestion],
    vlm: VLMAdapter,
    image: np.ndarray | None,
    px_per_pt: float,
    items_by_id: dict[str, QuantityItem],
) -> list[VLMDecision]:
    """Ask each question; fold decisions into item confidence/flags.

    Decisions adjust vlm_audit confidence and flags; final_confidence is
    recomputed. Quantities are untouched by design.
    """
    decisions: list[VLMDecision] = []
    for q in queue:
        crops = (
            [crop_b64(image, b, px_per_pt) for b in q.crops_pt] if image is not None else []
        )
        decision = vlm.decide(q.question_id, q.question, q.options, crops, q.context)
        decisions.append(decision)

        item = items_by_id.get(q.quantity_item_id)
        if item is None:
            continue
        item.attributes.setdefault("vlm_decisions", []).append(decision.model_dump())
        if decision.decision == "uncertain" or decision.confidence < 0.5:
            item.confidence.vlm_audit = min(item.confidence.vlm_audit, 0.5)
            _flag(item, ReviewReason.VLM_FLAGGED)
        elif decision.decision in ("polygon_likely_wrong", "label_belongs_elsewhere"):
            item.confidence.vlm_audit = min(item.confidence.vlm_audit, 1 - decision.confidence)
            _flag(item, ReviewReason.VLM_FLAGGED)
        else:
            # VLM affirmed the machine output — it may raise vlm_audit
            # confidence but can never un-flag deterministic reasons.
            item.confidence.vlm_audit = max(
                item.confidence.vlm_audit * 0.5 + decision.confidence * 0.5, 0.5
            )
        item.final_confidence = item.confidence.final()
    return decisions


def _flag(item: QuantityItem, reason: ReviewReason) -> None:
    item.needs_review = True
    if reason not in item.review_reason:
        item.review_reason.append(reason)
