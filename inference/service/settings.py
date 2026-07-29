import os
from dataclasses import dataclass
from functools import lru_cache


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    model_repo: str
    local_model_dir: str
    detection_size_min: int
    detection_size_max: int
    detection_size_ratio: float
    detection_size_step: int
    port: int
    face_mask_blur: float
    face_mask_forehead_ratio: float
    face_mask_erode: float
    occlusion_mask_enabled: bool
    occluder_model_file: str
    face_swap_crop_size: int
    color_match_strength: float
    restore_blend: float
    output_jpeg_quality: int
    video_worker_count: int

    def detection_size_for_image(self, width: int, height: int) -> int:
        step = max(1, self.detection_size_step)
        min_size = min(self.detection_size_min, self.detection_size_max)
        max_size = max(self.detection_size_min, self.detection_size_max)
        short_side = max(1, min(width, height))
        base = int(short_side * self.detection_size_ratio)
        clamped = max(min_size, min(max_size, base))
        stepped = (clamped // step) * step
        return max(min_size, stepped)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    legacy_detection_size = os.environ.get("DETECTION_SIZE")
    default_min = legacy_detection_size or "320"
    default_max = legacy_detection_size or "1024"
    return Settings(
        model_repo=os.environ.get("MODEL_REPO", "asadujjaman-emon/face-app-models"),
        local_model_dir=os.environ.get("LOCAL_MODEL_DIR", "models"),
        detection_size_min=int(os.environ.get("DETECTION_SIZE_MIN", default_min)),
        detection_size_max=int(os.environ.get("DETECTION_SIZE_MAX", default_max)),
        detection_size_ratio=float(os.environ.get("DETECTION_SIZE_RATIO", "0.5")),
        detection_size_step=int(os.environ.get("DETECTION_SIZE_STEP", "32")),
        port=int(os.environ.get("PORT", "7860")),
        face_mask_blur=float(os.environ.get("FACE_MASK_BLUR", "0.25")),
        face_mask_forehead_ratio=float(os.environ.get("FACE_MASK_FOREHEAD_RATIO", "0.55")),
        face_mask_erode=float(os.environ.get("FACE_MASK_ERODE", "0.0")),
        occlusion_mask_enabled=_env_bool("OCCLUSION_MASK_ENABLED", True),
        occluder_model_file=os.environ.get("OCCLUDER_MODEL_FILE", "face_occluder.onnx"),
        face_swap_crop_size=int(os.environ.get("FACE_SWAP_CROP_SIZE", "512")),
        color_match_strength=float(os.environ.get("COLOR_MATCH_STRENGTH", "0.8")),
        restore_blend=float(os.environ.get("RESTORE_BLEND", "0.8")),
        output_jpeg_quality=int(os.environ.get("OUTPUT_JPEG_QUALITY", "95")),
        video_worker_count=int(os.environ.get("VIDEO_WORKER_COUNT", "0")),
    )
