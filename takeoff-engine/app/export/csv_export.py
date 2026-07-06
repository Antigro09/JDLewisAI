"""CSV export — the Takeoff tab, flat."""

from __future__ import annotations

import csv
from typing import Any

from app.adapters.base import ExportAdapter


class CSVExportAdapter(ExportAdapter):
    name = "csv-export"

    def export(self, project_id: str, payload: dict[str, Any], out_path: str) -> str:
        cols = ["id", "sheet_id", "page_number", "item_type", "description", "quantity",
                "unit", "csi_code", "formula", "scale_confidence", "measurement_confidence",
                "model_confidence", "final_confidence", "needs_review", "review_reason",
                "review_status"]
        with open(out_path, "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(cols)
            for q in payload["quantities"]:
                writer.writerow([
                    ",".join(q[c]) if isinstance(q.get(c), list) else q.get(c, "")
                    for c in cols
                ])
        return out_path
