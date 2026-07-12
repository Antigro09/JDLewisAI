import os

# Test environment: in-memory SQLite, local scratch storage, mock adapters.
os.environ.setdefault("TAKEOFF_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("TAKEOFF_JOB_QUEUE", "inline")
os.environ.setdefault("TAKEOFF_OCR_TRANSPORT", "mock")
os.environ.setdefault("TAKEOFF_VLM_TRANSPORT", "mock")
os.environ.setdefault("TAKEOFF_DETECTOR_TRANSPORT", "mock")
os.environ.setdefault("TAKEOFF_DETECTOR_MODEL", "mock")
os.environ.setdefault("TAKEOFF_DETECTOR_DEVICE", "auto")
os.environ.setdefault("TAKEOFF_SEGMENTER_TRANSPORT", "mock")
os.environ.setdefault("TAKEOFF_ROLLUP_TRANSPORT", "mock")

import pytest

from app.config import Settings, get_settings


@pytest.fixture
def settings(tmp_path) -> Settings:
    get_settings.cache_clear()
    os.environ["TAKEOFF_STORAGE_ROOT"] = str(tmp_path / "data")
    s = get_settings()
    yield s
    get_settings.cache_clear()
