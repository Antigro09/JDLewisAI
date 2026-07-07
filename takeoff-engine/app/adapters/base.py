"""Adapter interfaces (ABCs) + factory.

Contracts, in one place:
  OCRAdapter        image → OCRSpan/OCRTable with page-point coordinates
  DetectorAdapter   image (+optional vocabulary) → DetectedObject boxes
  SegmenterAdapter  image + box/point prompts → SegmentationMask polygons
  VLMAdapter        evidence pack → structured DECISIONS with references.
                    Never measurements. Never final quantities.
  RollupLLMAdapter  measured items → CSI/assembly mapping + descriptions.
                    Never changes a quantity value.
  ExportAdapter     quantities + audit chain → a file on disk.

GeometryEngine (app/geometry/engine.py) is deliberately NOT behind an adapter
selection switch: geometry is deterministic code, not a swappable model.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

import numpy as np
from pydantic import BaseModel, Field

from app.adapters.transport import AdapterNotConfigured
from app.config import Settings
from app.schemas.detection import DetectedObject, SegmentationMask
from app.schemas.ocr import OCRSpan, OCRTable


class OCRResult(BaseModel):
    spans: list[OCRSpan] = Field(default_factory=list)
    tables: list[OCRTable] = Field(default_factory=list)


class OCRAdapter(ABC):
    name: str = "ocr"

    @abstractmethod
    def run(self, image: np.ndarray, sheet_id: str, px_per_pt: float) -> OCRResult:
        """OCR a rendered page. Coordinates must be returned in page points."""


class DetectorAdapter(ABC):
    name: str = "detector"

    @abstractmethod
    def detect(
        self,
        image: np.ndarray,
        sheet_id: str,
        px_per_pt: float,
        vocabulary: list[str] | None = None,
    ) -> list[DetectedObject]:
        """Detect candidate objects. `vocabulary` supports open-vocab backends
        (GroundingDINO); fixed-class backends (RF-DETR) may ignore it."""


class SegmenterAdapter(ABC):
    name: str = "segmenter"

    @abstractmethod
    def segment(
        self,
        image: np.ndarray,
        sheet_id: str,
        px_per_pt: float,
        boxes: list[tuple[float, float, float, float]],  # page points
    ) -> list[SegmentationMask]:
        """Promptable segmentation from candidate boxes → mask polygons in page points.

        Each returned mask must carry `source_box_index` (the index of its prompt
        box); callers associate masks to boxes by that index, not by position."""


class VLMDecision(BaseModel):
    """Structured VLM output. Evidence references, never measurements."""

    question_id: str
    decision: str                    # e.g. "scale_a", "match", "mismatch", "polygon_wrong"
    confidence: float = 0.0
    evidence_span_ids: list[str] = Field(default_factory=list)
    evidence_geometry_ids: list[str] = Field(default_factory=list)
    rationale: str = ""


class VLMAdapter(ABC):
    name: str = "vlm"

    @abstractmethod
    def decide(
        self,
        question_id: str,
        question: str,
        options: list[str],
        image_crops_b64: list[str],
        context: dict[str, Any],
    ) -> VLMDecision:
        """Answer ONE ambiguity question with a structured decision."""


class RollupRow(BaseModel):
    item_type: str
    csi_code: str = ""
    assembly_name: str = ""
    description: str = ""
    unit: str = ""
    confidence: float = 0.0


class RollupLLMAdapter(ABC):
    name: str = "rollup"

    @abstractmethod
    def map_assemblies(self, items: list[dict[str, Any]]) -> list[RollupRow]:
        """Map measured item types/attributes to CSI-style assemblies and
        polished descriptions. MUST NOT alter quantity values."""


class ExportAdapter(ABC):
    name: str = "export"

    @abstractmethod
    def export(self, project_id: str, payload: dict[str, Any], out_path: str) -> str:
        """Write the export file; return the written path."""


# --------------------------------------------------------------------------
# Factory — adapter selection is config-driven so mock ↔ SageMaker ↔ local
# is an env-var change, not a code change.
# --------------------------------------------------------------------------

def build_adapters(settings: Settings) -> dict[str, Any]:
    from app.adapters import (
        detector_gdino,
        detector_mock,
        detector_rfdetr,
        ocr_mock,
        ocr_paddle,
        rollup_llm,
        rollup_mock,
        segmenter_mock,
        segmenter_sam2,
        vlm_mock,
        vlm_qwen,
    )

    def pick(transport: str, mock_cls, local_factory, remote_factory):
        if transport == "mock":
            return mock_cls()
        if transport == "local":
            # Some adapters (the LLM/VLM endpoints) have no in-process path.
            if local_factory is None:
                raise AdapterNotConfigured(
                    "local transport",
                    "this adapter has no in-process 'local' mode; "
                    "use TAKEOFF_*_TRANSPORT=sagemaker or openai_compat",
                )
            return local_factory()
        return remote_factory()

    return {
        # local factories load your DOWNLOADED weights from the *_checkpoint paths.
        "ocr": pick(
            settings.ocr_transport,
            ocr_mock.MockOCRAdapter,
            lambda: ocr_paddle.PaddleOCRAdapter(),  # PaddleOCR fetches its own weights
            lambda: ocr_paddle.PaddleOCRAdapter(
                sagemaker_endpoint=settings.ocr_sagemaker_endpoint, region=settings.aws_region
            ),
        ),
        "detector": pick(
            settings.detector_transport,
            detector_mock.MockDetectorAdapter,
            lambda: detector_rfdetr.RFDETRAdapter(
                checkpoint=settings.detector_checkpoint,
                threshold=settings.detector_threshold,
            ),
            lambda: detector_rfdetr.RFDETRAdapter(
                sagemaker_endpoint=settings.detector_sagemaker_endpoint,
                region=settings.aws_region,
            ),
        ),
        "segmenter": pick(
            settings.segmenter_transport,
            segmenter_mock.MockSegmenterAdapter,
            lambda: segmenter_sam2.SAM2Adapter(
                checkpoint=settings.segmenter_checkpoint,
                model_cfg=settings.segmenter_model_cfg,
            ),
            lambda: segmenter_sam2.SAM2Adapter(
                sagemaker_endpoint=settings.segmenter_sagemaker_endpoint,
                region=settings.aws_region,
            ),
        ),
        # VLM/rollup are endpoint-only — no in-process 'local' path (local_cls=None).
        "vlm": pick(
            settings.vlm_transport,
            vlm_mock.MockVLMAdapter,
            None,
            lambda: vlm_qwen.QwenVLAdapter.from_settings(settings),
        ),
        "rollup": pick(
            settings.rollup_transport,
            rollup_mock.MockRollupAdapter,
            None,
            lambda: rollup_llm.TextLLMRollupAdapter.from_settings(settings),
        ),
        # Open-vocabulary candidate detector is optional and additive. It runs
        # only behind its own SageMaker endpoint (it has no local build here).
        "open_vocab_detector": (
            detector_gdino.GroundingDINOAdapter(
                sagemaker_endpoint=settings.detector_gdino_sagemaker_endpoint,
                region=settings.aws_region,
            )
            if settings.detector_gdino_sagemaker_endpoint
            else None
        ),
    }
