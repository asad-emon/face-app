import os
from dataclasses import dataclass
from functools import lru_cache


def _env_bool(name: str, default: str = "0") -> bool:
    value = os.environ.get(name, default).strip().lower()
    return value in {"1", "true", "yes"}


@dataclass(frozen=True)
class Settings:
    model_repo: str
    local_model_dir: str
    detection_size_min: int
    detection_size_max: int
    detection_size_ratio: float
    detection_size_step: int
    enable_gpen: bool
    port: int

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
        enable_gpen=_env_bool("ENABLE_GPEN", "0"),
        port=int(os.environ.get("PORT", "7860")),
    )
