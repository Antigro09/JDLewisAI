import numpy as np
import pytest

from app.adapters.base import build_adapters
from app.adapters.detector_gdino import GroundingDINOAdapter, post_process_grounded_detection
from app.adapters.rollup_mock import BUILTIN_ASSEMBLIES
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

    def test_local_checkpoints_thread_through(self):
        # The downloaded-weights paths from config reach the adapters.
        a = build_adapters(_settings(
            detector_transport="local", detector_checkpoint="/models/rfdetr.pth",
            segmenter_transport="local", segmenter_checkpoint="/models/sam2.pt",
        ))
        assert a["detector"].checkpoint == "/models/rfdetr.pth"
        assert a["segmenter"].checkpoint == "/models/sam2.pt"

    def test_vlm_local_raises_clear_error(self):
        # The VLM has no in-process 'local' mode — must fail loudly, not TypeError.
        with pytest.raises(AdapterNotConfigured):
            build_adapters(_settings(vlm_transport="local"))

    def test_rollup_local_raises_clear_error(self):
        with pytest.raises(AdapterNotConfigured):
            build_adapters(_settings(rollup_transport="local"))


class TestMockRollup:
    def test_builtin_assembly_names_are_export_safe_ascii(self):
        for row in BUILTIN_ASSEMBLIES.values():
            assert "�" not in row.assembly_name
            row.assembly_name.encode("ascii")


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


class TestGroundingDINOPostProcess:
    def test_supports_transformers_threshold_signature(self):
        class Processor:
            def post_process_grounded_object_detection(
                self, outputs, input_ids=None, threshold=0.25, text_threshold=0.25, target_sizes=None
            ):
                return [{
                    "outputs": outputs,
                    "input_ids": input_ids,
                    "threshold": threshold,
                    "text_threshold": text_threshold,
                    "target_sizes": target_sizes,
                }]

        result = post_process_grounded_detection(
            Processor(), "out", "ids",
            box_threshold=0.42, text_threshold=0.31, target_sizes="sizes",
        )

        assert result["threshold"] == 0.42
        assert result["text_threshold"] == 0.31
        assert result["input_ids"] == "ids"

    def test_supports_legacy_box_threshold_signature(self):
        class Processor:
            def post_process_grounded_object_detection(
                self, outputs, input_ids=None, box_threshold=0.25, text_threshold=0.25, target_sizes=None
            ):
                return [{
                    "box_threshold": box_threshold,
                    "text_threshold": text_threshold,
                }]

        result = post_process_grounded_detection(
            Processor(), "out", "ids",
            box_threshold=0.42, text_threshold=0.31, target_sizes="sizes",
        )

        assert result["box_threshold"] == 0.42
        assert result["text_threshold"] == 0.31


class TestGroundingDINOLocalLabels:
    def test_prefers_text_labels_from_current_transformers(self, monkeypatch):
        class Tensor:
            def to(self, _device):
                return self

        class Box:
            def tolist(self):
                return [10.0, 20.0, 30.0, 40.0]

        class NoGrad:
            def __enter__(self):
                return None

            def __exit__(self, *_args):
                return None

        class Torch:
            @staticmethod
            def no_grad():
                return NoGrad()

            @staticmethod
            def tensor(value, device=None):
                return value

        class Processor:
            def __call__(self, **_kwargs):
                return {"input_ids": Tensor()}

        class Model:
            def __call__(self, **_kwargs):
                return object()

        adapter = GroundingDINOAdapter(device="cpu")
        adapter._torch = Torch()
        adapter._processor = Processor()
        adapter._model = Model()
        monkeypatch.setattr(
            "app.adapters.detector_gdino.post_process_grounded_detection",
            lambda *_args, **_kwargs: {
                "text_labels": ["door"],
                "labels": [17],
                "scores": [0.8],
                "boxes": [Box()],
            },
        )

        detections = adapter._detect_local(
            np.full((50, 50, 3), 255, np.uint8), "s1", 2.0, ["door"]
        )

        assert len(detections) == 1
        assert detections[0].label == "door"
        assert detections[0].bbox == (5.0, 10.0, 15.0, 20.0)
