"""Turn the review-UI corrections log into labeled training data.

This is the loop-closer for the whole system: every quantity an estimator
ACCEPTS or EDITS in the review UI becomes a human-verified label on a real
rendered sheet. Run this periodically to grow the detector/segmenter datasets
from production use — no separate annotation pass required for the trades the
system already measures (slab, room, door, window).

Outputs (under --out):
  detection/                      COCO object-detection dataset
    train/ valid/                 images + _annotations.coco.json each
    classes.json                  ordered class list (source of truth for ids)
  segmentation/                   semantic-segmentation dataset (optional)
    images/  masks/  classes.json

What becomes a label:
  - review_status == accepted  → the machine geometry is correct as-is.
  - review_status == edited     → use the human-corrected geometry if present,
                                  else the machine geometry (the human kept it
                                  but changed the number, so the shape stands).
  - review_status == rejected   → skipped (a rejected shape is a bad label;
                                  we log the count so the drop is visible).

Coordinates: artifacts are stored in PAGE POINTS. We convert to pixels at the
sheet's render DPI (px = pt * dpi / 72) so labels line up with the PNG the
detector will actually see.

Run inside the takeoff-engine venv (needs the app package + its DB/storage):
    python training/export_corrections_to_coco.py --out data/training \
        --database-url "$TAKEOFF_DATABASE_URL" --segmentation
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from collections import defaultdict
from pathlib import Path

from sqlalchemy import select

from app.adapters.detector_rfdetr import CONSTRUCTION_CLASSES
from app.config import get_settings
from app.db.database import get_engine, session_scope
from app.db.orm import ArtifactRow, QuantityRow, SheetRow
from app.storage.local import LocalStorage

# QuantityItem.item_type → detector class name (must exist in CONSTRUCTION_CLASSES).
ITEM_TYPE_TO_CLASS = {
    "concrete_slab": "slab",
    "flooring": "room",
    "door": "door",
    "window": "window",
}

# Only these review states yield a usable label.
LABELLED_STATES = {"accepted", "edited"}


def _val_split(sheet_id: str, val_every: int = 5) -> bool:
    """Deterministic ~20% validation split, stable across re-runs."""
    h = int(hashlib.sha1(sheet_id.encode()).hexdigest(), 16)
    return h % val_every == 0


def _polygon_from_geometry(data: dict) -> list[list[float]] | None:
    """A geometry artifact's exterior ring (page points), or None if not a polygon."""
    if data.get("kind") != "polygon":
        return None
    ring = data.get("exterior") or []
    return ring if len(ring) >= 3 else None


def _bbox_from_ring(ring: list[list[float]]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


def collect(session) -> dict[str, dict]:
    """Group human-verified labels by sheet.

    Returns {sheet_id: {"raster": raster_data, "sheet": sheet_data,
                        "labels": [{class_name, ring_pt}]}}.
    """
    # Index artifacts once.
    geoms: dict[str, dict] = {}
    dets: dict[str, dict] = {}
    rasters: dict[str, dict] = {}  # sheet_id -> raster_page data (highest dpi wins)
    for art in session.execute(select(ArtifactRow)).scalars():
        if art.kind == "geometry":
            geoms[art.id] = art.data
        elif art.kind == "detection":
            dets[art.id] = art.data
        elif art.kind == "raster_page":
            cur = rasters.get(art.sheet_id)
            if cur is None or art.data.get("dpi", 0) > cur.get("dpi", 0):
                rasters[art.sheet_id] = art.data

    sheets = {s.id: s.data | {"id": s.id} for s in session.execute(select(SheetRow)).scalars()}

    out: dict[str, dict] = defaultdict(lambda: {"raster": None, "sheet": None, "labels": []})
    skipped_rejected = 0
    skipped_no_geom = 0

    for q in session.execute(select(QuantityRow)).scalars():
        if q.review_status not in LABELLED_STATES:
            if q.review_status == "rejected":
                skipped_rejected += 1
            continue
        class_name = ITEM_TYPE_TO_CLASS.get(q.item_type)
        if class_name is None:
            continue  # only trades that map to a detector class

        data = q.data or {}
        # Prefer a human-corrected boundary when the estimator edited the shape.
        ring = None
        corrected = (data.get("attributes") or {}).get("corrected_geometry")
        if corrected and len(corrected) >= 3:
            ring = [list(p) for p in corrected]
        else:
            for gid in data.get("source_geometry_ids", []):
                if gid in geoms:
                    r = _polygon_from_geometry(geoms[gid])
                    if r:
                        ring = r
                        break
                elif gid in dets:  # box-only detection → rectangle ring
                    b = dets[gid].get("bbox")
                    if b:
                        ring = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]]
                        break
        if ring is None:
            skipped_no_geom += 1
            continue

        raster = rasters.get(q.sheet_id)
        if raster is None:
            skipped_no_geom += 1
            continue
        entry = out[q.sheet_id]
        entry["raster"] = raster
        entry["sheet"] = sheets.get(q.sheet_id)
        entry["labels"].append({"class_name": class_name, "ring_pt": ring})

    print(f"  sheets with labels : {len(out)}")
    print(f"  rejected (skipped)  : {skipped_rejected}")
    print(f"  no-geometry skipped : {skipped_no_geom}")
    return out


def build_detection_coco(by_sheet: dict[str, dict], storage: LocalStorage, out: Path) -> None:
    det_root = out / "detection"
    for split in ("train", "valid"):
        (det_root / split).mkdir(parents=True, exist_ok=True)

    # Category ids are 1-based COCO ids, ordered by CONSTRUCTION_CLASSES so the
    # trained model's 0-based class_id == CONSTRUCTION_CLASSES.index(name).
    categories = [
        {"id": i + 1, "name": name, "supercategory": "construction"}
        for i, name in enumerate(CONSTRUCTION_CLASSES)
    ]
    cat_id = {name: i + 1 for i, name in enumerate(CONSTRUCTION_CLASSES)}

    coco = {
        "train": {"images": [], "annotations": [], "categories": categories},
        "valid": {"images": [], "annotations": [], "categories": categories},
    }
    img_id = {"train": 0, "valid": 0}
    ann_id = {"train": 0, "valid": 0}

    for sheet_id, entry in by_sheet.items():
        raster = entry["raster"]
        dpi = float(raster.get("dpi", 150))
        px_per_pt = dpi / 72.0
        src = storage.open_path(raster["image_path"])
        if not src.exists():
            print(f"  ! missing render for sheet {sheet_id}: {raster['image_path']}")
            continue
        split = "valid" if _val_split(sheet_id) else "train"
        file_name = f"{sheet_id}.png"
        shutil.copy(src, det_root / split / file_name)

        iid = img_id[split]
        img_id[split] += 1
        coco[split]["images"].append({
            "id": iid,
            "file_name": file_name,
            "width": raster.get("width_px", 0),
            "height": raster.get("height_px", 0),
        })
        for label in entry["labels"]:
            ring_px = [[x * px_per_pt, y * px_per_pt] for x, y in label["ring_pt"]]
            x0, y0, x1, y1 = _bbox_from_ring(ring_px)
            seg = [c for p in ring_px for c in p]
            coco[split]["annotations"].append({
                "id": ann_id[split],
                "image_id": iid,
                "category_id": cat_id[label["class_name"]],
                "bbox": [x0, y0, x1 - x0, y1 - y0],
                "area": (x1 - x0) * (y1 - y0),
                "segmentation": [seg],
                "iscrowd": 0,
            })
            ann_id[split] += 1

    for split in ("train", "valid"):
        with open(det_root / split / "_annotations.coco.json", "w") as f:
            json.dump(coco[split], f)
        print(f"  detection/{split}: {len(coco[split]['images'])} images, "
              f"{len(coco[split]['annotations'])} boxes")
    with open(det_root / "classes.json", "w") as f:
        json.dump(CONSTRUCTION_CLASSES, f, indent=2)


def build_segmentation(by_sheet: dict[str, dict], storage: LocalStorage, out: Path) -> None:
    """Semantic-seg dataset: per-pixel class-index PNGs. Classes: background(0),
    room(1), slab(2). (Doors/windows are counted, not segmented.)"""
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        print("  ! segmentation export needs pillow; skipping")
        return

    seg_classes = ["background", "room", "slab"]
    seg_idx = {"room": 1, "slab": 2}
    seg_root = out / "segmentation"
    (seg_root / "images").mkdir(parents=True, exist_ok=True)
    (seg_root / "masks").mkdir(parents=True, exist_ok=True)

    n = 0
    for sheet_id, entry in by_sheet.items():
        raster = entry["raster"]
        labels = [lb for lb in entry["labels"] if lb["class_name"] in seg_idx]
        if not labels:
            continue
        src = storage.open_path(raster["image_path"])
        if not src.exists():
            continue
        px_per_pt = float(raster.get("dpi", 150)) / 72.0
        w, h = raster.get("width_px", 0), raster.get("height_px", 0)
        if not (w and h):
            with Image.open(src) as im:
                w, h = im.size
        mask = Image.new("L", (w, h), 0)
        drawer = ImageDraw.Draw(mask)
        # Paint slabs first, rooms on top (rooms sit inside slabs).
        for cls in ("slab", "room"):
            for label in labels:
                if label["class_name"] != cls:
                    continue
                poly = [(x * px_per_pt, y * px_per_pt) for x, y in label["ring_pt"]]
                if len(poly) >= 3:
                    drawer.polygon(poly, fill=seg_idx[cls])
        shutil.copy(src, seg_root / "images" / f"{sheet_id}.png")
        mask.save(seg_root / "masks" / f"{sheet_id}.png")
        n += 1

    with open(seg_root / "classes.json", "w") as f:
        json.dump(seg_classes, f, indent=2)
    print(f"  segmentation: {n} image/mask pairs, classes={seg_classes}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="data/training", type=Path)
    ap.add_argument("--database-url", default=None, help="overrides TAKEOFF_DATABASE_URL")
    ap.add_argument("--segmentation", action="store_true", help="also emit a seg dataset")
    args = ap.parse_args()

    settings = get_settings()
    if args.database_url:
        get_engine(args.database_url)
    storage = LocalStorage(settings.storage_root)

    print("Collecting human-verified labels from the corrections log...")
    with session_scope() as session:
        by_sheet = collect(session)
    if not by_sheet:
        print("No accepted/edited quantities with geometry found. Nothing to export.")
        print("Use the review UI to accept/correct quantities first, then re-run.")
        return

    args.out.mkdir(parents=True, exist_ok=True)
    print("Writing detection COCO dataset...")
    build_detection_coco(by_sheet, storage, args.out)
    if args.segmentation:
        print("Writing segmentation dataset...")
        build_segmentation(by_sheet, storage, args.out)
    print(f"\nDone → {args.out.resolve()}")
    print("Next: python training/finetune_rfdetr.py --dataset-dir "
          f"{args.out / 'detection'}")


if __name__ == "__main__":
    main()
