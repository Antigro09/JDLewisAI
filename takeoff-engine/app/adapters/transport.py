"""Model endpoint transports.

Every model adapter talks to its backend through a ModelTransport so the same
adapter code runs against:
  - MockTransport        — canned responses; zero model downloads.
  - SageMakerTransport   — AWS SageMaker serverless/real-time endpoints
                           (the primary hosted path for this project).
  - OpenAICompatTransport— any OpenAI-compatible HTTP server (vLLM, TGI).

SageMaker serverless caveats (documented in docs/adapters.md):
  - synchronous invoke payload limit is ~6 MB → send region CROPS, not full
    600-DPI sheets; JPEG/PNG-encode and downscale before invoking.
  - cold starts of tens of seconds are normal; keep retries patient.
  - large VLMs (Qwen3-VL-32B/72B) exceed serverless limits — host those on
    real-time endpoints or an external vLLM box and use OpenAICompatTransport.
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from typing import Any


class AdapterNotConfigured(RuntimeError):
    """Raised by real adapter stubs that need a model endpoint or extra deps."""

    def __init__(self, what: str, how: str):
        super().__init__(f"{what} is not configured. {how}")


def encode_image_capped(image, ext: str = ".jpg", max_dim: int = 2600, jpeg_quality: int = 90):
    """Base64-encode an image, downscaling the longest side to ``max_dim`` so the
    payload stays under SageMaker serverless's ~6 MB synchronous invoke limit.

    Returns ``(b64, scale)`` where ``scale = encoded_px / original_px``. Callers
    MUST divide returned pixel coordinates by ``px_per_pt * scale`` (and multiply
    any sent pixel coordinates by ``scale``) so geometry lands in page points.
    """
    import base64

    import cv2

    h, w = image.shape[:2]
    longest = max(h, w)
    scale = 1.0
    if longest > max_dim:
        scale = max_dim / longest
        image = cv2.resize(image, (max(1, round(w * scale)), max(1, round(h * scale))))
    params = [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality] if ext.lower() in (".jpg", ".jpeg") else []
    ok, buf = cv2.imencode(ext, image, params)
    if not ok:
        raise RuntimeError(f"failed to encode image ({ext})")
    return base64.b64encode(buf.tobytes()).decode(), scale


class ModelTransport(ABC):
    @abstractmethod
    def invoke(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Send a JSON-serializable payload, get a JSON dict back.
        Binary image data must be base64-encoded inside the payload."""


class MockTransport(ModelTransport):
    def __init__(self, responder=None):
        self.responder = responder
        self.calls: list[dict[str, Any]] = []

    def invoke(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(payload)
        return self.responder(payload) if self.responder else {}


class SageMakerTransport(ModelTransport):
    """Invokes a SageMaker endpoint via sagemaker-runtime.

    Credentials come from the standard boto3 chain (env vars, instance
    profile, ~/.aws). Configure the endpoint name per adapter, e.g.
    TAKEOFF_DETECTOR_SAGEMAKER_ENDPOINT=rf-detr-construction.
    """

    def __init__(self, endpoint_name: str, region: str, content_type: str = "application/json"):
        if not endpoint_name:
            raise AdapterNotConfigured(
                "SageMaker transport",
                "Set the TAKEOFF_*_SAGEMAKER_ENDPOINT env var for this adapter "
                "and install the extra: pip install -e '.[sagemaker]'",
            )
        try:
            import boto3
        except ImportError as e:
            raise AdapterNotConfigured(
                "boto3", "pip install -e '.[sagemaker]'"
            ) from e
        self.endpoint_name = endpoint_name
        self.content_type = content_type
        self.client = boto3.client("sagemaker-runtime", region_name=region)

    def invoke(self, payload: dict[str, Any]) -> dict[str, Any]:
        resp = self.client.invoke_endpoint(
            EndpointName=self.endpoint_name,
            ContentType=self.content_type,
            Body=json.dumps(payload).encode("utf-8"),
        )
        return json.loads(resp["Body"].read())


class OpenAICompatTransport(ModelTransport):
    """Chat-completions against any OpenAI-compatible server (vLLM/TGI/hosted).

    payload: {"messages": [...], "response_format": optional, ...}
    returns: {"content": str} (first choice message content).
    """

    def __init__(self, base_url: str, model: str, api_key: str = "not-needed"):
        if not base_url:
            raise AdapterNotConfigured(
                "OpenAI-compatible transport",
                "Set TAKEOFF_*_OPENAI_BASE_URL (e.g. a vLLM server URL) and "
                "install the extra: pip install -e '.[vlm]'",
            )
        try:
            from openai import OpenAI
        except ImportError as e:
            raise AdapterNotConfigured("openai client", "pip install -e '.[vlm]'") from e
        self.model = model
        self.client = OpenAI(base_url=base_url, api_key=api_key)

    def invoke(self, payload: dict[str, Any]) -> dict[str, Any]:
        resp = self.client.chat.completions.create(
            model=payload.get("model", self.model),
            messages=payload["messages"],
            temperature=payload.get("temperature", 0.0),
            max_tokens=payload.get("max_tokens", 2048),
        )
        return {"content": resp.choices[0].message.content or ""}
