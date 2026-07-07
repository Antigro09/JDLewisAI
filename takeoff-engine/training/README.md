# Fine-tuning the takeoff engine

**Short answer: yes, you must fine-tune — but only the vision models, and not
on day one.** The engine runs end to end today in mock mode (deterministic
OpenCV heuristics) and with off-the-shelf models, but neither produces
production-grade takeoffs on real drawings. Generic detectors have never seen a
door swing, slab hatch, or finish tag; RF-DETR literally ships COCO classes
(person, car, …). The measurement math, scale logic, geometry, and audit trail
are deterministic and need no training — only the *candidate-finding* models do.

## What to fine-tune, in order

| # | Model | Why | Do NOT |
|---|-------|-----|--------|
| 1 | **RF-DETR detector** | Highest impact. Without it the pipeline finds no real slabs/rooms/doors/windows/tags. This is the one that matters. | — |
| 2 | **Region segmenter (SegFormer/SAM2)** | Clean room/slab boundaries independent of box quality; feeds the same deterministic geometry engine. | Fine-tune only after you have corrected polygons. |
| 3 | **Sheet-type classifier** (optional, lightweight) | Beats keyword heuristics for routing sheets. | Skip until misclassification is actually costing you. |

**Do NOT fine-tune Qwen (VLM) or Llama (rollup LLM) first — or likely ever.**
They are audit/reasoning modules, not measurement sources. Exhaust prompt
engineering, RAG over OCR spans/schedules, deterministic rules, and human
corrections before considering LLM fine-tuning. See
[`../docs/fine-tuning-roadmap.md`](../docs/fine-tuning-roadmap.md).

## The data you need (and where it comes from)

You do **not** need a big annotation project to start. The review UI is the
labeling tool: every quantity an estimator **accepts** or **edits** is a
human-verified label on a real rendered sheet. Close the loop with:

```bash
# 1. Export human-verified labels from the corrections log → COCO (+ seg masks)
python training/export_corrections_to_coco.py --out data/training --segmentation
```

This reads the engine's own Postgres DB and writes a ready-to-train dataset.
Rejected quantities are dropped (and counted, so the loss is visible). For
classes the system doesn't yet measure (walls, dimensions, schedule refs),
seed a few hundred sheets in Label Studio / CVAT / Roboflow exported as COCO
and merge them in.

Rough volumes: a usable v0 detector wants a few hundred labeled sheets spanning
multiple firms, disciplines, and scan qualities; production wants low
thousands. Hold a benchmark set completely out of training (hash-block it) and
gate promotions on it — never on training loss.

## Train

```bash
pip install -r training/requirements-train.txt          # on a GPU box

# 1 — detector (priority)
python training/finetune_rfdetr.py \
    --dataset-dir data/training/detection \
    --epochs 60 --batch-size 4 \
    --output-dir checkpoints/rfdetr-construction --export-onnx

# 2 — segmenter
python training/finetune_segmentation.py \
    --data-dir data/training/segmentation \
    --output-dir checkpoints/segformer-rooms --epochs 40

# 3 — sheet classifier (optional, CPU, seconds)
python training/train_sheet_classifier.py \
    --output checkpoints/sheet_classifier.joblib
```

## Deploy the fine-tuned models

- **Local:** `TAKEOFF_DETECTOR_TRANSPORT=local` and point `RFDETRAdapter(checkpoint=...)`
  at your checkpoint (same for the segmenter via a SegFormer-backed adapter).
- **SageMaker (primary path):** package each `finetune_*.py` as a training-job
  entry point (dataset via `SM_CHANNEL_TRAIN`, checkpoint to `SM_MODEL_DIR`),
  deploy the artifact to an endpoint, and set
  `TAKEOFF_DETECTOR_TRANSPORT=sagemaker` +
  `TAKEOFF_DETECTOR_SAGEMAKER_ENDPOINT=<name>`. Payload contracts are in
  [`../docs/adapters.md`](../docs/adapters.md).

The class order is written to `classes.json` beside every detector checkpoint —
load it at inference instead of relying on the hardcoded `CONSTRUCTION_CLASSES`,
so the model's class ids can't drift out of sync with the data.

## Evaluate before promoting

Run the benchmark in [`../docs/evaluation.md`](../docs/evaluation.md): area
error %, count precision/recall, scale accuracy, % needing review. A new model
ships only if it beats the current one on the held-out set. Then it re-enters
the loop: production → corrections → export → retrain → evaluate → deploy.
