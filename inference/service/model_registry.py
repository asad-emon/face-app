import os
from threading import Lock
from typing import Optional, Tuple

import onnxruntime as ort
from huggingface_hub import _CACHED_NO_EXIST, hf_hub_download, try_to_load_from_cache
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
        self._hyperswap_session: Optional[ort.InferenceSession] = None
        self._occluder_session: Optional[ort.InferenceSession] = None
        self._occluder_unavailable = False
        self._current_det_size: Optional[int] = None

    def _download_model(self, filename: str) -> str:
        cached_path = try_to_load_from_cache(
            repo_id=self._settings.model_repo,
            filename=filename,
            cache_dir=self._settings.local_model_dir,
        )
        if isinstance(cached_path, str):
            logger.info(
                "model_cache_hit",
                extra={
                    "event": "model_cache_hit",
                    "model_filename": filename,
                    "path": cached_path,
                },
            )
            return cached_path

        if cached_path is _CACHED_NO_EXIST:
            # A "missing" marker only records what the repo looked like at the
            # revision we last resolved locally; the file may have been
            # uploaded since. Re-check against the hub instead of failing.
            logger.info(
                "model_cache_miss_recheck",
                extra={
                    "event": "model_cache_miss_recheck",
                    "model_filename": filename,
                },
            )

        os.makedirs(self._settings.local_model_dir, exist_ok=True)
        with timed_log(logger, "model_download", model_filename=filename):
            return hf_hub_download(
                repo_id=self._settings.model_repo,
                filename=filename,
                cache_dir=self._settings.local_model_dir,
            )

    def _initialize_models(self) -> ModelTuple:
        with timed_log(logger, "model_initialize"):
            # buffalo_l includes detection, recognition, genderage AND the
            # 106-point landmark module used to build the face mask.
            face_analyzer = FaceAnalysis(
                name="buffalo_l",
                allowed_modules=[
                    "detection",
                    "recognition",
                    "genderage",
                    "landmark_2d_106",
                ],
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
        self.get_hyperswap_session()
        self.get_occluder_session()
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

    def warmup_for_frames(
        self,
        image_shape,
        restore: bool = False,
        hyperswap: bool = False,
    ) -> None:
        """Load and configure every model a swap will touch, up front.

        Worth calling before handing frames to a worker pool.
        `prepare_face_analyzer_for_image` mutates detector state, and doing it
        here - while nothing else is running - means the workers only ever hit
        its early-return path. Lazily loading a session from several threads at
        once is safe but wasteful, so those are forced here too.
        """
        self.get_models()
        self.prepare_face_analyzer_for_image(image_shape)
        if restore:
            self.get_gpen_session()
        if hyperswap:
            self.get_hyperswap_session()
        self.get_occluder_session()
        logger.info(
            "warmup_complete",
            extra={
                "event": "warmup_complete",
                "restore": restore,
                "hyperswap": hyperswap,
            },
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

    def get_hyperswap_session(self) -> Optional[ort.InferenceSession]:
        if self._hyperswap_session is None:
            with self._lock:
                if self._hyperswap_session is None:
                    with timed_log(logger, "hyperswap_initialize"):
                        hyperswap_path = self._download_model("Hyperswap_1b_256.onnx")
                        self._hyperswap_session = ort.InferenceSession(
                            hyperswap_path,
                            providers=["CPUExecutionProvider"],
                        )
        return self._hyperswap_session

    def get_occluder_session(self) -> Optional[ort.InferenceSession]:
        """Face occlusion model used to refine the swap mask.

        Entirely optional: the model may not be published in the model repo, in
        which case we log once and fall back to the geometric masks.
        """
        if not self._settings.occlusion_mask_enabled or self._occluder_unavailable:
            return None
        if self._occluder_session is None:
            with self._lock:
                if self._occluder_unavailable:
                    return None
                if self._occluder_session is None:
                    try:
                        with timed_log(logger, "occluder_initialize"):
                            occluder_path = self._download_model(
                                self._settings.occluder_model_file
                            )
                            self._occluder_session = ort.InferenceSession(
                                occluder_path,
                                providers=["CPUExecutionProvider"],
                            )
                    except Exception as exc:
                        self._occluder_unavailable = True
                        logger.warning(
                            "occluder_unavailable",
                            extra={
                                "event": "occluder_unavailable",
                                "model_filename": self._settings.occluder_model_file,
                                "error": str(exc),
                            },
                        )
                        return None
        return self._occluder_session


_REGISTRY: Optional[ModelRegistry] = None
_REGISTRY_LOCK = Lock()


def get_model_registry() -> ModelRegistry:
    global _REGISTRY
    if _REGISTRY is None:
        with _REGISTRY_LOCK:
            if _REGISTRY is None:
                _REGISTRY = ModelRegistry(get_settings())
    return _REGISTRY
