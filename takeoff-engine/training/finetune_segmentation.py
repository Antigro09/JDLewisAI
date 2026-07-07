"""Fine-tune a SegFormer semantic segmenter for room/slab regions — PRIORITY 2.

Why this and not "fine-tune SAM 2": SAM 2 is a promptable segmenter and works
reasonably from good boxes off-the-shelf, so it is NOT the first thing to train.
A dedicated region segmenter earns its keep once you have corrected polygons,
because it can produce clean room/slab boundaries WITHOUT depending on the
detector's boxes being perfect — and its masks feed the same deterministic
geometry engine. SegFormer (Apache-2.0, transformers) is a lighter, more
reproducible choice than Mask2Former for a first pass.

Data: image/mask pairs produced by
    python training/export_corrections_to_coco.py --out data/training --segmentation
which writes data/training/segmentation/{images,masks}/*.png with a classes.json
(background, room, slab). Masks are single-channel PNGs of class indices.

Install:  pip install torch transformers pillow numpy
Run:      python training/finetune_segmentation.py \
              --data-dir data/training/segmentation \
              --output-dir checkpoints/segformer-rooms --epochs 40

GPU recommended. Deploy the exported model behind a SAM-2-style mask endpoint,
or add a SegmenterAdapter variant that runs it and hands polygons to the
GeometryEngine exactly like SAM2Adapter does.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def build_dataset(data_dir: Path):
    import torch
    from PIL import Image

    images = sorted((data_dir / "images").glob("*.png"))
    if not images:
        raise SystemExit(f"no images under {data_dir / 'images'} — run the exporter with --segmentation")

    class SegDataset(torch.utils.data.Dataset):
        def __init__(self, files, processor, train: bool):
            self.files = files
            self.processor = processor
            self.train = train

        def __len__(self):
            return len(self.files)

        def __getitem__(self, i):
            img_path = self.files[i]
            mask_path = data_dir / "masks" / img_path.name
            image = Image.open(img_path).convert("RGB")
            mask = Image.open(mask_path)
            # Downscale long side to 1024 to keep memory sane on large sheets.
            if max(image.size) > 1024:
                scale = 1024 / max(image.size)
                new = (round(image.width * scale), round(image.height * scale))
                image = image.resize(new)
                mask = mask.resize(new, Image.NEAREST)
            enc = self.processor(image, mask, return_tensors="pt")
            return {k: v.squeeze(0) for k, v in enc.items()}

    return SegDataset, images


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data-dir", type=Path, default=Path("data/training/segmentation"))
    ap.add_argument("--output-dir", type=Path, default=Path("checkpoints/segformer-rooms"))
    ap.add_argument("--base-model", default="nvidia/segformer-b0-finetuned-ade-512-512")
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--batch-size", type=int, default=2)
    ap.add_argument("--lr", type=float, default=6e-5)
    args = ap.parse_args()

    try:
        import torch
        from transformers import (
            SegformerForSemanticSegmentation,
            SegformerImageProcessor,
            Trainer,
            TrainingArguments,
        )
    except ImportError as e:
        raise SystemExit("Install: pip install torch transformers") from e

    classes = json.loads((args.data_dir / "classes.json").read_text())
    id2label = {i: c for i, c in enumerate(classes)}
    label2id = {c: i for i, c in enumerate(classes)}
    print(f"classes: {classes}")

    processor = SegformerImageProcessor(do_reduce_labels=False)
    SegDataset, files = build_dataset(args.data_dir)

    # Deterministic 80/20 split by filename hash (stable across runs).
    import hashlib

    def is_val(p: Path) -> bool:
        return int(hashlib.sha1(p.name.encode()).hexdigest(), 16) % 5 == 0

    train_files = [f for f in files if not is_val(f)]
    val_files = [f for f in files if is_val(f)]
    print(f"train={len(train_files)} val={len(val_files)}")
    if len(train_files) < 10:
        print("WARNING: <10 training masks — this is a smoke run, not a production segmenter.")

    train_ds = SegDataset(train_files, processor, train=True)
    val_ds = SegDataset(val_files, processor, train=False)

    model = SegformerForSemanticSegmentation.from_pretrained(
        args.base_model,
        num_labels=len(classes),
        id2label=id2label,
        label2id=label2id,
        ignore_mismatched_sizes=True,  # replaces the ADE20K head with ours
    )

    def collate(batch):
        return {
            "pixel_values": torch.stack([b["pixel_values"] for b in batch]),
            "labels": torch.stack([b["labels"] for b in batch]),
        }

    targs = TrainingArguments(
        output_dir=str(args.output_dir),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        learning_rate=args.lr,
        eval_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=2,
        logging_steps=10,
        remove_unused_columns=False,
        report_to=[],
    )
    trainer = Trainer(
        model=model,
        args=targs,
        train_dataset=train_ds,
        eval_dataset=val_ds if val_files else None,
        data_collator=collate,
    )
    trainer.train()
    trainer.save_model(str(args.output_dir))
    processor.save_pretrained(str(args.output_dir))
    print(f"\nDone → {args.output_dir.resolve()}")
    print("Wrap it in a SegmenterAdapter that returns polygons (via "
          "app.geometry.raster.mask_to_polygons) so the deterministic GeometryEngine "
          "still produces every measured number.")


if __name__ == "__main__":
    main()
