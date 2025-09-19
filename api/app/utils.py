from PIL import Image
import requests
import base64
from io import BytesIO
import zipfile
import os
from glob import glob
import shutil
from .face_models import FACE_ANALYZER, store_embeddings

def load_image_from_input(image_input):
    if image_input.startswith("http"):
        response = requests.get(image_input)
        return Image.open(BytesIO(response.content)).convert("RGB")
    elif image_input.startswith("data:image"):
        base64_str = image_input.split(",")[1]
        return Image.open(BytesIO(base64.b64decode(base64_str))).convert("RGB")
    else:
        raise ValueError("Unsupported image format")

async def process_zip_file(zip_path: str):
    """
    Extracts a zip file, processes images to get face embeddings,
    averages them, and saves them as a .safetensors file.
    """
    extract_folder = "tmp/dataset"
    # Clean up previous extraction folder if it exists
    if os.path.exists(extract_folder):
        shutil.rmtree(extract_folder)
    os.makedirs(extract_folder)

    try:
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(extract_folder)
        dataset_name = os.path.splitext(os.path.basename(zip_path))[0]

        # --- OPTIMIZED FILE SEARCH ---
        # Define the image extensions we're looking for (case-insensitive)
        image_extensions = ('.jpg', '.jpeg', '.png')
        image_files = []
        for root, _, files in os.walk(extract_folder):
            for file in files:
                if file.lower().endswith(image_extensions):
                    image_files.append(os.path.join(root, file))

        print("Total images: " + str(len(image_files)))
        return store_embeddings(image_files, dataset_name)
        
    finally:
        # Clean up the uploaded zip and extracted files
        if os.path.exists(zip_path):
            os.remove(zip_path)
        if os.path.exists(extract_folder):
            shutil.rmtree(extract_folder)