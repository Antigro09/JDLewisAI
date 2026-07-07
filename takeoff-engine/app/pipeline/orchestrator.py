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

import hashlib
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
from app.schemas.confidence import ReviewReason
from app.schemas.core import SheetType
from app.schemas.scale import ScaleCalibration, ScaleSource
from app.storage.local import LocalStorage

log = logging.getLogger(__name__)

# detection label → quantity item type
ITEM_TYPE_BY_LABEL = {"slab": "concrete_slab", "room": "flooring", "door": "door", "window": "window"}


def _stable_id(*parts) -> str:
    """Content-derived id so re-processing the same page upserts existing rows
    instead of minting fresh ones (which would double-count on every re-run)."""
    return hashlib.sha1("::".join(str(p) for p in parts).encode()).hexdigest()[:32]


def _nearest_label(label_dets, engine, g):
    """Nearest room_label detection to a polygon (for LABEL_FAR_FROM_POLYGON)."""
    if not label_dets:
        return None
    return min(label_dets, key=lambda d: engine.label_distance_pt(d.bbox, g))


def _load_manual_scale(sheet_id: str) -> ScaleCalibration | None:
    """A two-click MANUAL calibration stored by the /calibrate endpoint wins over
    every OCR-derived source on re-process. Preserved across re-runs."""
    with session_scope() as s:
        rows = s.query(ArtifactRow).filter_by(sheet_id=sheet_id, kind="scale").all()
        manual = [
            r.data for r in rows if r.data.get("source") == ScaleSource.MANUAL.value
        ]
    if not manual:
        return None
    # Newest manual calibration wins.
    manual.sort(key=lambda d: d.get("created_at", ""))
    cal = ScaleCalibration.model_validate(manual[-1])
    return cal if cal.usable else None


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
        # Stable identity keyed on (project, file, page) so a re-run overwrites
        # this sheet's rows rather than appending a duplicate set.
        sheet.id = _stable_id(project_id, file_row.storage_path, page_number)
        render_dpi = min(settings.render_dpi, settings.max_render_dpi)  # guard absurd DPI
        render_key = f"projects/{project_id}/renders/{sheet.id}_{render_dpi}.png"
        raster = ingestor.render_page(
            path, page_number, sheet.id, render_dpi, storage.open_path(render_key)
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
        manual_scale = _load_manual_scale(sheet.id)
        scale = resolve_scale(
            sheet, spans, pdf_metadata_ft_per_pt=pdf_scale, manual_override=manual_scale
        )
        sheet.is_nts = scale.source.value == "nts"

        # --- 5. candidates --------------------------------------------------
        # vector_paths feed the exact vector-first boundary path; the mask is
        # the fallback only where a sheet carries no linework.
        detections, masks, geometries = run_candidates(
            image, sheet.id, px_per_pt, adapters["detector"], adapters["segmenter"],
            geometry_engine, vector_paths=vector_paths,
        )

        # --- 6. deterministic measurement -----------------------------------
        # Overlapping detectors (or a box + its own interior contour) can yield
        # near-identical polygons; keep one per region.
        geometries = _dedupe_geometries(geometries, geometry_engine)
        items = []
        item_labels: dict[str, object] = {}  # item.id → nearest room_label detection
        det_by_id = {d.id: d for d in detections}
        label_dets = [d for d in detections if d.label == "room_label"]

        for idx, geom in enumerate(geometries):
            det = next((det_by_id[i] for i in geom.derived_from if i in det_by_id), None)
            label = det.label if det else "room"
            item_type = ITEM_TYPE_BY_LABEL.get(label)
            if item_type is None:
                continue
            # Structural sheets take off slabs; everything measured there is concrete.
            if sheet.sheet_type == SheetType.STRUCTURAL_PLAN:
                item_type = "concrete_slab"
            item = measure_area_item(
                project_id=project_id, sheet=sheet, geometry=geom, scale=scale,
                detection=det, item_type=item_type, settings=settings,
            )
            item.id = _stable_id(sheet.id, item_type, idx)
            items.append(item)
            item_labels[item.id] = _nearest_label(label_dets, geometry_engine, geom)
        # A slab footprint and its interior sub-faces (partitions/rooms) can both
        # be detected; summing them double-counts concrete. Collapse any slab
        # contained within a larger slab into the footprint (flooring is left
        # alone — distinct rooms are distinct floor areas).
        items = _collapse_contained_slabs(items, {g.id: g for g in geometries}, geometry_engine)
        for label in COUNT_LABELS:
            counted = count_symbols(
                project_id=project_id, sheet=sheet, detections=detections,
                label=label, scale=scale,
            )
            if counted:
                counted.id = _stable_id(sheet.id, label)
                items.append(counted)

        # --- 7. confidence + review flags ------------------------------------
        geoms_by_id = {g.id: g for g in geometries}
        masks_by_id = {m.id: m for m in masks}
        for item in items:
            finalize_item(
                item, settings=settings, scale=scale,
                geometries=geoms_by_id, masks=masks_by_id,
                label_detection=item_labels.get(item.id),
                dpi_assumed=raster.dpi_assumed,
            )

        # --- 8. VLM audit (flagged items only) --------------------------------
        queue = audit.build_question_queue(items)
        if queue:
            audit.run_audit(queue, adapters["vlm"], image, px_per_pt, {i.id: i for i in items})

        # --- 9. estimator rollup ----------------------------------------------
        items = rollup_items(
            items, spans, adapters["rollup"], settings,
            geometries=geoms_by_id, engine=geometry_engine,
        )
        # Rollup/VLM may have lowered confidence; recompute and re-apply the
        # low-confidence threshold so a late drop still flags for review.
        for item in items:
            item.final_confidence = item.confidence.final()
            if (
                item.final_confidence < settings.review_confidence_threshold
                and ReviewReason.LOW_CONFIDENCE not in item.review_reason
            ):
                item.needs_review = True
                item.review_reason.append(ReviewReason.LOW_CONFIDENCE)

        _persist_sheet(
            project_id, sheet, raster, vector_paths, spans, ocr_result.tables,
            scale, detections, masks, geometries, items,
        )


_SOURCE_RANK = {"vector": 0, "manual": 1}  # exact > manual > mask/unknown (default 2)


def _dedupe_geometries(geometries, engine, threshold: float = 0.92):
    """Drop polygons that mutually overlap an already-kept one by >threshold.

    Order matters: a region can be captured by BOTH an exact vector face and an
    approximate mask, so we keep the vector one — ranking boundary_source before
    area — and only fall back to larger-area within the same source. Shapely
    shapes are built once per geometry (not on every O(n²) comparison).
    """
    shapes: dict[str, object] = {}

    def shape(g):
        if g.id not in shapes:
            shapes[g.id] = engine._to_shapely(g)
        return shapes[g.id]

    def rank(g):
        return (_SOURCE_RANK.get(g.boundary_source, 2), -g.area_pt2)

    kept = []
    for g in sorted(geometries, key=rank):
        if g.kind == "polygon" and g.is_closed:
            sg = shape(g)
            if sg is not None:
                dup = False
                for k in kept:
                    sk = shape(k)
                    if sk is None:
                        continue
                    inter = sg.intersection(sk).area
                    if inter > threshold * sg.area and inter > threshold * sk.area:
                        dup = True
                        break
                if dup:
                    continue
        kept.append(g)
    return kept


def _collapse_contained_slabs(items, geoms_by_id, engine, contain: float = 0.9):
    """Drop any concrete_slab whose polygon is >=`contain` inside a larger slab
    (footprint absorbs interior faces) — deterministic anti-double-count."""
    slabs = [it for it in items if it.item_type == "concrete_slab" and it.source_geometry_ids]
    drop: set[str] = set()
    for a in slabs:
        ga = geoms_by_id.get(a.source_geometry_ids[0])
        if ga is None or not ga.is_closed:
            continue
        for b in slabs:
            if a is b or b.id in drop:
                continue
            gb = geoms_by_id.get(b.source_geometry_ids[0])
            if gb is None or not gb.is_closed or gb.area_pt2 <= ga.area_pt2:
                continue
            if engine.overlap_ratio(ga, gb) >= contain:  # a mostly inside larger b
                drop.add(a.id)
                break
    return [it for it in items if it.id not in drop]


def _persist_sheet(project_id, sheet, raster, vector_paths, spans, tables,
                   scale, detections, masks, geometries, items):
    def artifact(kind, model):
        return ArtifactRow(
            id=model.id, sheet_id=sheet.id, kind=kind, data=model.model_dump(mode="json")
        )

    with session_scope() as s:
        # Idempotent re-process: clear this sheet's prior artifacts (keeping any
        # human MANUAL calibration) and upsert the sheet + quantities by their
        # stable ids, so a second /process run overwrites instead of duplicating.
        # Quantities are upserted (not deleted) so review_decisions stay linked.
        manual_ids = {
            r.id
            for r in s.query(ArtifactRow).filter_by(sheet_id=sheet.id, kind="scale").all()
            if r.data.get("source") == ScaleSource.MANUAL.value
        }
        for r in s.query(ArtifactRow).filter_by(sheet_id=sheet.id).all():
            if r.id not in manual_ids:
                s.delete(r)
        s.flush()

        s.merge(SheetRow(
            id=sheet.id, project_id=project_id, page_number=sheet.page_number,
            sheet_number=sheet.sheet_number, sheet_type=sheet.sheet_type.value,
            data=sheet.model_dump(mode="json"),
        ))
        s.add(artifact("raster_page", raster))
        # A resolved MANUAL scale is already persisted (preserved above); don't re-add it.
        if scale.id not in manual_ids:
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
            s.merge(QuantityRow(
                id=item.id, project_id=project_id, sheet_id=sheet.id,
                item_type=item.item_type, unit=item.unit, quantity=item.quantity,
                needs_review=item.needs_review, review_status=item.review_status,
                version=item.version, data=item.model_dump(mode="json"),
            ))
