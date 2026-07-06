"""Confidence system.

Every quantity carries a bundle of stage confidences plus a deterministic
final score. The final score is intentionally pessimistic: a chain is only
as strong as its weakest evidence, so we blend the minimum with the product
rather than averaging (averaging hides a broken link behind good ones).
"""

from enum import Enum

from pydantic import BaseModel, Field


class ReviewReason(str, Enum):
    NTS_SHEET = "nts_sheet"
    NO_RELIABLE_SCALE = "no_reliable_scale"
    OPEN_POLYGON = "open_polygon"
    SCALE_DIMENSION_CONFLICT = "scale_dimension_conflict"
    SCHEDULE_PLAN_MISMATCH = "schedule_plan_mismatch"
    VERSION_DELTA = "version_delta"
    MASK_OVERREACH = "mask_overreach"
    LABEL_FAR_FROM_POLYGON = "label_far_from_polygon"
    LOW_CONFIDENCE = "low_confidence"
    IMPLAUSIBLE_MEASUREMENT = "implausible_measurement"
    VLM_FLAGGED = "vlm_flagged"
    MANUAL_CALIBRATION_REQUIRED = "manual_calibration_required"


class ConfidenceBundle(BaseModel):
    ocr: float = 1.0
    scale: float = 1.0
    geometry: float = 1.0
    detector: float = 1.0
    vlm_audit: float = 1.0  # stays 1.0 when the VLM was not consulted

    def final(self) -> float:
        parts = [self.ocr, self.scale, self.geometry, self.detector, self.vlm_audit]
        parts = [max(0.0, min(1.0, p)) for p in parts]
        lowest = min(parts)
        product = 1.0
        for p in parts:
            product *= p
        return round(0.6 * lowest + 0.4 * product, 4)


class ReviewFlags(BaseModel):
    needs_review: bool = False
    reasons: list[ReviewReason] = Field(default_factory=list)

    def flag(self, reason: ReviewReason) -> None:
        self.needs_review = True
        if reason not in self.reasons:
            self.reasons.append(reason)
