# Fine-tuning roadmap

Fine-tuning is **not required for the first prototype**. The mock/heuristic
pipeline plus off-the-shelf models (PaddleOCR, SAM 2, GroundingDINO) exercise
the full system. It **is required for production accuracy** — generic
detectors have never seen door swings, slab hatching, or finish tags.

## Targets, in priority order

### 1. RF-DETR detector (highest impact)

- **Classes** (`CONSTRUCTION_CLASSES` in `app/adapters/detector_rfdetr.py`):
  room, slab, wall, door, window, room_label, finish_tag, dimension, callout,
  scale_bar, north_arrow, schedule_ref, symbol.
- **Data**: COCO-format boxes at the render DPI used in production (consistent
  px/pt ratio matters). Two sources:
  1. **Corrections log** (`review_decisions` table): every accepted detection
     is a positive label; every rejected one a hard negative; edited geometry
     gives corrected boxes. Export via `GET /api/projects/{id}/corrections`.
  2. **Seed set**: annotate 200–500 sheets across firms/disciplines/scan
     quality in any COCO tool (Label Studio, CVAT).
- **Recipe**: the `rfdetr` package exposes `.train(dataset_dir=..., epochs=...)`;
  start from the pretrained base, 50–100 epochs, standard augmentation BUT no
  horizontal flips for text-bearing classes (dimensions/labels mirror-break).
- **Gate**: per-class precision/recall on the held-out benchmark
  (docs/evaluation.md), not training loss.

### 2. Segmentation for room/slab/floor regions

- Option A: keep SAM 2 and fine-tune its mask decoder on corrected polygons
  (cheap, prompt-based flow unchanged).
- Option B: train Mask2Former/SegFormer for prompt-free full-sheet region
  segmentation once ≥1–2k labeled regions exist; makes detection+segmentation
  one pass.
- **Data**: corrected polygons from the review UI (page points → raster masks
  at training DPI).

### 3. Sheet-type classifier + title-block extractor (lightweight)

- Replaces heuristics in `app/pipeline/sheet_classify.py`.
- Features: OCR bag-of-words + layout stats; a small ViT on thumbnails also
  works. Hundreds of labeled sheets suffice — labels fall out of the review
  workflow (users see and fix misclassified sheets).

## Explicitly NOT fine-tuned first: Qwen / Llama

Before any LLM fine-tune, exhaust in order:
1. **Prompt engineering** — the audit prompts are multiple-choice with
   evidence ids; tighten options and context.
2. **RAG over OCR spans and schedule tables** — give the model the right
   crops/rows instead of teaching it the domain.
3. **Deterministic rules** — every VLM question answered the same way twice
   by humans should become code.
4. **Human corrections** — fix the upstream detector/segmenter; most "VLM
   errors" are garbage-in.

Only if a measured, persistent reasoning gap remains after all four, consider
LoRA on the 8B VLM using the corrections log as preference data.

## Active-learning loop

```
production runs → flagged items → estimator corrections (review_decisions)
      → export labels → retrain detector/segmenter → eval vs benchmark
      → deploy behind the same SageMaker endpoint name → repeat
```

Retrain cadence: monthly, or per 1k new corrections, whichever comes first.
Never deploy a model that regresses the benchmark gate.
