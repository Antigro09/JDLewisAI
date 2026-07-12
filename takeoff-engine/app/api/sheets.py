from __future__ import annotations

import math

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from shapely.geometry import Polygon
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.database import get_session
from app.db.orm import ArtifactRow, QuantityRow, SheetRow
from app.storage.local import LocalStorage

router = APIRouter(prefix="/api", tags=["sheets"])


def _wall_segment_guides(geom_data: dict, ft_per_pt: float | None) -> dict | None:
    """Centerline endpoints + length label for one wall geometry, so the UI
    can draw point-to-point measurement guidelines."""
    exterior = geom_data.get("exterior") or []
    if len(exterior) < 4:
        return None
    poly = Polygon(exterior)
    if not poly.is_valid or poly.is_empty:
        return None
    rect = poly.minimum_rotated_rectangle
    if not isinstance(rect, Polygon):
        return None
    coords = list(rect.exterior.coords)
    edges = [(coords[i], coords[i + 1], math.dist(coords[i], coords[i + 1])) for i in range(4)]
    (a, b, _long) = max(edges, key=lambda e: e[2])
    # midpoints of the two short edges = centerline endpoints
    (c, d, _short) = min(edges, key=lambda e: e[2])
    short_vec = ((d[0] - c[0]) / 2, (d[1] - c[1]) / 2)
    p1 = (a[0] + short_vec[0], a[1] + short_vec[1])
    p2 = (b[0] + short_vec[0], b[1] + short_vec[1])
    length_pt = geom_data.get("length_pt") or math.dist(p1, p2)
    if not ft_per_pt or ft_per_pt <= 0:
        return None
    return {
        "p1": [round(p1[0], 2), round(p1[1], 2)],
        "p2": [round(p2[0], 2), round(p2[1], 2)],
        "label": f"{length_pt * ft_per_pt:.2f} LF",
    }


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

    scale_data = scale.data if scale else None
    ft_per_pt = None
    if scale_data and scale_data.get("usable") and scale_data.get("ft_per_pt"):
        ft_per_pt = float(scale_data["ft_per_pt"])

    features = []
    for q in db.query(QuantityRow).filter_by(sheet_id=sheet_id).all():
        data = q.data
        polygons, holes, boxes, segments = [], [], [], []
        for gid in data.get("source_geometry_ids", []):
            if gid in geoms:
                polygons.append(geoms[gid]["exterior"])
                holes.append(geoms[gid].get("holes", []))
                if q.item_type == "wall":
                    guide = _wall_segment_guides(geoms[gid], ft_per_pt)
                    if guide is not None:
                        segments.append(guide)
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
            "holes": holes,
            "boxes": boxes,
            "segments": segments,
        })
    return {
        "sheet_id": sheet_id,
        "width_pt": sheet.data.get("width_pt"),
        "height_pt": sheet.data.get("height_pt"),
        "scale": scale_data,
        "features": features,
    }
