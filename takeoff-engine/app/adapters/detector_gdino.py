"""GroundingDINO — optional open-vocabulary candidate detector.

Useful before the RF-DETR fine-tune exists: prompt with text like
"door symbol . window symbol . room" to get rough candidates for SAM 2.
Candidates from this path carry lower base confidence than a fine-tuned
detector and always go through geometry refinement + review flags.

License note: GroundingDINO code is Apache-2.0; keep it an optional extra.

SageMaker payload contract:
  request : {"image_b64": ..., "caption": "door . window . room", "box_threshold": 0.3}
  response: {"detections": [{"phrase","bbox_px","confidence"}]}
"""

from __future__ import annotations

from app.adapters.base import DetectorAdapter
from app.adapters.transport import AdapterNotConfigured, SageMakerTransport
from app.schemas.detection import DetectedObject


class GroundingDINOAdapter(DetectorAdapter):
    name = "grounding-dino"

    def __init__(self, sagemaker_endpoint: str = "", region: str = "us-east-1"):
        if not sagemaker_endpoint:
            raise AdapterNotConfigured(
                "GroundingDINO",
                "Deploy it behind a SageMaker endpoint (see docs/adapters.md) and set "
                "the endpoint name, or vendor the local pipeline yourself — the local "
                "package has heavyweight CUDA build steps we don't force on the core install.",
            )
        self.transport = SageMakerTransport(sagemaker_endpoint, region)

    def detect(self, image, sheet_id, px_per_pt, vocabulary=None) -> list[DetectedObject]:
        import base64

        import cv2

        caption = " . ".join(vocabulary or ["room", "door symbol", "window symbol"])
        ok, buf = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 92])
        if not ok:
            raise RuntimeError("failed to encode image for GroundingDINO endpoint")
        resp = self.transport.invoke(
            {
                "image_b64": base64.b64encode(buf.tobytes()).decode(),
                "caption": caption,
                "box_threshold": 0.3,
            }
        )
        return [
            DetectedObject(
                sheet_id=sheet_id,
                label=d["phrase"].replace(" symbol", "").replace(" ", "_"),
                bbox=tuple(v / px_per_pt for v in d["bbox_px"]),
                confidence=d["confidence"] * 0.85,  # open-vocab discount vs fine-tuned detector
                detector=self.name,
            )
            for d in resp.get("detections", [])
        ]
