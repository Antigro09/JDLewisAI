"""PyMuPDF ingestion — the primary PDF path (real implementation).

Extracts, per page: dimensions, native text spans WITH coordinates, vector
paths/linework, and a raster render at configurable DPI. Native PDF text is
gold: it needs no OCR and its coordinates are exact.

Licensing note: PyMuPDF is AGPL-3.0. If that is a problem for your
deployment, swap in ingestion/pdf_pdfium.py (pypdfium2 + pdfplumber,
permissive licenses) — both implement the same PdfIngestor interface.
"""

from __future__ import annotations

from pathlib import Path

import fitz  # PyMuPDF

from app.schemas.core import RasterPage, Sheet, VectorPath
from app.schemas.ocr import OCRSpan


class PyMuPDFIngestor:
    name = "pymupdf"

    def page_count(self, pdf_path: Path) -> int:
        with fitz.open(pdf_path) as doc:
            return doc.page_count

    def extract_sheet(self, pdf_path: Path, page_number: int, project_id: str,
                      source_file: str) -> Sheet:
        """page_number is 1-based."""
        with fitz.open(pdf_path) as doc:
            page = doc[page_number - 1]
            return Sheet(
                project_id=project_id,
                source_file=source_file,
                page_number=page_number,
                width_pt=page.rect.width,
                height_pt=page.rect.height,
                rotation_deg=page.rotation,
            )

    def extract_text_spans(self, pdf_path: Path, page_number: int, sheet_id: str) -> list[OCRSpan]:
        """Native PDF text with exact coordinates (page points, top-left origin)."""
        spans: list[OCRSpan] = []
        with fitz.open(pdf_path) as doc:
            page = doc[page_number - 1]
            for block in page.get_text("dict")["blocks"]:
                if block.get("type") != 0:  # text blocks only
                    continue
                for line in block["lines"]:
                    (dx, dy) = line.get("dir", (1.0, 0.0))
                    import math
                    rotation = math.degrees(math.atan2(-dy, dx)) % 360
                    for span in line["spans"]:
                        text = span["text"].strip()
                        if not text:
                            continue
                        spans.append(
                            OCRSpan(
                                sheet_id=sheet_id,
                                text=text,
                                bbox=tuple(span["bbox"]),
                                rotation_deg=round(rotation, 1),
                                confidence=1.0,  # native text is exact
                                source="pdf_native",
                            )
                        )
        return spans

    def extract_vector_paths(self, pdf_path: Path, page_number: int, sheet_id: str,
                             max_paths: int = 20000) -> list[VectorPath]:
        """Vector linework via page.get_drawings(). Curves are flattened to
        their endpoints — good enough for wall/boundary snapping; refine later
        if curved geometry becomes a takeoff target."""
        paths: list[VectorPath] = []
        with fitz.open(pdf_path) as doc:
            page = doc[page_number - 1]
            for drawing in page.get_drawings():
                if len(paths) >= max_paths:
                    break
                subpaths: list[list[tuple[float, float]]] = []
                current: list[tuple[float, float]] = []
                for item in drawing["items"]:
                    op = item[0]
                    if op == "l":  # line: (p1, p2)
                        p1, p2 = item[1], item[2]
                        if not current or current[-1] != (p1.x, p1.y):
                            if current:
                                subpaths.append(current)
                            current = [(p1.x, p1.y)]
                        current.append((p2.x, p2.y))
                    elif op == "c":  # curve: endpoints only
                        p1, p4 = item[1], item[4]
                        if not current or current[-1] != (p1.x, p1.y):
                            if current:
                                subpaths.append(current)
                            current = [(p1.x, p1.y)]
                        current.append((p4.x, p4.y))
                    elif op == "re":  # rectangle
                        r = item[1]
                        if current:
                            subpaths.append(current)
                            current = []
                        subpaths.append(
                            [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1), (r.x0, r.y0)]
                        )
                if current:
                    subpaths.append(current)
                if not subpaths:
                    continue
                xs = [p[0] for sp in subpaths for p in sp]
                ys = [p[1] for sp in subpaths for p in sp]
                color = drawing.get("color")
                paths.append(
                    VectorPath(
                        sheet_id=sheet_id,
                        kind={"s": "stroke", "f": "fill", "fs": "fill_stroke"}.get(
                            drawing.get("type", "s"), "stroke"
                        ),
                        points=subpaths,
                        is_closed=drawing.get("closePath", False)
                        or any(len(sp) > 3 and sp[0] == sp[-1] for sp in subpaths),
                        stroke_width=drawing.get("width") or 0.0,
                        color=(
                            "#" + "".join(f"{int(c * 255):02x}" for c in color) if color else ""
                        ),
                        bbox=(min(xs), min(ys), max(xs), max(ys)),
                    )
                )
        return paths

    def render_page(self, pdf_path: Path, page_number: int, sheet_id: str,
                    dpi: int, out_path: Path) -> RasterPage:
        with fitz.open(pdf_path) as doc:
            page = doc[page_number - 1]
            pix = page.get_pixmap(dpi=dpi)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            pix.save(out_path)
            return RasterPage(
                sheet_id=sheet_id,
                dpi=dpi,
                width_px=pix.width,
                height_px=pix.height,
                image_path=str(out_path),
                source="pdf_render",
            )

    def scale_metadata(self, pdf_path: Path, page_number: int) -> float | None:
        """Ranked source #1: viewport scale from CAD-produced PDF metadata.

        Vanilla PDFs rarely carry usable scale, but PDFs plotted from CAD can
        embed measurement dictionaries (VP /Measure with /PDF 1.7 geospatial
        or UserUnit). Returns ft_per_pt or None. Conservative: any ambiguity
        → None, so a lower-ranked source takes over.
        """
        with fitz.open(pdf_path) as doc:
            page = doc[page_number - 1]
            try:
                vps = page.get_object().get("VP")  # not exposed by high-level API
            except Exception:
                vps = None
            if not vps:
                return None
        # Parsing /Measure dictionaries reliably needs per-CAD-vendor testing;
        # until then we refuse rather than guess.
        return None
