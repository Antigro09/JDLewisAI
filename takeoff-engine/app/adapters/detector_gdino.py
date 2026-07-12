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

import inspect

from app.adapters.base import DetectorAdapter
from app.adapters.transport import AdapterNotConfigured, SageMakerTransport
from app.schemas.detection import DetectedObject

_INSTALL = "pip install -e '.[vision]'  (transformers + torch), then set TAKEOFF_DETECTOR_MODEL=grounding_dino"

LABEL_ALIASES = {
    "drawing_area": ("drawing area", "floor plan", "plan area", "architectural plan"),
    "title_block": ("title block", "sheet title block", "project information box"),
    "notes": ("notes", "general notes", "specification notes"),
    "legend": ("legend", "symbol legend"),
    "schedule": ("schedule", "door schedule", "window schedule", "finish schedule"),
    "floor_area": ("floor area", "room area", "open floor area", "floor finish area"),
    "wall": ("wall", "wall segment", "partition wall"),
    "square_column": ("square column", "rectangular column"),
    "round_column": ("round column", "circular column"),
    "door": ("door", "door symbol"),
    "window": ("window", "window symbol"),
}


def normalize_phrase(phrase: str) -> str:
    s = phrase.lower().strip().replace("-", " ")
    for label, aliases in LABEL_ALIASES.items():
        if any(alias in s for alias in aliases):
            return label
    return s.replace(" symbol", "").replace(" ", "_")


def post_process_grounded_detection(
    processor,
    outputs,
    input_ids,
    *,
    box_threshold: float,
    text_threshold: float,
    target_sizes,
):
    """Call HF GroundingDINO post-processing across Transformers versions.

    Transformers 4.x used `box_threshold`; the installed 5.x processor uses
    `threshold`. Build kwargs from the actual callable signature instead of
    relying on one version's parameter names.
    """
    fn = processor.post_process_grounded_object_detection
    params = inspect.signature(fn).parameters
    kwargs = {}
    if "input_ids" in params:
        kwargs["input_ids"] = input_ids
    if "box_threshold" in params:
        kwargs["box_threshold"] = box_threshold
    elif "threshold" in params:
        kwargs["threshold"] = box_threshold
    if "text_threshold" in params:
        kwargs["text_threshold"] = text_threshold
    if "target_sizes" in params:
        kwargs["target_sizes"] = target_sizes
    return fn(outputs, **kwargs)[0]


class GroundingDINOAdapter(DetectorAdapter):
    name = "grounding-dino"

    def __init__(
        self,
        sagemaker_endpoint: str = "",
        region: str = "us-east-1",
        model_id: str = "IDEA-Research/grounding-dino-base",
        device: str = "auto",
        box_threshold: float = 0.25,
        text_threshold: float = 0.25,
    ):
        self.transport = SageMakerTransport(sagemaker_endpoint, region) if sagemaker_endpoint else None
        self.model_id = model_id
        self.device = device.lower().strip() or "auto"
        self.box_threshold = box_threshold
        self.text_threshold = text_threshold
        self._processor = None
        self._model = None

    def _resolve_torch_device(self, torch) -> str:
        if self.device in {"npu", "amd_npu", "ryzen_ai"}:
            raise AdapterNotConfigured(
                "AMD NPU",
                "The local GroundingDINO adapter uses PyTorch/Transformers, which cannot target "
                "the Ryzen AI NPU by changing TAKEOFF_DETECTOR_DEVICE. Use "
                "TAKEOFF_DETECTOR_DEVICE=auto or cpu for this adapter, or add an ONNX Runtime "
                "Ryzen AI/Vitis AI adapter with an optimized ONNX model.",
            )
        if self.device == "auto":
            return "cuda" if torch.cuda.is_available() else "cpu"
        if self.device == "cuda":
            return "cuda" if torch.cuda.is_available() else "cpu"
        if self.device == "cpu":
            return "cpu"
        raise AdapterNotConfigured(
            "GroundingDINO device",
            f"Unsupported TAKEOFF_DETECTOR_DEVICE={self.device!r}. Use auto, cpu, or cuda.",
        )

    def _local_model(self):
        if self._model is None or self._processor is None:
            try:
                import torch
                from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor
            except ImportError as e:
                raise AdapterNotConfigured("GroundingDINO", _INSTALL) from e
            self._torch = torch
            self.device = self._resolve_torch_device(torch)
            self._processor = AutoProcessor.from_pretrained(self.model_id)
            self._model = AutoModelForZeroShotObjectDetection.from_pretrained(self.model_id)
            if self.device != "cpu":
                self._model = self._model.to(self.device)
            self._model.eval()
        return self._processor, self._model

    def detect(self, image, sheet_id, px_per_pt, vocabulary=None) -> list[DetectedObject]:
        if self.transport is None:
            return self._detect_local(image, sheet_id, px_per_pt, vocabulary)
        return self._detect_remote(image, sheet_id, px_per_pt, vocabulary)

    def _caption(self, vocabulary=None) -> str:
        terms = vocabulary or [alias for aliases in LABEL_ALIASES.values() for alias in aliases[:1]]
        return " . ".join(terms)

    def _detect_remote(self, image, sheet_id, px_per_pt, vocabulary=None) -> list[DetectedObject]:
        import base64

        import cv2

        caption = self._caption(vocabulary)
        ok, buf = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 92])
        if not ok:
            raise RuntimeError("failed to encode image for GroundingDINO endpoint")
        resp = self.transport.invoke(
            {
                "image_b64": base64.b64encode(buf.tobytes()).decode(),
                "caption": caption,
                "box_threshold": self.box_threshold,
                "text_threshold": self.text_threshold,
            }
        )
        return [
            DetectedObject(
                sheet_id=sheet_id,
                label=normalize_phrase(d["phrase"]),
                bbox=tuple(v / px_per_pt for v in d["bbox_px"]),
                confidence=d["confidence"] * 0.85,  # open-vocab discount vs fine-tuned detector
                detector=self.name,
            )
            for d in resp.get("detections", [])
        ]

    def _detect_local(self, image, sheet_id, px_per_pt, vocabulary=None) -> list[DetectedObject]:
        from PIL import Image

        processor, model = self._local_model()
        rgb = image[..., ::-1]
        pil = Image.fromarray(rgb)
        text = self._caption(vocabulary)
        inputs = processor(images=pil, text=text, return_tensors="pt")
        inputs = {k: v.to(self.device) if hasattr(v, "to") else v for k, v in inputs.items()}
        with self._torch.no_grad():
            outputs = model(**inputs)
        target_sizes = self._torch.tensor([pil.size[::-1]], device=self.device)
        results = post_process_grounded_detection(
            processor,
            outputs,
            inputs.get("input_ids"),
            box_threshold=self.box_threshold,
            text_threshold=self.text_threshold,
            target_sizes=target_sizes,
        )
        labels = results.get("text_labels", results.get("labels", []))
        scores = results.get("scores", [])
        boxes = results.get("boxes", [])
        out: list[DetectedObject] = []
        for label, score, box in zip(labels, scores, boxes, strict=False):
            phrase = label if isinstance(label, str) else str(label)
            out.append(
                DetectedObject(
                    sheet_id=sheet_id,
                    label=normalize_phrase(phrase),
                    bbox=tuple(float(v) / px_per_pt for v in box.tolist()),
                    confidence=float(score) * 0.85,
                    detector=self.name,
                )
            )
        return out
