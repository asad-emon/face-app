import os
from threading import Lock
from typing import Optional, Tuple

import onnxruntime as ort
from huggingface_hub import hf_hub_download
from insightface import model_zoo
from insightface.app import FaceAnalysis

from .observability import get_logger, timed_log
from .settings import Settings, get_settings


ModelTuple = Tuple[FaceAnalysis, object]
logger = get_logger("inference.model_registry")


class ModelRegistry:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._lock = Lock()
        self._models: Optional[ModelTuple] = None
        self._gpen_session: Optional[ort.InferenceSession] = None
        self._current_det_size: Optional[int] = None

    def _download_model(self, filename: str) -> str:
        local_path = os.path.join(self._settings.local_model_dir, filename)
        if os.path.exists(local_path):
            logger.info(
                "model_cache_hit",
                extra={
                    "event": "model_cache_hit",
                    "model_filename": filename,
                    "path": local_path,
                },
            )
            return local_path

        os.makedirs(self._settings.local_model_dir, exist_ok=True)
        with timed_log(logger, "model_download", model_filename=filename):
            return hf_hub_download(
                repo_id=self._settings.model_repo,
                filename=filename,
                local_dir=self._settings.local_model_dir,
            )

    def _initialize_models(self) -> ModelTuple:
        with timed_log(logger, "model_initialize"):
            face_analyzer = FaceAnalysis(
                name="buffalo_sc",
                allowed_modules=["detection", "recognition"],
                providers=["CPUExecutionProvider"],
            )
            initial_det_size = self._settings.detection_size_min
            face_analyzer.prepare(
                ctx_id=0,
                det_size=(initial_det_size, initial_det_size),
            )
            self._current_det_size = initial_det_size

            inswapper_path = self._download_model("inswapper_128.onnx")
            swapper = model_zoo.get_model(
                inswapper_path,
                providers=["CPUExecutionProvider"],
            )

            return face_analyzer, swapper

    def preload_assets(self) -> None:
        self.get_models()
        self.get_gpen_session()
        logger.info("preload_complete", extra={"event": "preload_complete"})

    def get_models(self) -> ModelTuple:
        if self._models is None:
            with self._lock:
                if self._models is None:
                    self._models = self._initialize_models()
        return self._models

    def get_face_analyzer(self) -> FaceAnalysis:
        return self.get_models()[0]

    def prepare_face_analyzer_for_image(self, image_shape) -> None:
        height, width = image_shape[:2]
        det_size = self._settings.detection_size_for_image(width=width, height=height)
        if det_size == self._current_det_size:
            return

        face_analyzer = self.get_face_analyzer()
        with self._lock:
            if det_size == self._current_det_size:
                return
            face_analyzer.prepare(
                ctx_id=0,
                det_size=(det_size, det_size),
            )
            self._current_det_size = det_size
            logger.info(
                "detector_prepared",
                extra={"event": "detector_prepared", "detection_size": det_size},
            )

    def get_swapper(self):
        return self.get_models()[1]

    def get_gpen_session(self) -> Optional[ort.InferenceSession]:
        if self._gpen_session is None:
            with self._lock:
                if self._gpen_session is None:
                    with timed_log(logger, "gpen_initialize"):
                        gpen_path = self._download_model("GPEN-BFR-512.onnx")
                        self._gpen_session = ort.InferenceSession(
                            gpen_path,
                            providers=["CPUExecutionProvider"],
                        )
        return self._gpen_session


_REGISTRY: Optional[ModelRegistry] = None
_REGISTRY_LOCK = Lock()


def get_model_registry() -> ModelRegistry:
    global _REGISTRY
    if _REGISTRY is None:
        with _REGISTRY_LOCK:
            if _REGISTRY is None:
                _REGISTRY = ModelRegistry(get_settings())
    return _REGISTRY
