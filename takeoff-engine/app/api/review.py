"""Review endpoints — accept/edit/reject, and the corrections log.

Every decision snapshots the machine output before applying the change, so
the review_decisions table doubles as labeled training data
(machine output + human correction)."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.database import get_session
from app.db.orm import QuantityRow, ReviewDecisionRow
from app.schemas.core import new_id
from app.schemas.review import ReviewAction

router = APIRouter(prefix="/api", tags=["review"])


class ReviewRequest(BaseModel):
    action: ReviewAction
    reviewer: str = "anonymous"
    corrected_quantity: float | None = None
    corrected_unit: str | None = None
    corrected_description: str | None = None
    corrected_geometry: list[tuple[float, float]] | None = None
    comment: str = ""


def _review_decisions_for_project(project_id: str, db: Session) -> list[dict]:
    """Load corrections without hydrating `created_at`.

    Older local SQLite databases can contain an empty string in the DateTime
    column, which makes SQLAlchemy raise before the endpoint can return. The
    corrections log is still useful, so load only the safe columns and treat the
    timestamp as optional for those legacy rows.
    """
    rows = db.execute(
        select(
            ReviewDecisionRow.id,
            ReviewDecisionRow.quantity_item_id,
            ReviewDecisionRow.action,
            ReviewDecisionRow.data,
        ).where(ReviewDecisionRow.project_id == project_id)
    ).all()
    corrections = []
    for row in rows:
        data = row.data or {}
        corrections.append(
            {
                "id": row.id,
                "quantity_item_id": row.quantity_item_id,
                "action": row.action,
            } | data | {"created_at": data.get("created_at") or None}
        )
    return corrections


@router.post("/quantities/{quantity_id}/review")
def review_quantity(quantity_id: str, body: ReviewRequest, db: Session = Depends(get_session)):
    row = db.get(QuantityRow, quantity_id)
    if not row:
        raise HTTPException(404, "quantity not found")

    created_at = datetime.now(UTC)
    decision = ReviewDecisionRow(
        id=new_id(),
        quantity_item_id=quantity_id,
        project_id=row.project_id,
        action=body.action.value,
        created_at=created_at,
        data={
            "created_at": created_at.isoformat(),
            "reviewer": body.reviewer,
            "comment": body.comment,
            "corrected_quantity": body.corrected_quantity,
            "corrected_unit": body.corrected_unit,
            "corrected_description": body.corrected_description,
            "corrected_geometry": body.corrected_geometry,
            "machine_snapshot": row.data,  # pre-correction state → training data
        },
    )
    db.add(decision)

    data = dict(row.data)
    if body.action == ReviewAction.ACCEPT:
        row.review_status = "accepted"
        row.needs_review = False
    elif body.action == ReviewAction.REJECT:
        row.review_status = "rejected"
        row.needs_review = False
    else:  # EDIT
        if body.corrected_quantity is None:
            raise HTTPException(422, "edit requires corrected_quantity")
        row.review_status = "edited"
        row.needs_review = False
        row.quantity = body.corrected_quantity
        data["quantity"] = body.corrected_quantity
        data["formula"] += f" ; EDITED by {body.reviewer}: {body.corrected_quantity}"
        if body.corrected_unit:
            row.unit = body.corrected_unit
            data["unit"] = body.corrected_unit
        if body.corrected_description:
            data["description"] = body.corrected_description
    data["review_status"] = row.review_status
    data["needs_review"] = row.needs_review
    row.data = data
    return {"decision_id": decision.id, "review_status": row.review_status}


@router.get("/projects/{project_id}/corrections")
def list_corrections(project_id: str, db: Session = Depends(get_session)):
    """The corrections log — export this as fine-tuning/eval data."""
    return _review_decisions_for_project(project_id, db)
