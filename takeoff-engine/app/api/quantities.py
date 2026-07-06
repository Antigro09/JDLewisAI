from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.database import get_session
from app.db.orm import QuantityRow

router = APIRouter(prefix="/api", tags=["quantities"])


@router.get("/projects/{project_id}/quantities")
def list_quantities(
    project_id: str,
    needs_review: bool | None = Query(None),
    item_type: str | None = Query(None),
    db: Session = Depends(get_session),
):
    q = db.query(QuantityRow).filter_by(project_id=project_id)
    if needs_review is not None:
        q = q.filter_by(needs_review=needs_review)
    if item_type:
        q = q.filter_by(item_type=item_type)
    return [r.data | {"id": r.id, "review_status": r.review_status} for r in q.all()]


@router.get("/quantities/{quantity_id}")
def get_quantity(quantity_id: str, db: Session = Depends(get_session)):
    r = db.get(QuantityRow, quantity_id)
    if not r:
        raise HTTPException(404, "quantity not found")
    return r.data | {"id": r.id, "review_status": r.review_status}
