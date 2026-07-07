"""Deterministic measurement engine.

Geometry + calibrated scale → QuantityItems. Every number here comes from
Shapely areas/lengths and closed-form unit math; the formula string on each
item is the exact calculation performed, reproducible by hand.
"""

from __future__ import annotations

from app.config import Settings
from app.geometry.units import apply_waste, cubic_yards, sqft_from_pt2
from app.schemas.confidence import ConfidenceBundle, ReviewReason
from app.schemas.core import Sheet
from app.schemas.detection import DetectedObject, PolygonGeometry
from app.schemas.quantity import OverlayStyle, QuantityItem
from app.schemas.scale import ScaleCalibration

STYLES = {
    "concrete_slab": OverlayStyle(stroke="#b45309", fill="#b4530933"),
    "flooring": OverlayStyle(stroke="#2563eb", fill="#2563eb33"),
    "door": OverlayStyle(stroke="#16a34a", fill="#16a34a33"),
    "window": OverlayStyle(stroke="#9333ea", fill="#9333ea33"),
}


def measure_area_item(
    *,
    project_id: str,
    sheet: Sheet,
    geometry: PolygonGeometry,
    scale: ScaleCalibration,
    detection: DetectedObject | None,
    item_type: str,
    settings: Settings,
    description: str = "",
) -> QuantityItem:
    """Room/slab polygon → SF item (slab items get thickness→CY downstream)."""
    conf = ConfidenceBundle(
        scale=scale.confidence,
        geometry=1.0 if (geometry.is_closed and geometry.is_valid) else 0.0,
        detector=detection.confidence if detection else 0.5,
    )
    item = QuantityItem(
        project_id=project_id,
        sheet_id=sheet.id,
        page_number=sheet.page_number,
        item_type=item_type,
        description=description or item_type.replace("_", " ").title(),
        quantity=0.0,
        unit="SF",
        formula="",
        source_geometry_ids=[geometry.id],
        scale_id=scale.id,
        scale_confidence=scale.confidence,
        confidence=conf,
        overlay_style=STYLES.get(item_type, OverlayStyle()),
    )
    if detection:
        item.source_ocr_span_ids = list(detection.matched_ocr_span_ids)
        item.model_confidence = detection.confidence

    if not geometry.is_closed:
        item.needs_review = True
        item.review_reason.append(ReviewReason.OPEN_POLYGON)
        item.formula = "unmeasured: polygon not closed"
        return item
    if not scale.usable:
        item.needs_review = True
        item.review_reason.append(
            ReviewReason.NTS_SHEET if scale.source.value == "nts" else ReviewReason.NO_RELIABLE_SCALE
        )
        item.formula = f"unmeasured: no usable scale ({scale.source.value})"
        return item

    sqft = sqft_from_pt2(geometry.area_pt2, scale.ft_per_pt)
    item.quantity = round(sqft, 1)
    item.measurement_confidence = conf.geometry
    item.formula = (
        f"SF = {geometry.area_pt2:.1f} pt² × ({scale.ft_per_pt:.6f} ft/pt)² = {sqft:.1f}"
    )
    if not (settings.min_polygon_area_sqft <= sqft <= settings.max_polygon_area_sqft):
        item.needs_review = True
        item.review_reason.append(ReviewReason.IMPLAUSIBLE_MEASUREMENT)
    return item


def derive_concrete_volume(item: QuantityItem, thickness_ft: float,
                           thickness_source: str = "default") -> QuantityItem:
    """Attach thickness and convert a slab SF item to CY (in place)."""
    if item.unit != "SF" or item.item_type != "concrete_slab":
        raise ValueError("volume derivation applies to concrete_slab SF items")
    sqft = item.quantity
    cy = cubic_yards(sqft, thickness_ft)
    item.attributes["thickness_ft"] = thickness_ft
    item.attributes["thickness_source"] = thickness_source
    item.attributes["sqft"] = sqft
    item.quantity = round(cy, 2)
    item.unit = "CY"
    item.formula += f" ; CY = {sqft:.1f} SF × {thickness_ft:.3f} ft / 27 = {cy:.2f}"
    if thickness_source == "default":
        # A guessed thickness is exactly the kind of silent assumption we refuse.
        item.needs_review = True
        if ReviewReason.LOW_CONFIDENCE not in item.review_reason:
            item.review_reason.append(ReviewReason.LOW_CONFIDENCE)
        item.formula += " (thickness DEFAULTED — verify)"
    return item


def derive_flooring(item: QuantityItem, waste_factor: float) -> QuantityItem:
    """Apply waste factor to a flooring SF item (in place, auditable)."""
    base = item.quantity
    adjusted = apply_waste(base, waste_factor)
    item.attributes["base_sqft"] = base
    item.attributes["waste_factor"] = waste_factor
    item.quantity = round(adjusted, 1)
    item.formula += f" ; adjusted SF = {base:.1f} × waste {waste_factor:.2f} = {adjusted:.1f}"
    return item


def count_symbols(
    *,
    project_id: str,
    sheet: Sheet,
    detections: list[DetectedObject],
    label: str,
    scale: ScaleCalibration,
    min_confidence: float = 0.3,
) -> QuantityItem | None:
    """door/window symbol count, grouped by schedule mark when matched."""
    matched = [d for d in detections if d.label == label and d.confidence >= min_confidence]
    if not matched:
        return None
    avg_conf = sum(d.confidence for d in matched) / len(matched)
    item = QuantityItem(
        project_id=project_id,
        sheet_id=sheet.id,
        page_number=sheet.page_number,
        item_type=label,
        description=f"{label.title()}s (symbol count)",
        quantity=float(len(matched)),
        unit="EA",
        formula=f"EA = count of accepted {label} symbols = {len(matched)}",
        source_geometry_ids=[d.id for d in matched],
        source_ocr_span_ids=[s for d in matched for s in d.matched_ocr_span_ids],
        scale_id=scale.id,
        scale_confidence=scale.confidence,
        measurement_confidence=1.0,  # counting is exact once detections are accepted
        model_confidence=avg_conf,
        confidence=ConfidenceBundle(detector=avg_conf, scale=1.0),  # counts don't need scale
        overlay_style=STYLES.get(label, OverlayStyle()),
        attributes={"marks": sorted({d.schedule_ref for d in matched if d.schedule_ref})},
    )
    return item
