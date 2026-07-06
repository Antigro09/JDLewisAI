# Takeoff Engine

Open-source-model construction material takeoff: blueprint **PDFs/TIFFs in → auditable quantities out**, with visual overlays, a human review loop, and Excel/JSON/CSV export.

Similar in spirit to commercial AI takeoff tools, but built entirely on open-source models and libraries, with one non-negotiable design rule:

> **Measurements never come from a language model.** The source of truth is vector extraction, coordinate OCR, segmentation masks, and deterministic geometry. VLMs are used only for reasoning, ambiguity resolution, scale interpretation, callout matching, and QA/auditing — and their outputs are structured decisions with evidence references, never numbers.

This system does **not** claim 100% accuracy. Every quantity carries a confidence bundle, a human-readable formula, and a full evidence chain; anything the pipeline could not fully justify is flagged `needs_review` instead of silently guessed.

---

## Architecture

```
[Upload PDF/TIFF]
      ↓
[Sheet ingestion]           PyMuPDF: pages, native text w/ coords, vector paths,
                            raster render at configurable DPI. TIFF via Pillow.
                            All coordinates normalized to PAGE POINTS (1/72 in,
                            top-left origin) — the shared coordinate system.
      ↓
[OCR/layout parsing]        PaddleOCR/PP-StructureV3 (coordinate-level spans +
                            tables). Native PDF text rides alongside at conf 1.0.
      ↓
[Sheet classification]      Deterministic: title-block sheet number prefix
                            (A-/S-/M-...) + keyword votes. VLM assist optional.
      ↓
[Scale calibration]         Ranked sources: pdf_metadata > scale_note >
                            graphic_bar > known_dimension > manual two-click.
                            NTS sheets → measurement REFUSED. Every quantity
                            records scale_source + scale_confidence.
      ↓
[Candidate detection]       RF-DETR (non-YOLO, Apache-2.0) boxes; GroundingDINO
                            optional open-vocab; SAM 2 masks from box prompts;
                            OpenCV + vector linework refine boundaries.
      ↓
[Deterministic measurement] Shapely polygons: closure validation, areas, lengths,
                            counts, CY. Implausible values rejected. This stage —
                            and only this stage — produces numbers.
      ↓
[VLM audit]                 Qwen3-VL answers multiple-choice ambiguity questions
                            (which scale? does label match polygon? is this mask
                            wrong?) with evidence ids. Adjusts confidence/flags only.
      ↓
[Estimator rollup]          Deterministic formulas (CY = SF × t/27, waste factors)
                            + builtin CSI table; Llama 3.3/Qwen text LLM only for
                            long-tail CSI mapping and descriptions.
      ↓
[Review UI]                 Overlays on the sheet; accept/edit/reject; every
                            correction stored with a machine snapshot = training data.
      ↓
[Export]                    Excel (Summary/Takeoff/Audit tabs), JSON with full
                            evidence chain, CSV.
```

MVP trades: **concrete slab (SF → CY)**, **flooring/room areas (SF + waste)**, **door/window counting** (secondary).

Everything is traceable: `QuantityItem → PolygonGeometry → SegmentationMask/DetectedObject → RasterPage/VectorPath/OCRSpan → Sheet → file`, all in page coordinates.

## Installation

```bash
cd takeoff-engine
pip install -e ".[dev]"     # core: FastAPI, PyMuPDF, OpenCV, Shapely, openpyxl
make test                   # 101 tests, no model downloads, no network
make run                    # http://localhost:8000  (docs at /docs, UI at /review)
```

The core install runs the **entire pipeline with mock adapters** (deterministic OpenCV heuristics stand in for the detector/segmenter) — useful for development, testing, and demos. Real models are optional extras:

| Extra | Installs | Enables |
|---|---|---|
| `.[ocr]` | paddleocr, paddlepaddle | local PaddleOCR |
| `.[detect]` | rfdetr, torch | local RF-DETR |
| `.[segment]` | sam2, torch | local SAM 2 |
| `.[vlm]` | openai client | Qwen/Llama via vLLM/TGI endpoints |
| `.[sagemaker]` | boto3 | SageMaker endpoints (primary hosted path) |
| `.[worker]` | rq, redis | distributed job queue |
| `.[pdf-fallback]` | pypdfium2, pdfplumber | AGPL-free PDF ingestion |

### Quickstart (end to end, mock mode)

```bash
make fixture                                     # generates fixture_plan.pdf
curl -sX POST localhost:8000/api/projects -H 'content-type: application/json' \
     -d '{"name":"Demo"}'                         # → {"id": "<PROJECT>"}
curl -sX POST localhost:8000/api/projects/<PROJECT>/files -F file=@fixture_plan.pdf
curl -sX POST localhost:8000/api/projects/<PROJECT>/process   # → {"job_id": ...}
curl -s localhost:8000/api/projects/<PROJECT>/quantities | python -m json.tool
# open http://localhost:8000/review to see overlays and accept/edit/reject
curl -sX POST localhost:8000/api/projects/<PROJECT>/export \
     -H 'content-type: application/json' -d '{"format":"xlsx"}'
```

## Database

PostgreSQL, and the engine owns **its own database** — create a `takeoff` database inside the same cluster the main app uses (on Neon: add a second database to the project) and set:

```
TAKEOFF_DATABASE_URL=postgresql+psycopg://user:pass@host/takeoff
```

The engine never touches the app's tables. For local dev, `docker compose up db` starts Postgres on port 5433. Tests run on in-memory SQLite (the schema is dialect-portable). Migrations: MVP uses `create_all()`; adopt Alembic before the first data-preserving schema change.

## Model setup — where to plug in Qwen / PaddleOCR / RF-DETR / SAM 2 / Llama

Every model sits behind an adapter (`app/adapters/`) selected by env var, with three transports:

- `mock` (default) — no models, deterministic stand-ins.
- `sagemaker` — **the primary hosted path for this project**: each adapter invokes its own SageMaker endpoint via `sagemaker-runtime` (`app/adapters/transport.py`). Set `TAKEOFF_<ADAPTER>_TRANSPORT=sagemaker` and `TAKEOFF_<ADAPTER>_SAGEMAKER_ENDPOINT=<name>`; credentials come from the standard boto3 chain.
- `openai_compat` — any vLLM/TGI/hosted OpenAI-compatible server (VLM + rollup LLM only).
- `local` — run the model in-process (requires the matching extra).

SageMaker serverless guidance (details + payload contracts in [`docs/adapters.md`](docs/adapters.md)):

| Model | Serverless? | Notes |
|---|---|---|
| PaddleOCR / PP-Structure | ✅ | fits comfortably; send PNG crops/pages |
| RF-DETR (fine-tuned) | ✅ | base model fits; watch the ~6 MB sync payload cap → JPEG-encode |
| SAM 2 (hiera-s/b) | ✅ | send the crop around each box, not the full sheet |
| Qwen3-VL 8B+ | ❌ | real-time endpoint or external vLLM box |
| Llama 3.3 70B | ❌ | real-time endpoint or external vLLM box |

Expect serverless cold starts of tens of seconds; the pipeline only calls the VLM for *flagged* items, so the expensive models see a small fraction of the traffic.

## Review workflow & corrections

`GET /api/sheets/{id}/overlay` returns per-quantity polygons/boxes in page points with styling; the bundled `/review` page renders them over the sheet image. `POST /api/quantities/{id}/review` accepts `accept | edit | reject`; every decision stores a **machine snapshot + the human correction** in `review_decisions` — that table is the labeled dataset for fine-tuning and evaluation (`GET /api/projects/{id}/corrections`).

Manual scale calibration (the last-resort ranked source): `POST /api/sheets/{id}/calibrate` with two clicked points and the real distance.

## Confidence & review flags

Each quantity carries per-stage confidences (OCR, scale, geometry, detector, VLM audit) combined pessimistically (`0.6·min + 0.4·product` — a chain is as strong as its weakest evidence). Items are flagged `needs_review` when any of these hold:

NTS sheet · no reliable scale · polygon not closed · scale-note vs known-dimension conflict · schedule/plan tag disagreement · quantity changed >15% vs previous version · SAM mask overreaches unrelated linework · room label far from its polygon · final confidence below threshold · defaulted slab thickness.

Thresholds are configuration (`app/config.py`), not code.

## Fine-tuning roadmap

**Fine-tuning is not required for the first prototype** — the mock/heuristic pipeline and off-the-shelf models exercise everything — **but it is required for production accuracy.** Priority order:

1. **RF-DETR on construction drawings** (highest impact). Target classes: doors, windows, slabs, walls, room tags, finish tags, dimensions, symbols, schedule references (`CONSTRUCTION_CLASSES` in `app/adapters/detector_rfdetr.py`). Labels come from two sources: (a) the review UI's corrections log — every accepted/corrected detection is a labeled box; (b) a seed set annotated in any COCO-format tool.
2. **Segmentation model for room/slab/floor-region masks** — fine-tune SAM 2 prompting heads or train a Mask2Former/SegFormer-style model on corrected polygons.
3. **Lightweight sheet-type classifier + title-block extractor** — replaces the heuristics in `app/pipeline/sheet_classify.py`; a small ViT or even logistic regression over OCR features is enough.

**Do not fine-tune Qwen or Llama first.** Use prompt engineering, RAG over OCR spans/schedule tables, deterministic rules, and the human-corrections log. LLM fine-tuning is a last resort after those are exhausted. Full plan: [`docs/fine-tuning-roadmap.md`](docs/fine-tuning-roadmap.md).

## Evaluation

Benchmark format (one JSON per sheet): input sheet, human-labeled polygons, human-labeled counts, human-labeled scale, expected quantities, accepted tolerance by trade. Metrics: area error %, count precision/recall, scale detection accuracy, OCR span recall for key notes, schedule-linking accuracy, % of items requiring review, correction time saved vs manual takeoff. Details and file schema: [`docs/evaluation.md`](docs/evaluation.md).

## Engineering philosophy

- **Never silently guess.** No scale → refuse and flag. Open polygon → zero area and flag. Defaulted thickness → flag.
- **Expose evidence.** Every number links to the geometry, OCR spans, and scale that produced it; the formula string is the literal calculation.
- **Make correction easy, then learn from it.** Corrections are first-class data.
- **Deterministic code for math and geometry.** LLMs classify, match, and explain — they never multiply.

## Known limitations & explicit assumptions

- **Mock mode is a plumbing demo, not a takeoff tool.** OpenCV heuristics find rectangles on clean vector drawings; real drawings need the real detector/segmenter (and ultimately fine-tuning).
- **PyMuPDF is AGPL-3.0.** Fine for internal/open deployments; if that's a problem, implement the stubbed `pdf_pdfium` ingestor (pypdfium2 + pdfplumber, permissive). Marker was considered for layout parsing and excluded from the core for the same licensing reason.
- Scale handling assumes **one scale per sheet**; per-viewport scale is modeled (`DrawingViewport.scale_id`) but viewport detection isn't implemented yet. Details drawn at a second scale on a plan sheet will mis-measure until then — mitigated by the plausibility flags.
- Graphic-scale-bar reading and known-dimension auto-calibration are stubs (`ScaleSource` ranks exist; detectors for the bar/extension lines don't yet).
- PP-Structure table extraction (door/window/finish schedules) is wired as a contract but not parsed end-to-end; schedule linking is therefore partial.
- Wall LF takeoff, curved geometry, multi-viewport sheets, rotated text handling beyond span rotation, and revision-vs-revision diffing are future work.
- Imperial-first: metric ratios (`1:100`) parse, but downstream units are SF/LF/CY.
- One VLM question per ambiguity; no escalation to the 235B thinking model yet (the queue design supports it).
- **No accuracy guarantee.** Exports carry a disclaimer; the review workflow is the product, not an afterthought.

## Build plan

**Day 1 prototype (this repo, done):** full pipeline with mock adapters on synthetic PDFs; scale parsing, geometry, CY math, confidence flags, review API/UI, exports, tests, CI.

**Week 1 MVP:** run PaddleOCR + SAM 2 locally (or first SageMaker endpoints); GroundingDINO for candidate boxes on a handful of real plan sets; manual calibration UX polish; first benchmark sheets labeled; wire the ContractorAI app to the engine's API.

**Month 1 serious prototype:** ~200–500 labeled sheets; fine-tuned RF-DETR v0; schedule table parsing + linking; per-viewport scale detection; graphic-bar and known-dimension calibration; Qwen3-VL audit live on flagged items; evaluation dashboard from the benchmark; RQ workers + S3/MinIO storage backend.

**Production roadmap:** fine-tuned segmentation model; revision diffing with version-delta flags; assembly/pricing integration; multi-tenant auth; Alembic migrations; SageMaker autoscaling + async inference for batch jobs; active-learning loop from the corrections table; accuracy SLOs per trade with the benchmark as the gate.

## Repository layout

```
app/
  adapters/     model adapters: ABC + mock + real stub per model, transports
  api/          FastAPI routers (projects, pipeline, sheets, quantities, review,
                calibration, exports)
  db/           SQLAlchemy engine + tables
  export/       Excel / JSON / CSV writers
  geometry/     Shapely engine, OpenCV raster ops, unit math   ← the source of truth
  ingestion/    PyMuPDF (primary), TIFF, pdfium fallback stub, coordinates
  pipeline/     orchestrator + stages (classify, scale, candidates, measure,
                confidence, vlm_audit, rollup)
  schemas/      Pydantic models for every entity
  storage/      local FS backend (S3/MinIO interface-ready)
  workers/      local thread queue + optional RQ
docs/           architecture, adapters, fine-tuning, evaluation
tests/          unit + end-to-end (synthetic fixture PDF, mock adapters)
ui/review/      minimal overlay review page
```
