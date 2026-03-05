import os
import io
from threading import Lock
from typing import List
import numpy as np
import cv2
from skimage.exposure import match_histograms
from PIL import Image
import onnxruntime as ort
from huggingface_hub import hf_hub_download
from insightface.app import FaceAnalysis
from insightface import model_zoo
from safetensors import safe_open
from safetensors.numpy import load as load_safetensor, save as save_safetensor
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import Response
import httpx

# -------------------------
# Configuration
# -------------------------
MODEL_REPO = os.environ.get("MODEL_REPO", "asadujjaman-emon/face-app-models")
LOCAL_MODEL_DIR = os.environ.get("LOCAL_MODEL_DIR", "models")
DETECTION_SIZE = int(os.environ.get("DETECTION_SIZE", "320"))
ENABLE_GPEN = os.environ.get("ENABLE_GPEN", "0").strip().lower() in {"1", "true", "yes"}

_MODEL_LOCK = Lock()
_MODELS = None

# -------------------------
# Model Downloading
# -------------------------

def hf_download(filename, repo_id=MODEL_REPO):
    """Return local path to model, downloading if needed."""
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

# -------------------------
# Singleton Model Loader
# -------------------------

def initialize_models():
    """Loads all models once and returns them."""
    face_analyzer = FaceAnalysis(
        name="buffalo_sc",
        allowed_modules=["detection", "recognition"],
        providers=["CPUExecutionProvider"],
    )
    face_analyzer.prepare(ctx_id=0, det_size=(DETECTION_SIZE, DETECTION_SIZE))

    inswapper_path = hf_download("inswapper_128.onnx")
    swapper = model_zoo.get_model(inswapper_path, providers=["CPUExecutionProvider"])

    gpen_session = None
    if ENABLE_GPEN:
        gpen_path = hf_download("GPEN-BFR-1024.onnx")
        gpen_session = ort.InferenceSession(gpen_path, providers=["CPUExecutionProvider"])

    return face_analyzer, swapper, gpen_session


def get_models():
    global _MODELS
    if _MODELS is None:
        with _MODEL_LOCK:
            if _MODELS is None:
                _MODELS = initialize_models()
    return _MODELS


def get_face_analyzer():
    return get_models()[0]


def get_swapper():
    return get_models()[1]


def get_gpen_session():
    return get_models()[2]

# -------------------------
# Swapper Logic
# -------------------------

class DummyFace:
    def __init__(self, embedding):
        self.normed_embedding = embedding


def run_gpen_on_patch(patch_bgr, gpen_session):
    gpen_input_name = gpen_session.get_inputs()[0].name
    gpen_output_name = gpen_session.get_outputs()[0].name
    h, w = patch_bgr.shape[:2]
    patch_1024 = cv2.resize(patch_bgr, (1024, 1024), interpolation=cv2.INTER_LINEAR)
    blob = patch_1024.astype(np.float32) / 127.5 - 1.0
    blob = np.transpose(blob, (2, 0, 1))[np.newaxis, :]
    out = gpen_session.run([gpen_output_name], {gpen_input_name: blob})[0][0]
    out = np.transpose(out, (1, 2, 0))
    out = ((out + 1.0) * 127.5).clip(0, 255).astype(np.uint8)
    return cv2.resize(out, (w, h), interpolation=cv2.INTER_LINEAR)


def enlarge_box(box, image_shape, scale=1.6):
    x1, y1, x2, y2 = box
    w = x2 - x1
    h = y2 - y1
    cx = x1 + w / 2
    cy = y1 + h / 2
    new_w = min(image_shape[1], w * scale)
    new_h = min(image_shape[0], h * scale)
    nx1 = int(max(0, cx - new_w / 2))
    ny1 = int(max(0, cy - new_h / 2))
    nx2 = int(min(image_shape[1], cx + new_w / 2))
    ny2 = int(min(image_shape[0], cy + new_h / 2))
    return (nx1, ny1, nx2, ny2)


def create_feather_mask(h, w, feather=30):
    mask = np.zeros((h, w), dtype=np.float32)
    cv2.ellipse(mask, (w // 2, h // 2), (w // 2 - feather, h // 2 - feather), 0, 0, 360, 1, -1)
    mask = cv2.GaussianBlur(mask, (feather * 2 + 1, feather * 2 + 1), 0)
    return mask[..., None]


def swap_with_embedding(pil_img, source_embedding):
    img_rgb = np.array(pil_img)
    img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)

    face_analyzer = get_face_analyzer()
    swapper = get_swapper()
    gpen_session = get_gpen_session()

    faces = face_analyzer.get(img_bgr)

    norm = np.linalg.norm(source_embedding)
    if norm > 0:
        embedding = source_embedding / norm
    else:
        embedding = source_embedding
    source_face = DummyFace(embedding)

    for face in faces:
        if face.normed_embedding is None:
            print("Warning: embedding not found for a face, skipping.")
            continue

        img_bgr = swapper.get(img_bgr, face, source_face, paste_back=True)

        if gpen_session is not None:
            x1, y1, x2, y2 = face.bbox.astype(int)
            x1, y1, x2, y2 = enlarge_box((x1, y1, x2, y2), img_bgr.shape, scale=1.6)
            face_region = img_bgr[y1:y2, x1:x2]

            if face_region.size == 0:
                print("Warning: face region is empty, skipping restoration.")
                continue

            restored_patch = run_gpen_on_patch(face_region, gpen_session)
            restored_patch_matched = match_histograms(restored_patch, face_region, channel_axis=-1).astype(restored_patch.dtype)

            mask = create_feather_mask(restored_patch.shape[0], restored_patch.shape[1], feather=30)

            blended_region = restored_patch_matched.astype(np.float32) * mask + img_bgr[y1:y2, x1:x2].astype(np.float32) * (1 - mask)
            img_bgr[y1:y2, x1:x2] = blended_region.clip(0, 255).astype(np.uint8)

    return Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))


def extract_embedding(pil_img):
    img_rgb = np.array(pil_img)
    img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
    face_analyzer = get_face_analyzer()
    faces = face_analyzer.get(img_bgr)
    if not faces:
        return None
    return faces[0].normed_embedding

# -------------------------
# FastAPI for HF Space
# -------------------------

app = FastAPI()

@app.post("/swap-remote")
async def swap_remote(
    model_id: str = Form(...),
    model_file: UploadFile = File(...),
    target_image: UploadFile = File(...),
):
    model_bytes = await model_file.read()
    target_bytes = await target_image.read()

    if not model_bytes:
        raise HTTPException(status_code=400, detail="Empty model_file")
    if not target_bytes:
        raise HTTPException(status_code=400, detail="Empty target_image")

    try:
        tensors = load_safetensor(model_bytes)
        source_embedding = tensors.get("embedding")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid model_file: {exc}")

    if source_embedding is None:
        raise HTTPException(status_code=400, detail="Model file missing 'embedding'")

    try:
        target_pil = Image.open(io.BytesIO(target_bytes))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid target_image: {exc}")

    output_image = swap_with_embedding(target_pil, source_embedding)
    buffered = io.BytesIO()
    output_image.save(buffered, format="JPEG")
    return Response(content=buffered.getvalue(), media_type="image/jpeg")

@app.post("/embedding")
async def create_embedding(
    files: List[UploadFile] = File(..., alias="file"),
):
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    embeddings = []
    total_files = 0
    for upload in files:
        total_files += 1
        data = await upload.read()
        if not data:
            continue
        try:
            image = Image.open(io.BytesIO(data)).convert("RGB")
        except Exception:
            continue
        embedding = extract_embedding(image)
        if embedding is not None:
            embeddings.append(embedding)

    if not embeddings:
        raise HTTPException(status_code=400, detail="No faces found in uploaded images")

    avg_embedding = np.mean(embeddings, axis=0)
    tensor_bytes = save_safetensor({"embedding": avg_embedding})
    return Response(content=tensor_bytes, media_type="application/octet-stream")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "7860")),
        reload=True,
        debug=True,
    )
