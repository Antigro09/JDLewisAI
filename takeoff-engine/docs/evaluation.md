# Evaluation plan

Accuracy is measured against **estimator ground truth**, never against the
model's own confidence.

## Benchmark format

One directory per benchmark sheet:

```
benchmarks/<set>/<sheet-id>/
  input.pdf | input.tif          # the sheet as received
  truth.json                     # human labels (schema below)
```

```jsonc
// truth.json
{
  "sheet": {"discipline": "structural", "source": "firm-A", "quality": "vector"},
  "scale": {"ft_per_pt": 0.1111, "text": "1/8\" = 1'-0\"", "nts": false},
  "polygons": [                   // human-traced, page points
    {"label": "slab", "exterior": [[x, y], ...], "attributes": {"thickness_in": 4}},
    {"label": "room", "exterior": [...], "room_tag": "OFFICE 101", "finish": "CPT-1"}
  ],
  "counts": {"door": 12, "window": 8},
  "key_spans": ["1/8\" = 1'-0\"", "4\" CONC. SLAB", "DOOR SCHEDULE"],
  "expected_quantities": [
    {"item_type": "concrete_slab", "quantity": 14.8, "unit": "CY", "tolerance_pct": 3},
    {"item_type": "flooring",      "quantity": 300,  "unit": "SF", "tolerance_pct": 5},
    {"item_type": "door",          "quantity": 12,   "unit": "EA", "tolerance_pct": 0}
  ]
}
```

Tolerances are **per trade** — concrete tighter than flooring, counts exact.

## Metrics

| Metric | Definition |
|---|---|
| Area error % | per area item: `abs(pred − truth) / truth`; report median + P90 per trade |
| Count precision/recall | matched symbol detections vs truth counts (per class) |
| Scale detection accuracy | % of sheets where the auto scale is within 1% of truth (NTS refusal on an NTS sheet counts as correct) |
| OCR span recall | % of `key_spans` recovered (fuzzy match ≥ 0.9) with IoU>0 coordinates |
| Schedule-linking accuracy | % of plan tags linked to the correct schedule row |
| % requiring review | share of items flagged `needs_review` (the automation-rate ceiling) |
| Correction time saved | timed study: minutes per sheet with review UI vs fully manual takeoff |

Also track the **calibration** of the confidence system: bucket items by
`final_confidence` and verify empirical error falls as confidence rises —
a confidence score that doesn't predict error is noise.

## Protocol

- Hold the benchmark out of ALL training data (hash inputs, block by hash).
- Run per model release and per threshold change; CI-gate on regression.
- Slice results by discipline, source firm, and raster-vs-vector input —
  aggregate numbers hide scan-quality failures.
- Seed the set with ≥30 sheets across ≥3 firms before trusting any number.
