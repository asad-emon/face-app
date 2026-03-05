import os

from huggingface_hub import hf_hub_download
from insightface.app import FaceAnalysis


MODEL_REPO = os.environ.get("MODEL_REPO", "asadujjaman-emon/face-app-models")
LOCAL_MODEL_DIR = os.environ.get("LOCAL_MODEL_DIR", "models")
DETECTION_SIZE = int(os.environ.get("DETECTION_SIZE", "320"))
ENABLE_GPEN = os.environ.get("ENABLE_GPEN", "1").strip().lower() in {"1", "true", "yes"}


def hf_download(filename, repo_id=MODEL_REPO):
    local_path = os.path.join(LOCAL_MODEL_DIR, filename)
    if os.path.exists(local_path):
        print(f"[INFO] Using pre-downloaded model: {local_path}")
        return local_path

    os.makedirs(LOCAL_MODEL_DIR, exist_ok=True)
    print(f"[INFO] Downloading {filename} from Hugging Face...")
    return hf_hub_download(
        repo_id=repo_id,
        filename=filename,
        local_dir=LOCAL_MODEL_DIR,
        local_dir_use_symlinks=False,
    )


def preload_insightface_assets():
    face_analyzer = FaceAnalysis(
        name="buffalo_sc",
        allowed_modules=["detection", "recognition"],
        providers=["CPUExecutionProvider"],
    )
    face_analyzer.prepare(ctx_id=0, det_size=(DETECTION_SIZE, DETECTION_SIZE))


def main():
    hf_download("inswapper_128.onnx")
    if ENABLE_GPEN:
        hf_download("GPEN-BFR-1024.onnx")
    preload_insightface_assets()
    print("[INFO] Preload complete.")


if __name__ == "__main__":
    main()
