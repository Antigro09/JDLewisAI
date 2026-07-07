"""Fine-tune RF-DETR on construction drawings — PRIORITY 1.

Off-the-shelf RF-DETR ships COCO classes (person, car, ...) that are useless on
blueprints. This is the single highest-impact model to fine-tune: it turns the
detector from "finds nothing relevant" into "finds slabs, rooms, doors, windows,
tags, dimensions" — the candidates every downstream measurement depends on.

Data: a COCO detection dataset in the RF-DETR layout
    <dataset-dir>/
        train/  _annotations.coco.json + images
        valid/  _annotations.coco.json + images
        test/   (optional)
Produce it from the review-UI corrections log with
    python training/export_corrections_to_coco.py --out data/training
which writes exactly this layout under data/training/detection/, or annotate a
seed set in Label Studio / CVAT / Roboflow and export as "COCO".

Install:  pip install -e ".[detect]"   (rfdetr + torch), plus  pip install supervision
Run:      python training/finetune_rfdetr.py --dataset-dir data/training/detection \
              --epochs 60 --batch-size 4 --output-dir checkpoints/rfdetr-construction

GPU strongly recommended. On CPU this is only viable for a tiny smoke run.

SageMaker: package this file as the entry point of a PyTorch training job
(instance e.g. ml.g5.xlarge); pass the S3 dataset via the SM_CHANNEL_TRAIN env
var and set --output-dir to SM_MODEL_DIR so the checkpoint is uploaded. Then
deploy the checkpoint to the endpoint named in TAKEOFF_DETECTOR_SAGEMAKER_ENDPOINT.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


def validate_dataset(dataset_dir: Path) -> list[str]:
    """Sanity-check the COCO layout and return the ordered class names."""
    train_ann = dataset_dir / "train" / "_annotations.coco.json"
    valid_ann = dataset_dir / "valid" / "_annotations.coco.json"
    if not train_ann.exists():
        raise SystemExit(f"missing {train_ann} — build the dataset first (see module docstring)")
    if not valid_ann.exists():
        raise SystemExit(f"missing {valid_ann} — RF-DETR needs a valid/ split")
    with open(train_ann) as f:
        coco = json.load(f)
    n_img = len(coco.get("images", []))
    n_ann = len(coco.get("annotations", []))
    classes = [c["name"] for c in sorted(coco.get("categories", []), key=lambda c: c["id"])]
    print(f"train: {n_img} images, {n_ann} annotations, {len(classes)} classes: {classes}")
    if n_img < 20:
        print("WARNING: <20 training images. Expect poor generalization; this is a smoke run, "
              "not a production model. Aim for a few hundred labeled sheets across firms/scales.")
    if n_ann == 0:
        raise SystemExit("no annotations — nothing to learn from")
    return classes


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dataset-dir", type=Path,
                    default=Path(os.environ.get("SM_CHANNEL_TRAIN", "data/training/detection")))
    ap.add_argument("--output-dir", type=Path,
                    default=Path(os.environ.get("SM_MODEL_DIR", "checkpoints/rfdetr-construction")))
    ap.add_argument("--model", choices=["base", "large"], default="base")
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--batch-size", type=int, default=4)
    ap.add_argument("--grad-accum", type=int, default=4, help="effective batch = batch-size * this")
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--resume", type=str, default="", help="checkpoint to resume/warm-start from")
    ap.add_argument("--export-onnx", action="store_true", help="export ONNX after training")
    args = ap.parse_args()

    classes = validate_dataset(args.dataset_dir)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    try:
        from rfdetr import RFDETRBase, RFDETRLarge
    except ImportError as e:
        raise SystemExit("RF-DETR not installed. Run: pip install -e '.[detect]'") from e

    ModelCls = RFDETRLarge if args.model == "large" else RFDETRBase
    model = ModelCls(pretrain_weights=args.resume) if args.resume else ModelCls()

    print(f"Fine-tuning RF-DETR-{args.model} for {args.epochs} epochs "
          f"(effective batch {args.batch_size * args.grad_accum})...")
    model.train(
        dataset_dir=str(args.dataset_dir),
        epochs=args.epochs,
        batch_size=args.batch_size,
        grad_accum_steps=args.grad_accum,
        lr=args.lr,
        output_dir=str(args.output_dir),
    )

    # Persist the class order alongside the checkpoint so inference doesn't rely
    # on the hardcoded CONSTRUCTION_CLASSES drifting out of sync with the data.
    with open(args.output_dir / "classes.json", "w") as f:
        json.dump(classes, f, indent=2)

    if args.export_onnx:
        print("Exporting ONNX...")
        model.export(output_dir=str(args.output_dir))

    print(f"\nDone → {args.output_dir.resolve()}")
    print("Plug in with:")
    print("  TAKEOFF_DETECTOR_TRANSPORT=local")
    print(f"  RF-DETR checkpoint = {args.output_dir}/  (pass to RFDETRAdapter checkpoint=...)")
    print("or deploy to a SageMaker endpoint and set TAKEOFF_DETECTOR_TRANSPORT=sagemaker.")
    print("\nEvaluate BEFORE promoting: run docs/evaluation.md's benchmark and gate on "
          "per-class precision/recall, not training loss.")


if __name__ == "__main__":
    main()
