import os
import numpy as np
from PIL import Image
import cv2
from safetensors import safe_open
from skimage.exposure import match_histograms
from .face_models import FACE_ANALYZER, SWAPPER, GPEN_SESSION, LOCAL_MODEL_DIR # <-- Import shared models

class DummyFace:
    def __init__(self, embedding):
        self.normed_embedding = embedding

# -------------------------
# Helper functions
# -------------------------
def run_gpen_on_patch(patch_bgr, gpen_session):
    gpen_input_name = GPEN_SESSION.get_inputs()[0].name
    gpen_output_name = GPEN_SESSION.get_outputs()[0].name
    h, w = patch_bgr.shape[:2]
    patch_1024 = cv2.resize(patch_bgr, (1024, 1024), interpolation=cv2.INTER_LINEAR)
    blob = patch_1024.astype(np.float32) / 127.5 - 1.0
    blob = np.transpose(blob, (2, 0, 1))[np.newaxis, :]
    out = GPEN_SESSION.run([gpen_output_name], {gpen_input_name: blob})[0][0]
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
    cv2.ellipse(mask, (w//2, h//2), (w//2 - feather, h//2 - feather), 0, 0, 360, 1, -1)
    mask = cv2.GaussianBlur(mask, (feather*2+1, feather*2+1), 0)
    return mask[..., None]

def find_closest_face(face_embedding, embeddings_array):
    """
    Finds the index of the closest face embedding in the embeddings array.
    """
    distances = np.linalg.norm(embeddings_array - face_embedding, axis=1)
    closest_index = np.argmin(distances)
    return closest_index

# -------------------------
# Main face swap logic
# -------------------------
def swap_faces(pil_img, weight_file):
    img_rgb = np.array(pil_img)
    img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
    
    faces = FACE_ANALYZER.get(img_bgr)

    embeddings_file = os.path.join(LOCAL_MODEL_DIR, weight_file + ".safetensors")

    for face in faces:
        if face.normed_embedding is None:
            print("Warning: embedding not found for a face, skipping.")
            continue
        
        # Load the embeddings from the .safetensors file
        with safe_open(embeddings_file, framework="pt", device="cpu") as f:
            embedding = f.get_tensor("embedding").numpy().flatten()
        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding = embedding / norm
        source_face = DummyFace(embedding)

        # Use the swapper.get() method
        img_bgr = SWAPPER.get(img_bgr, face, source_face, paste_back=True)

        # Apply GPEN restoration and color matching
        x1, y1, x2, y2 = face.bbox.astype(int)
        x1, y1, x2, y2 = enlarge_box((x1, y1, x2, y2), img_bgr.shape, scale=1.6)
        face_region = img_bgr[y1:y2, x1:x2]
        
        restored_patch = run_gpen_on_patch(face_region, GPEN_SESSION)
        restored_patch_matched = match_histograms(restored_patch, face_region, channel_axis=-1).astype(restored_patch.dtype)
        
        mask = create_feather_mask(restored_patch.shape[0], restored_patch.shape[1], feather=30)
        
        blended_region = restored_patch_matched.astype(np.float32) * mask + img_bgr[y1:y2, x1:x2].astype(np.float32) * (1 - mask)
        img_bgr[y1:y2, x1:x2] = blended_region.clip(0, 255).astype(np.uint8)

    return Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))