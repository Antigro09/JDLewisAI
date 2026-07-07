# Architecture & stage contracts

## Coordinate system

Everything lives in **page points**: 1/72 inch of paper, origin top-left, y down.
- PDF native text/vectors: already in points (PyMuPDF convention).
- Raster artifacts: `px / (dpi/72)`.
- TIFF sheets: points derived from the DPI tag (default 300, recorded).
- Real feet appear only via `ScaleCalibration.ft_per_pt`.

## Pipeline pseudocode

```python
for file in project.files:
    for page in file.pages:
        # 1. ingestion
        sheet   = extract_sheet(page)                 # dims, rotation
        raster  = render(page, dpi=settings.render_dpi)
        native  = extract_text_spans(page)            # conf=1.0, exact coords
        vectors = extract_vector_paths(page)

        # 2. OCR/layout (coordinate-preserving)
        ocr = OCRAdapter.run(raster)                  # spans + tables in points
        spans = native + ocr.spans

        # 3. classification (deterministic heuristics; VLM assist optional)
        sheet.type, conf, sheet.number = classify(sheet, spans)

        # 4. scale — ranked sources, refusal on NTS
        scale = resolve_scale(sheet, spans,
                              pdf_metadata, known_dimension_calibration)

        # 5. candidates
        dets  = DetectorAdapter.detect(raster)        # boxes
        masks = SegmenterAdapter.segment(raster, boxes=area_boxes(dets))
        geoms = [GeometryEngine.build_polygon(largest_ring(m)) for m in masks]

        # 6. deterministic measurement — the ONLY source of numbers
        items  = [measure_area_item(g, scale) for g in geoms]        # SF
        items += [count_symbols(dets, label) for label in ("door", "window")]

        # 7. confidence + review flags (flags only accumulate, never clear;
        #    VERSION_DELTA/SCHEDULE_PLAN_MISMATCH fire only once versioning /
        #    schedule-linking supply their inputs)
        for item in items: finalize_item(item, scale, geoms, masks)

        # 8. VLM audit — flagged items only, structured decisions, no numbers
        run_audit(build_question_queue(items), VLMAdapter, raster)

        # 9. rollup — deterministic derivations + CSI decoration
        thickness = find_slab_thickness_ft(spans)     # '4" CONC. SLAB'
        derive_concrete_volume(slab_items, thickness) # CY = SF × t / 27
        derive_flooring(floor_items, waste_factor)
        RollupLLMAdapter.map_assemblies(items)        # CSI codes only

        persist(sheet, raster, vectors, spans, tables, scale,
                dets, masks, geoms, items)            # full audit chain
```

## Data model

Pydantic schemas in `app/schemas/`: `Project`, `Sheet`, `RasterPage`,
`VectorPath`, `OCRSpan`, `OCRTable`, `DrawingViewport`, `ScaleCalibration`,
`DetectedObject`, `SegmentationMask`, `PolygonGeometry`, `QuantityItem`,
`AssemblyMapping`, `ReviewDecision`, `ExportJob`, plus `ConfidenceBundle` /
`ReviewReason`.

DB tables (`app/db/orm.py`) store indexed key columns + the full payload as
JSON; `artifacts` is a polymorphic table keyed by `kind`. The evidence chain:

```
QuantityItem.source_geometry_ids → artifacts(kind=geometry).derived_from
    → artifacts(kind=mask | detection) → sheet renders/spans/vectors
QuantityItem.scale_id → artifacts(kind=scale).source_ocr_span_ids
QuantityItem.source_ocr_span_ids → artifacts(kind=ocr_span)
```

## API routes

| Route | Purpose |
|---|---|
| `POST /api/projects` · `GET /api/projects[/{id}]` | project CRUD |
| `POST /api/projects/{id}/files` | upload PDF/TIFF |
| `POST /api/projects/{id}/process` → `GET /api/jobs/{id}` | run pipeline (background) |
| `GET /api/projects/{id}/sheets` | sheet list w/ classification |
| `GET /api/sheets/{id}/image` | rendered page PNG |
| `GET /api/sheets/{id}/overlay` | polygons/boxes + styles per quantity |
| `POST /api/sheets/{id}/calibrate` | manual two-click scale |
| `GET /api/projects/{id}/quantities` · `GET /api/quantities/{id}` | quantities (filter by needs_review/type) |
| `POST /api/quantities/{id}/review` | accept / edit / reject (+ correction) |
| `GET /api/projects/{id}/corrections` | corrections log = training data |
| `POST /api/projects/{id}/export` → `GET /api/exports/{id}/download` | xlsx / json / csv |
| `GET /health` · `GET /review` · `GET /docs` | health, review UI, OpenAPI |
