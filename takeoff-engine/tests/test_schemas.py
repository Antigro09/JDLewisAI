import json

import pytest
from pydantic import ValidationError

from app.schemas import (
    OCRSpan,
    Project,
    QuantityItem,
    ReviewReason,
    ScaleCalibration,
    ScaleSource,
    Sheet,
)
from app.schemas.review import ReviewAction, ReviewDecision

REQUIRED_QUANTITY_FIELDS = {
    "id", "project_id", "sheet_id", "page_number", "item_type", "description",
    "quantity", "unit", "formula", "csi_code", "source_geometry_ids",
    "source_ocr_span_ids", "scale_id", "scale_confidence", "measurement_confidence",
    "model_confidence", "needs_review", "review_reason", "overlay_style", "created_at",
}


def make_item(**kw) -> QuantityItem:
    defaults = dict(
        project_id="p1", sheet_id="s1", page_number=1, item_type="concrete_slab",
        description="Slab", quantity=14.81, unit="CY",
        formula="CY = 1200.0 SF × 0.333 ft / 27",
    )
    defaults.update(kw)
    return QuantityItem(**defaults)


class TestQuantityItem:
    def test_has_all_spec_fields(self):
        dumped = make_item().model_dump()
        missing = REQUIRED_QUANTITY_FIELDS - set(dumped)
        assert not missing, f"QuantityItem missing spec fields: {missing}"

    def test_json_round_trip(self):
        item = make_item(
            source_geometry_ids=["g1"], source_ocr_span_ids=["o1"], scale_id="sc1",
            review_reason=[ReviewReason.LOW_CONFIDENCE], needs_review=True,
        )
        raw = item.model_dump_json()
        restored = QuantityItem.model_validate_json(raw)
        assert restored == item
        # and it is plain JSON, loadable by anything
        assert json.loads(raw)["formula"].startswith("CY =")

    def test_rejects_missing_required(self):
        with pytest.raises(ValidationError):
            QuantityItem(project_id="p1")  # type: ignore[call-arg]

    def test_rejects_bad_types(self):
        with pytest.raises(ValidationError):
            make_item(quantity="a lot")


class TestOtherSchemas:
    def test_project_defaults(self):
        p = Project(name="Test")
        assert p.id and p.status == "created" and p.created_at is not None

    def test_sheet_round_trip(self):
        s = Sheet(project_id="p1", source_file="f.pdf", page_number=2, width_pt=792)
        assert Sheet.model_validate_json(s.model_dump_json()) == s

    def test_scale_usability(self):
        assert not ScaleCalibration(sheet_id="s", source=ScaleSource.NTS).usable
        assert ScaleCalibration(sheet_id="s", source=ScaleSource.MANUAL, ft_per_pt=0.1).usable

    def test_ocr_span_requires_bbox(self):
        with pytest.raises(ValidationError):
            OCRSpan(sheet_id="s", text="hi")  # type: ignore[call-arg]

    def test_review_decision_snapshot(self):
        d = ReviewDecision(
            quantity_item_id="q1", project_id="p1", sheet_id="s1",
            action=ReviewAction.EDIT, corrected_quantity=15.0,
            machine_snapshot={"quantity": 14.81},
        )
        restored = ReviewDecision.model_validate_json(d.model_dump_json())
        assert restored.machine_snapshot["quantity"] == 14.81
