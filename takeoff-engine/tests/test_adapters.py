import numpy as np
import pytest

from app.adapters.base import build_adapters
from app.adapters.segmenter_mock import MockSegmenterAdapter
from app.adapters.transport import AdapterNotConfigured
from app.config import Settings


def _settings(**kw) -> Settings:
    return Settings(database_url="sqlite:///:memory:", **kw)


class TestBuildAdapters:
    def test_mock_default_builds(self):
        a = build_adapters(_settings())
        assert all(a[k] for k in ("ocr", "detector", "segmenter", "vlm", "rollup"))
        assert a["open_vocab_detector"] is None

    def test_local_detector_stack_builds_without_crash(self):
        # OCR/RF-DETR/SAM2 have a lazy in-process path (construct now, load on use);
        # GroundingDINO must NOT be eagerly built with an empty endpoint.
        a = build_adapters(
            _settings(ocr_transport="local", detector_transport="local", segmenter_transport="local")
        )
        assert a["open_vocab_detector"] is None

    def test_vlm_local_raises_clear_error(self):
        # The VLM has no in-process 'local' mode — must fail loudly, not TypeError.
        with pytest.raises(AdapterNotConfigured):
            build_adapters(_settings(vlm_transport="local"))

    def test_rollup_local_raises_clear_error(self):
        with pytest.raises(AdapterNotConfigured):
            build_adapters(_settings(rollup_transport="local"))


class TestSegmenterCardinality:
    def test_one_mask_per_box_including_degenerate(self):
        seg = MockSegmenterAdapter()
        img = np.full((200, 200, 3), 255, np.uint8)
        # Middle box is sub-pixel/degenerate — it must NOT be dropped (which would
        # shift every later mask's box association).
        boxes = [(10, 10, 100, 100), (0.0, 0.0, 0.4, 0.4), (120, 120, 180, 180)]
        masks = seg.segment(img, "s1", 1.0, boxes)
        assert len(masks) == len(boxes)
        assert [m.source_box_index for m in masks] == [0, 1, 2]
        assert all(m.polygons for m in masks)
