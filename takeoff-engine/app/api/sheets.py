from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.database import get_session
from app.db.orm import ArtifactRow, QuantityRow, SheetRow
from app.storage.local import LocalStorage

router = APIRouter(prefix="/api", tags=["sheets"])


@router.get("/projects/{project_id}/sheets")
def list_sheets(project_id: str, db: Session = Depends(get_session)):
    rows = (
        db.query(SheetRow).filter_by(project_id=project_id).order_by(SheetRow.page_number).all()
    )
    return [r.data | {"id": r.id} for r in rows]


@router.get("/sheets/{sheet_id}/image")
def sheet_image(sheet_id: str, db: Session = Depends(get_session)):
    raster = (
        db.query(ArtifactRow).filter_by(sheet_id=sheet_id, kind="raster_page").first()
    )
    if not raster:
        raise HTTPException(404, "no render for sheet")
    storage = LocalStorage(get_settings().storage_root)
    path = storage.open_path(raster.data["image_path"])
    if not path.exists():
        raise HTTPException(410, "render file missing")
    return FileResponse(path, media_type="image/png")


@router.get("/sheets/{sheet_id}/overlay")
def sheet_overlay(sheet_id: str, db: Session = Depends(get_session)):
    """Overlay payload for the review UI: page size + one feature per
    quantity with its polygon(s)/boxes in page points and display style."""
    sheet = db.get(SheetRow, sheet_id)
    if not sheet:
        raise HTTPException(404, "sheet not found")
    geoms = {
        a.id: a.data
        for a in db.query(ArtifactRow).filter_by(sheet_id=sheet_id, kind="geometry").all()
    }
    dets = {
        a.id: a.data
        for a in db.query(ArtifactRow).filter_by(sheet_id=sheet_id, kind="detection").all()
    }
    scale = db.query(ArtifactRow).filter_by(sheet_id=sheet_id, kind="scale").first()

    features = []
    for q in db.query(QuantityRow).filter_by(sheet_id=sheet_id).all():
        data = q.data
        polygons, boxes = [], []
        for gid in data.get("source_geometry_ids", []):
            if gid in geoms:
                polygons.append(geoms[gid]["exterior"])
            elif gid in dets:
                boxes.append(dets[gid]["bbox"])
        features.append({
            "quantity_id": q.id,
            "item_type": q.item_type,
            "description": data.get("description", ""),
            "quantity": q.quantity,
            "unit": q.unit,
            "formula": data.get("formula", ""),
            "needs_review": q.needs_review,
            "review_status": q.review_status,
            "review_reason": data.get("review_reason", []),
            "final_confidence": data.get("final_confidence", 0),
            "style": data.get("overlay_style", {}),
            "polygons": polygons,
            "boxes": boxes,
        })
    return {
        "sheet_id": sheet_id,
        "width_pt": sheet.data.get("width_pt"),
        "height_pt": sheet.data.get("height_pt"),
        "scale": scale.data if scale else None,
        "features": features,
    }
