"""JSON export with the full audit trail (real implementation).

The file contains every quantity plus the complete evidence chain each one
references — geometries, masks, detections, OCR spans, scale calibrations —
so a third party can re-derive every number offline.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from app.adapters.base import ExportAdapter
from app.export.disclaimer import DISCLAIMER


class JSONExportAdapter(ExportAdapter):
    name = "json-export"

    def export(self, project_id: str, payload: dict[str, Any], out_path: str) -> str:
        quantities = payload["quantities"]
        artifacts_by_id = payload.get("artifacts", {})

        referenced: dict[str, dict] = {}
        for q in quantities:
            for aid in (
                q.get("source_geometry_ids", [])
                + q.get("source_ocr_span_ids", [])
                + ([q["scale_id"]] if q.get("scale_id") else [])
            ):
                if aid in artifacts_by_id:
                    referenced[aid] = artifacts_by_id[aid]
                    # one hop deeper: geometry → masks/detections it derives from
                    for src in artifacts_by_id[aid].get("data", {}).get("derived_from", []):
                        if src in artifacts_by_id:
                            referenced[src] = artifacts_by_id[src]

        doc = {
            "schema_version": "1.0",
            "generated_at": datetime.now(UTC).isoformat(),
            "project": payload.get("project", {"id": project_id}),
            "disclaimer": DISCLAIMER,
            "sheets": payload.get("sheets", []),
            "quantities": quantities,
            "evidence": referenced,
            "review_decisions": payload.get("review_decisions", []),
        }
        with open(out_path, "w") as f:
            json.dump(doc, f, indent=2, default=str)
        return out_path
