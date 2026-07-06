# Plugging in real models

Every adapter is selected by env var and speaks through a transport
(`app/adapters/transport.py`): `mock`, `sagemaker`, `openai_compat`, `local`.

## SageMaker (primary hosted path)

Each adapter gets its own endpoint:

```bash
TAKEOFF_DETECTOR_TRANSPORT=sagemaker
TAKEOFF_DETECTOR_SAGEMAKER_ENDPOINT=rf-detr-construction
TAKEOFF_AWS_REGION=us-east-1
pip install -e ".[sagemaker]"
```

Credentials come from the standard boto3 chain (env vars, instance profile,
`~/.aws`). The transport sends JSON; images are base64-encoded inside it.

### Serverless vs real-time

| Endpoint | Hosting | Why |
|---|---|---|
| PaddleOCR / PP-Structure | serverless | small, bursty |
| RF-DETR (fine-tuned) | serverless | base model fits 4–6 GB memory configs |
| SAM 2 hiera-s/b | serverless | send box CROPS, not full sheets |
| GroundingDINO | serverless (large mem) | optional |
| Qwen3-VL 8B/32B/72B | **real-time / external vLLM** | exceeds serverless limits |
| Llama 3.3 70B | **real-time / external vLLM** | exceeds serverless limits |

Serverless caveats baked into the adapter design:
- **~6 MB synchronous payload cap** → adapters JPEG/PNG-encode and should send
  crops; never post a 600-DPI full sheet.
- **Cold starts** of tens of seconds → the pipeline batches per sheet and only
  consults the VLM for flagged items.
- For long batch runs consider SageMaker **async inference**; the transport
  interface accommodates it (implement `invoke` with the async API + polling).

### Payload contracts (implement these in your endpoint containers)

```jsonc
// OCR       req: {"image_b64", "structure": true}
//           res: {"spans": [{"text","bbox_px","rotation","confidence"}], "tables":[...]}
// Detector  req: {"image_b64", "threshold"}
//           res: {"detections": [{"label","bbox_px","confidence"}]}
// Segmenter req: {"image_b64", "boxes_px": [[x0,y0,x1,y1]]}
//           res: {"masks": [{"polygons_px": [[[x,y]...]], "confidence"}]}
// VLM/LLM   req: {"messages": [...]}   // OpenAI-style, image parts as data URLs
//           res: {"content": "..."}
```

## OpenAI-compatible (vLLM/TGI) for the LLMs

```bash
TAKEOFF_VLM_TRANSPORT=openai_compat
TAKEOFF_VLM_OPENAI_BASE_URL=http://your-vllm:8000/v1
TAKEOFF_VLM_OPENAI_MODEL=Qwen/Qwen3-VL-8B-Instruct
pip install -e ".[vlm]"
```

Serve with e.g. `vllm serve Qwen/Qwen3-VL-8B-Instruct`. Same pattern for the
rollup LLM (`TAKEOFF_ROLLUP_*`, e.g. `meta-llama/Llama-3.3-70B-Instruct`).
Reserve **Qwen3-VL-235B-A22B-Thinking** for a second-pass escalation queue on
questions the 8B answered `uncertain` — not the default path.

## Local (in-process)

`TAKEOFF_<ADAPTER>_TRANSPORT=local` with the matching extra installed runs
PaddleOCR / RF-DETR / SAM 2 in-process (see `_INSTALL` strings in each adapter
for exact requirements, e.g. SAM 2 needs a checkpoint path).

## VLM usage rules (enforced by the interface)

`VLMAdapter.decide()` takes a question id, multiple-choice options, image
crops, and evidence context; returns `VLMDecision {decision, confidence,
evidence_span_ids, evidence_geometry_ids, rationale}`. Off-menu answers are
coerced to `uncertain`. There is deliberately no method that returns text
transcriptions, coordinates, or numbers.
