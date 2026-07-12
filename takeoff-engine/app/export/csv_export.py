"""CSV export — the Takeoff tab, flat."""

from __future__ import annotations

import csv
from typing import Any

from app.adapters.base import ExportAdapter
from app.export.audit import attributes_json, audit_summary


class CSVExportAdapter(ExportAdapter):
    name = "csv-export"

    def export(self, project_id: str, payload: dict[str, Any], out_path: str) -> str:
        cols = ["id", "sheet_id", "page_number", "item_type", "description", "quantity",
                "unit", "csi_code", "formula", "scale_confidence", "measurement_confidence",
                "model_confidence", "final_confidence", "needs_review", "review_reason",
                "review_status", "audit_notes", "source_geometry_ids", "source_ocr_span_ids",
                "attributes"]
        with open(out_path, "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(cols)
            for q in payload["quantities"]:
                row = []
                for c in cols:
                    if c == "audit_notes":
                        row.append(audit_summary(q))
                    elif c == "attributes":
                        row.append(attributes_json(q))
                    elif isinstance(q.get(c), list):
                        row.append(",".join(q[c]))
                    else:
                        row.append(q.get(c, ""))
                writer.writerow(row)
        return out_path
