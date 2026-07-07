"""Engine configuration.

All settings come from environment variables prefixed TAKEOFF_ (or a .env file).
The engine owns its own Postgres database — create a `takeoff` database inside
the same cluster the main app uses and point TAKEOFF_DATABASE_URL at it. The
engine never touches the app's tables.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

Transport = Literal["mock", "sagemaker", "openai_compat", "local"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="TAKEOFF_", env_file=".env", extra="ignore")

    # --- infrastructure -------------------------------------------------
    database_url: str = "postgresql+psycopg://takeoff:takeoff@localhost:5433/takeoff"
    storage_root: Path = Path("data")
    job_queue: Literal["local", "rq"] = "local"
    redis_url: str = "redis://localhost:6379/0"

    # --- rendering -------------------------------------------------------
    render_dpi: int = 150          # default page raster DPI
    max_render_dpi: int = 400
    thumbnail_dpi: int = 72

    # --- adapter selection ----------------------------------------------
    ocr_transport: Transport = "mock"
    vlm_transport: Transport = "mock"
    detector_transport: Transport = "mock"
    segmenter_transport: Transport = "mock"
    rollup_transport: Transport = "mock"

    # SageMaker endpoints (primary hosted-model path). Each adapter invokes
    # its own serverless/real-time endpoint via sagemaker-runtime.
    aws_region: str = "us-east-1"
    ocr_sagemaker_endpoint: str = ""
    vlm_sagemaker_endpoint: str = ""          # e.g. qwen3-vl-8b (real-time; too big for serverless)
    detector_sagemaker_endpoint: str = ""     # e.g. rf-detr-construction
    detector_gdino_sagemaker_endpoint: str = ""  # optional open-vocab bootstrap
    segmenter_sagemaker_endpoint: str = ""    # e.g. sam2-hiera-base
    rollup_sagemaker_endpoint: str = ""       # e.g. llama-3-3-70b (real-time)

    # OpenAI-compatible endpoints (vLLM/TGI alternative to SageMaker).
    vlm_openai_base_url: str = ""
    vlm_openai_model: str = "Qwen/Qwen3-VL-8B-Instruct"
    rollup_openai_base_url: str = ""
    rollup_openai_model: str = "meta-llama/Llama-3.3-70B-Instruct"
    openai_api_key: str = "not-needed-for-self-hosted"

    # --- confidence & review thresholds ----------------------------------
    review_confidence_threshold: float = 0.75   # final confidence below this → needs_review
    min_scale_confidence: float = 0.5           # below this the sheet is treated as scale-less
    scale_dimension_conflict_pct: float = 5.0   # OCR scale vs known dimension disagreement (%)
    version_delta_review_pct: float = 15.0      # quantity change vs previous version (%)
    label_max_distance_ft: float = 3.0          # room label farther than this outside polygon
    mask_line_overreach_ratio: float = 0.35     # SAM mask touching unrelated line regions
    min_polygon_area_sqft: float = 1.0          # plausibility floor
    max_polygon_area_sqft: float = 500_000.0    # plausibility ceiling

    # --- estimating defaults ---------------------------------------------
    default_flooring_waste_factor: float = 1.10
    default_slab_thickness_in: float = 4.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
