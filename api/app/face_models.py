import os
from PIL import Image
import onnxruntime as ort
from huggingface_hub import hf_hub_download
from insightface.app import FaceAnalysis
from insightface import model_zoo
import torch
import numpy as np
from safetensors.torch import save_file

# -------------------------
# Configuration Constants
# -------------------------
MODEL_REPO = "asadujjaman-emon/face-app-models"
LOCAL_MODEL_DIR = "app/models"
DETECTION_SIZE = 320  # Set your consistent detection size here

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
    face_analyzer = FaceAnalysis(allowed_modules=['detection', 'recognition'], providers=["CPUExecutionProvider"])
    face_analyzer.prepare(ctx_id=0, det_size=(DETECTION_SIZE, DETECTION_SIZE))

    inswapper_path = hf_download("inswapper_128.onnx")
    gpen_path = hf_download("GPEN-BFR-1024.onnx")
    
    swapper = model_zoo.get_model(inswapper_path, providers=["CPUExecutionProvider"])
    gpen_session = ort.InferenceSession(gpen_path, providers=["CPUExecutionProvider"])
    
    return face_analyzer, swapper, gpen_session

# --- Main Exported Models ---
# These are loaded once when the application starts
FACE_ANALYZER, SWAPPER, GPEN_SESSION = initialize_models()

def store_embeddings(image_files, dataset_name):
    """Store embeddings as a .safetensors file."""
    all_embeddings = []
    for image_path in image_files:
        try:
            img = np.array(Image.open(image_path).convert("RGB"))
            faces = FACE_ANALYZER.get(img)
            if faces:
                # Using the first face found in the image and its embedding
                all_embeddings.append(faces[0].normed_embedding)
        except Exception as e:
            print(f"Warning: Could not process image {image_path}. Error: {e}")
    if not all_embeddings:
        print("Warning: No faces found in the uploaded dataset.")
        return None
    # --- New Logic: Average embeddings and save as .safetensors ---
    # 1. Average the embeddings to get a single representative vector
    avg_embedding = np.mean(np.array(all_embeddings), axis=0)
    # 2. Convert to PyTorch tensor
    embedding_tensor = torch.from_numpy(avg_embedding).float()
    # 3. Prepare data for safetensors format
    tensors_dict = {"embedding": embedding_tensor}
    
    # Save embeddings
    if not os.path.exists(LOCAL_MODEL_DIR):
        os.makedirs(LOCAL_MODEL_DIR)
    # 4. Change file extension to .safetensors
    embeddings_file = os.path.join(LOCAL_MODEL_DIR, f"{dataset_name}.safetensors")
    
    # 5. Use save_file from safetensors to save the tensor
    save_file(tensors_dict, embeddings_file)
    
    return embeddings_file
