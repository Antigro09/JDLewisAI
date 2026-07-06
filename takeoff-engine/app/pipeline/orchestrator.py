"""Pipeline orchestrator.

Runs the stage sequence per sheet and persists every intermediate artifact,
so any quantity can be traced: quantity → geometry → mask/detection →
raster/vector/OCR spans → sheet → file. Stage order:

  ingest → OCR/layout → classify → scale → candidates → measure →
  confidence flags → VLM audit → rollup → persist

`process_project_job(project_id)` is a module-level function so both the
local thread queue and RQ can run it.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

import cv2

from app.adapters.base import build_adapters
from app.config import get_settings
from app.db.database import session_scope
from app.db.orm import ArtifactRow, FileRow, JobRow, ProjectRow, QuantityRow, SheetRow
from app.geometry.engine import GeometryEngine
from app.ingestion.pdf_pymupdf import PyMuPDFIngestor
from app.ingestion.tiff import TiffIngestor
from app.pipeline import vlm_audit as audit
from app.pipeline.candidates import COUNT_LABELS, run_candidates
from app.pipeline.confidence import finalize_item
from app.pipeline.measure import count_symbols, measure_area_item
from app.pipeline.rollup import rollup_items
from app.pipeline.scale_calibration import resolve_scale
from app.pipeline.sheet_classify import classify_sheet
from app.schemas.core import SheetType
from app.storage.local import LocalStorage

log = logging.getLogger(__name__)

# detection label → quantity item type
ITEM_TYPE_BY_LABEL = {"slab": "concrete_slab", "room": "flooring", "door": "door", "window": "window"}


def process_project_job(project_id: str, job_id: str) -> None:
    settings = get_settings()
    storage = LocalStorage(settings.storage_root)
    adapters = build_adapters(settings)
    geometry_engine = GeometryEngine()

    def set_job(status: str, progress: str = "", error: str = ""):
        with session_scope() as s:
            job = s.get(JobRow, job_id)
            if job:
                job.status = status
                job.progress = progress or job.progress
                job.error = error
                if status in ("done", "failed"):
                    job.finished_at = datetime.now(UTC)

    try:
        set_job("running", "loading files")
        with session_scope() as s:
            files = s.query(FileRow).filter_by(project_id=project_id).all()
        if not files:
            raise ValueError("project has no uploaded files")

        for f in files:
            _process_file(project_id, f, settings, storage, adapters, geometry_engine, set_job)

        with session_scope() as s:
            proj = s.get(ProjectRow, project_id)
            if proj:
                proj.status = "processed"
        set_job("done", "complete")
    except Exception as e:
        log.exception("processing failed for project %s", project_id)
        with session_scope() as s:
            proj = s.get(ProjectRow, project_id)
            if proj:
                proj.status = "failed"
        set_job("failed", error=f"{type(e).__name__}: {e}")


def _process_file(project_id, file_row, settings, storage, adapters, geometry_engine, set_job):
    path = storage.open_path(file_row.storage_path)
    is_tiff = file_row.media_type in ("image/tiff", "image/tif") or path.suffix.lower() in (
        ".tif",
        ".tiff",
    )
    ingestor = TiffIngestor() if is_tiff else PyMuPDFIngestor()
    n_pages = ingestor.page_count(path)

    for page_number in range(1, n_pages + 1):
        set_job("running", f"{file_row.filename}: sheet {page_number}/{n_pages}")

        # --- 1. sheet ingestion ------------------------------------------
        sheet = ingestor.extract_sheet(path, page_number, project_id, file_row.storage_path)
        render_key = f"projects/{project_id}/renders/{sheet.id}_{settings.render_dpi}.png"
        raster = ingestor.render_page(
            path, page_number, sheet.id, settings.render_dpi, storage.open_path(render_key)
        )
        raster.image_path = render_key
        native_spans, vector_paths = [], []
        if not is_tiff:
            native_spans = ingestor.extract_text_spans(path, page_number, sheet.id)
            vector_paths = ingestor.extract_vector_paths(path, page_number, sheet.id)

        image = cv2.imread(str(storage.open_path(render_key)))
        px_per_pt = raster.px_per_pt

        # --- 2. OCR/layout -------------------------------------------------
        ocr_result = adapters["ocr"].run(image, sheet.id, px_per_pt)
        spans = native_spans + ocr_result.spans

        # --- 3. classification --------------------------------------------
        sheet.sheet_type, sheet.sheet_type_confidence, sheet.sheet_number = classify_sheet(
            sheet, spans
        )

        # --- 4. scale calibration ------------------------------------------
        pdf_scale = None if is_tiff else ingestor.scale_metadata(path, page_number)
        scale = resolve_scale(sheet, spans, pdf_metadata_ft_per_pt=pdf_scale)
        sheet.is_nts = scale.source.value == "nts"

        # --- 5. candidates --------------------------------------------------
        detections, masks, geometries = run_candidates(
            image, sheet.id, px_per_pt, adapters["detector"], adapters["segmenter"], geometry_engine
        )

        # --- 6. deterministic measurement -----------------------------------
        # Overlapping detectors (or a box + its own interior contour) can yield
        # near-identical polygons; keep one per region.
        geometries = _dedupe_geometries(geometries, geometry_engine)
        items = []
        det_by_id = {d.id: d for d in detections}
        for geom in geometries:
            det = next((det_by_id[i] for i in geom.derived_from if i in det_by_id), None)
            label = det.label if det else "room"
            item_type = ITEM_TYPE_BY_LABEL.get(label)
            if item_type is None:
                continue
            # Structural sheets take off slabs; everything measured there is concrete.
            if sheet.sheet_type == SheetType.STRUCTURAL_PLAN:
                item_type = "concrete_slab"
            items.append(
                measure_area_item(
                    project_id=project_id, sheet=sheet, geometry=geom, scale=scale,
                    detection=det, item_type=item_type, settings=settings,
                )
            )
        for label in COUNT_LABELS:
            counted = count_symbols(
                project_id=project_id, sheet=sheet, detections=detections,
                label=label, scale=scale,
            )
            if counted:
                items.append(counted)

        # --- 7. confidence + review flags ------------------------------------
        geoms_by_id = {g.id: g for g in geometries}
        masks_by_id = {m.id: m for m in masks}
        for item in items:
            finalize_item(
                item, settings=settings, scale=scale,
                geometries=geoms_by_id, masks=masks_by_id,
            )

        # --- 8. VLM audit (flagged items only) --------------------------------
        queue = audit.build_question_queue(items)
        if queue:
            audit.run_audit(queue, adapters["vlm"], image, px_per_pt, {i.id: i for i in items})

        # --- 9. estimator rollup ----------------------------------------------
        items = rollup_items(items, spans, adapters["rollup"], settings)
        # Rollup may change units/values via deterministic derivations; recompute
        # final confidence once more (flags only accumulate, never clear).
        for item in items:
            item.final_confidence = item.confidence.final()

        _persist_sheet(
            project_id, sheet, raster, vector_paths, spans, ocr_result.tables,
            scale, detections, masks, geometries, items,
        )


def _dedupe_geometries(geometries, engine, threshold: float = 0.92):
    """Drop polygons that mutually overlap an already-kept one by >threshold."""
    kept = []
    for g in sorted(geometries, key=lambda g: g.area_pt2, reverse=True):
        if g.kind == "polygon" and g.is_closed:
            dup = any(
                k.is_closed
                and engine.overlap_ratio(g, k) > threshold
                and engine.overlap_ratio(k, g) > threshold
                for k in kept
            )
            if dup:
                continue
        kept.append(g)
    return kept


def _persist_sheet(project_id, sheet, raster, vector_paths, spans, tables,
                   scale, detections, masks, geometries, items):
    def artifact(kind, model):
        return ArtifactRow(
            id=model.id, sheet_id=sheet.id, kind=kind, data=model.model_dump(mode="json")
        )

    with session_scope() as s:
        s.add(SheetRow(
            id=sheet.id, project_id=project_id, page_number=sheet.page_number,
            sheet_number=sheet.sheet_number, sheet_type=sheet.sheet_type.value,
            data=sheet.model_dump(mode="json"),
        ))
        s.add(artifact("raster_page", raster))
        s.add(artifact("scale", scale))
        for v in vector_paths:
            s.add(artifact("vector_path", v))
        for span in spans:
            s.add(artifact("ocr_span", span))
        for t in tables:
            s.add(artifact("ocr_table", t))
        for d in detections:
            s.add(artifact("detection", d))
        for m in masks:
            s.add(artifact("mask", m))
        for g in geometries:
            s.add(artifact("geometry", g))
        for item in items:
            s.add(QuantityRow(
                id=item.id, project_id=project_id, sheet_id=sheet.id,
                item_type=item.item_type, unit=item.unit, quantity=item.quantity,
                needs_review=item.needs_review, review_status=item.review_status,
                version=item.version, data=item.model_dump(mode="json"),
            ))
