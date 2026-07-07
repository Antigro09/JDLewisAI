"""Confidence finalization + review flagging (deterministic).

Applies the flag rules, computes final confidence, and stamps needs_review.
Runs as stage 7 of the pipeline (before the VLM audit and rollup); those later
stages only ADD flags and lower confidence — they never un-flag — and the
orchestrator re-checks the low-confidence threshold after they run.

Rules that need cross-item context (VERSION_DELTA needs a prior version;
SCHEDULE_PLAN_MISMATCH needs schedule linking) only fire when the orchestrator
supplies previous_quantity / schedule_plan_mismatch; both are wired opportun-
istically as that upstream data becomes available."""

from __future__ import annotations

from app.config import Settings
from app.geometry.engine import GeometryEngine
from app.schemas.confidence import ReviewReason
from app.schemas.detection import DetectedObject, PolygonGeometry, SegmentationMask
from app.schemas.quantity import QuantityItem
from app.schemas.scale import ScaleCalibration, ScaleSource

_geom = GeometryEngine()


def finalize_item(
    item: QuantityItem,
    *,
    settings: Settings,
    scale: ScaleCalibration,
    geometries: dict[str, PolygonGeometry],
    masks: dict[str, SegmentationMask] | None = None,
    label_detection: DetectedObject | None = None,
    previous_quantity: float | None = None,
    schedule_plan_mismatch: bool = False,
) -> QuantityItem:
    def flag(reason: ReviewReason):
        item.needs_review = True
        if reason not in item.review_reason:
            item.review_reason.append(reason)

    # 1-2. NTS / no reliable scale (counts are scale-free, EA excluded)
    if item.unit != "EA":
        if scale.source == ScaleSource.NTS:
            flag(ReviewReason.NTS_SHEET)
        elif scale.source == ScaleSource.NONE:
            # No scale source at all → a human must calibrate (two-click).
            flag(ReviewReason.MANUAL_CALIBRATION_REQUIRED)
        elif not scale.usable or scale.confidence < settings.min_scale_confidence:
            # A source exists but is unusable/weak.
            flag(ReviewReason.NO_RELIABLE_SCALE)

    # 3. open polygons
    for gid in item.source_geometry_ids:
        g = geometries.get(gid)
        if g is not None and g.kind == "polygon" and not g.is_closed:
            flag(ReviewReason.OPEN_POLYGON)

    # 4. OCR scale conflicts with known dimensions (recorded by the resolver)
    if "CONFLICT" in scale.notes:
        flag(ReviewReason.SCALE_DIMENSION_CONFLICT)

    # 5. schedule vs plan tag disagreement (set by schedule-linking logic)
    if schedule_plan_mismatch:
        flag(ReviewReason.SCHEDULE_PLAN_MISMATCH)

    # 6. quantity differs too much from the previous version
    if previous_quantity not in (None, 0):
        delta_pct = abs(item.quantity - previous_quantity) / abs(previous_quantity) * 100
        if delta_pct > settings.version_delta_review_pct:
            flag(ReviewReason.VERSION_DELTA)
            item.attributes["previous_quantity"] = previous_quantity
            item.attributes["delta_pct"] = round(delta_pct, 1)

    # 7. SAM mask touches too many unrelated line regions
    for gid in item.source_geometry_ids:
        g = geometries.get(gid)
        if g is None or masks is None:
            continue
        for src in g.derived_from:
            m = masks.get(src)
            if m is not None and m.line_overreach_ratio > settings.mask_line_overreach_ratio:
                flag(ReviewReason.MASK_OVERREACH)

    # 8. room label outside/far from its polygon
    if label_detection is not None and scale.usable:
        for gid in item.source_geometry_ids:
            g = geometries.get(gid)
            if g is None or g.kind != "polygon":
                continue
            dist_ft = _geom.label_distance_pt(label_detection.bbox, g) * scale.ft_per_pt
            if dist_ft > settings.label_max_distance_ft:
                flag(ReviewReason.LABEL_FAR_FROM_POLYGON)
                item.attributes["label_distance_ft"] = round(dist_ft, 1)

    # 9. final confidence below threshold
    item.final_confidence = item.confidence.final()
    if item.final_confidence < settings.review_confidence_threshold:
        flag(ReviewReason.LOW_CONFIDENCE)

    return item
