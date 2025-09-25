import os
from PIL import Image
import onnxruntime as ort
from huggingface_hub import hf_hub_download
from insightface.app import FaceAnalysis
from insightface import model_zoo
import numpy as np

# -------------------------
# Configuration Constants
# -------------------------
MODEL_REPO = "asadujjaman-emon/face-app-models"
LOCAL_MODEL_DIR = "app/models"
DETECTION_SIZE = 320  # Set your consistent detection size here
HF_SPACE_URL = os.environ.get("HF_SPACE_URL")

# -------------------------
# Model Downloading
# -------------------------
def hf_download(filename, repo_id=MODEL_REPO):
    """Return local path to model, downloading if needed."""
    local_path = os.path.join(LOCAL_MODEL_DIR, filename)
    if os.path.exists(local_path):
        print(f"[INFO] Using pre-downloaded model: {local_path}")
        return local_path
    
    print(f"[INFO] Downloading {filename} from Hugging Face...")
    return hf_hub_download(
        repo_id=repo_id,
        filename=filename,
        local_dir=LOCAL_MODEL_DIR,
        local_dir_use_symlinks=False
    )

# -------------------------
# Singleton Model Loader
# -------------------------
def initialize_models():
    """Loads all models once and returns them."""
    face_analyzer = FaceAnalysis(name='buffalo_sc', allowed_modules=['detection', 'recognition'], providers=["CPUExecutionProvider"])
    face_analyzer.prepare(ctx_id=0, det_size=(DETECTION_SIZE, DETECTION_SIZE))

    inswapper_path = hf_download("inswapper_128.onnx")
    gpen_path = hf_download("GPEN-BFR-1024.onnx")
    
    swapper = model_zoo.get_model(inswapper_path, providers=["CPUExecutionProvider"])
    gpen_session = ort.InferenceSession(gpen_path, providers=["CPUExecutionProvider"])
    
    return face_analyzer, swapper, gpen_session


def swap_face_with_hf_space(source_image: Image.Image, target_image: Image.Image):
    import httpx
    import io

    if not HF_SPACE_URL:
        raise ValueError("HF_SPACE_URL environment variable is not set.")

    source_bytes = io.BytesIO()
    target_bytes = io.BytesIO()
    source_image.save(source_bytes, format="PNG")
    target_image.save(target_bytes, format="PNG")
    source_bytes.seek(0)
    target_bytes.seek(0)

    files = {
        'source_image': ('source.png', source_bytes, 'image/png'),
        'target_image': ('target.png', target_bytes, 'image/png')
    }
    
    with httpx.Client() as client:
        response = client.post(f"{HF_SPACE_URL}/swap", files=files)
        response.raise_for_status()
        image_data = response.content
    
    return Image.open(io.BytesIO(image_data))


# --- Main Exported Models ---
# These are loaded once when the application starts
if not HF_SPACE_URL:
    FACE_ANALYZER, SWAPPER, GPEN_SESSION = initialize_models()
