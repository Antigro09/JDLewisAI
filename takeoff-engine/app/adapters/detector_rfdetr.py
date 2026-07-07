"""RF-DETR adapter — primary (non-YOLO) detector, Apache-2.0.

Out of the box RF-DETR ships COCO classes, which are useless on drawings;
production use REQUIRES fine-tuning on construction symbols (see
docs/fine-tuning-roadmap.md). The class list below is the fine-tuning target
taxonomy and the label contract the pipeline consumes.

Run modes:
  local      — pip install -e '.[detect]'; RF-DETR base runs on CPU/GPU.
  sagemaker  — deploy the fine-tuned checkpoint; RF-DETR base fits
               serverless (send crops < 6 MB).

SageMaker payload contract:
  request : {"image_b64": ..., "threshold": 0.4}
  response: {"detections": [{"label","bbox_px":[x0,y0,x1,y1],"confidence"}]}
"""

from __future__ import annotations

from app.adapters.base import DetectorAdapter
from app.adapters.transport import AdapterNotConfigured, SageMakerTransport
from app.schemas.detection import DetectedObject

CONSTRUCTION_CLASSES = [
    "room", "slab", "wall", "door", "window", "room_label", "finish_tag",
    "dimension", "callout", "scale_bar", "north_arrow", "schedule_ref", "symbol",
]

_INSTALL = "pip install -e '.[detect]'  (rfdetr + torch)"


class RFDETRAdapter(DetectorAdapter):
    name = "rf-detr"

    def __init__(self, sagemaker_endpoint: str = "", region: str = "us-east-1",
                 checkpoint: str = "", threshold: float = 0.4):
        self.threshold = threshold
        self.transport = None
        self._model = None
        self.checkpoint = checkpoint
        if sagemaker_endpoint:
            self.transport = SageMakerTransport(sagemaker_endpoint, region)

    def _local_model(self):
        if self._model is None:
            try:
                from rfdetr import RFDETRBase
            except ImportError as e:
                raise AdapterNotConfigured("RF-DETR", _INSTALL) from e
            self._model = (
                RFDETRBase(pretrain_weights=self.checkpoint) if self.checkpoint else RFDETRBase()
            )
        return self._model

    def detect(self, image, sheet_id, px_per_pt, vocabulary=None) -> list[DetectedObject]:
        if self.transport is not None:
            return self._detect_remote(image, sheet_id, px_per_pt)
        return self._detect_local(image, sheet_id, px_per_pt)

    def _detect_local(self, image, sheet_id, px_per_pt) -> list[DetectedObject]:
        model = self._local_model()
        detections = model.predict(image[..., ::-1], threshold=self.threshold)  # BGR→RGB
        out = []
        for xyxy, cls_id, conf in zip(
            detections.xyxy, detections.class_id, detections.confidence, strict=True
        ):
            label = (
                CONSTRUCTION_CLASSES[int(cls_id)]
                if self.checkpoint and int(cls_id) < len(CONSTRUCTION_CLASSES)
                else f"coco_{int(cls_id)}"  # un-finetuned checkpoints are only smoke tests
            )
            out.append(
                DetectedObject(
                    sheet_id=sheet_id,
                    label=label,
                    bbox=tuple(float(v) / px_per_pt for v in xyxy),
                    confidence=float(conf),
                    detector=self.name,
                )
            )
        return out

    def _detect_remote(self, image, sheet_id, px_per_pt) -> list[DetectedObject]:
        from app.adapters.transport import encode_image_capped

        b64, scale = encode_image_capped(image, ".jpg")
        eff = px_per_pt * scale  # returned bbox_px are in the (downscaled) sent frame
        resp = self.transport.invoke({"image_b64": b64, "threshold": self.threshold})
        return [
            DetectedObject(
                sheet_id=sheet_id,
                label=d["label"],
                bbox=tuple(v / eff for v in d["bbox_px"]),
                confidence=d["confidence"],
                detector=self.name,
            )
            for d in resp.get("detections", [])
        ]
