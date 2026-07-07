"""SAM 2 adapter — promptable segmentation from detector boxes/points.

Run modes:
  local      — pip install -e '.[segment]'; sam2 hiera-small/base on CPU/GPU.
  sagemaker  — the image encoder + mask decoder fit a serverless endpoint;
               send the CROP around each box, not the whole sheet.

SageMaker payload contract:
  request : {"image_b64": ..., "boxes_px": [[x0,y0,x1,y1], ...]}
  response: {"masks": [{"polygons_px": [[[x,y],...]], "confidence": float}]}

Masks are converted to polygons in page points via OpenCV; the deterministic
geometry engine — not SAM — is what produces measured areas.
"""

from __future__ import annotations

import numpy as np

from app.adapters.base import SegmenterAdapter
from app.adapters.transport import AdapterNotConfigured, SageMakerTransport
from app.geometry.raster import clean_mask, mask_to_polygons
from app.schemas.detection import SegmentationMask

_INSTALL = "pip install -e '.[segment]'  (sam2 + torch), then set TAKEOFF_SAM2_CHECKPOINT"


class SAM2Adapter(SegmenterAdapter):
    name = "sam2"

    def __init__(self, sagemaker_endpoint: str = "", region: str = "us-east-1",
                 checkpoint: str = "", model_cfg: str = "sam2_hiera_s.yaml"):
        self.transport = None
        self._predictor = None
        self.checkpoint = checkpoint
        self.model_cfg = model_cfg
        if sagemaker_endpoint:
            self.transport = SageMakerTransport(sagemaker_endpoint, region)

    def _local_predictor(self):
        if self._predictor is None:
            try:
                from sam2.build_sam import build_sam2
                from sam2.sam2_image_predictor import SAM2ImagePredictor
            except ImportError as e:
                raise AdapterNotConfigured("SAM 2", _INSTALL) from e
            if not self.checkpoint:
                raise AdapterNotConfigured("SAM 2 checkpoint", _INSTALL)
            self._predictor = SAM2ImagePredictor(build_sam2(self.model_cfg, self.checkpoint))
        return self._predictor

    def segment(self, image, sheet_id, px_per_pt, boxes) -> list[SegmentationMask]:
        if self.transport is not None:
            return self._segment_remote(image, sheet_id, px_per_pt, boxes)
        return self._segment_local(image, sheet_id, px_per_pt, boxes)

    def _segment_local(self, image, sheet_id, px_per_pt, boxes) -> list[SegmentationMask]:
        predictor = self._local_predictor()
        predictor.set_image(image[..., ::-1])  # BGR→RGB
        out: list[SegmentationMask] = []
        for i, box in enumerate(boxes):
            box_px = np.array([v * px_per_pt for v in box])
            masks, scores, _ = predictor.predict(box=box_px, multimask_output=False)
            mask = clean_mask(masks[0].astype(np.uint8) * 255)
            out.append(
                SegmentationMask(
                    sheet_id=sheet_id,
                    polygons=mask_to_polygons(mask, px_per_pt),
                    confidence=float(scores[0]),
                    segmenter=self.name,
                    prompt_kind="box",
                    source_box_index=i,
                )
            )
        return out

    def _segment_remote(self, image, sheet_id, px_per_pt, boxes) -> list[SegmentationMask]:
        from app.adapters.transport import encode_image_capped

        b64, scale = encode_image_capped(image, ".png")
        eff = px_per_pt * scale  # sent boxes and returned polygons are in the downscaled frame
        resp = self.transport.invoke(
            {
                "image_b64": b64,
                "boxes_px": [[v * eff for v in b] for b in boxes],
            }
        )
        return [
            SegmentationMask(
                sheet_id=sheet_id,
                polygons=[
                    [(x / eff, y / eff) for x, y in ring]
                    for ring in m["polygons_px"]
                ],
                confidence=m.get("confidence", 0.0),
                segmenter=self.name,
                prompt_kind="box",
                source_box_index=m.get("box_index", i),
            )
            for i, m in enumerate(resp.get("masks", []))
        ]
