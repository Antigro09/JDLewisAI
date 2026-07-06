"""Manual two-click scale calibration (ranked source #5)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.database import get_session
from app.db.orm import ArtifactRow, SheetRow
from app.pipeline.scale_calibration import manual_calibration

router = APIRouter(prefix="/api", tags=["calibration"])


class CalibrateRequest(BaseModel):
    p1: tuple[float, float]      # page points
    p2: tuple[float, float]
    real_distance_ft: float


@router.post("/sheets/{sheet_id}/calibrate", status_code=201)
def calibrate(sheet_id: str, body: CalibrateRequest, db: Session = Depends(get_session)):
    if not db.get(SheetRow, sheet_id):
        raise HTTPException(404, "sheet not found")
    try:
        cal = manual_calibration(sheet_id, body.p1, body.p2, body.real_distance_ft)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    db.add(ArtifactRow(id=cal.id, sheet_id=sheet_id, kind="scale",
                       data=cal.model_dump(mode="json")))
    # Existing quantities keep their original scale ids; re-run processing (or
    # a future targeted re-measure endpoint) to apply the manual scale.
    return {"scale_id": cal.id, "ft_per_pt": cal.ft_per_pt, "source": cal.source.value,
            "note": "re-run /process to re-measure with the manual scale"}
