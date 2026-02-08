import os
import shutil
import zipfile
import io
import numpy as np
from PIL import Image
from .face_models import get_face_analyzer

async def process_zip_file(file):
    """
    Extracts a zip file, return images
    """
    temp_zip_path = "tmp/uploaded.zip"
    with open(temp_zip_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    extract_folder = "tmp/dataset"
    # Clean up previous extraction folder if it exists
    if os.path.exists(extract_folder):
        shutil.rmtree(extract_folder)
    os.makedirs(extract_folder)

    try:
        with zipfile.ZipFile(temp_zip_path, 'r') as zip_ref:
            zip_ref.extractall(extract_folder)

        # --- OPTIMIZED FILE SEARCH ---
        # Define the image extensions we're looking for (case-insensitive)
        image_extensions = ('.jpg', '.jpeg', '.png')
        image_files = 0
        embeddings = []
        face_analyzer = get_face_analyzer()
        for root, _, files in os.walk(extract_folder):
            for file in files:
                image_files += 1
                if file.lower().endswith(image_extensions):
                    file_path = os.path.join(root, file)
                    with open(file_path, 'rb') as image_file:
                        image = Image.open(io.BytesIO(image_file.read()))
                        img_np = np.array(image)
                        faces = face_analyzer.get(img_np)
                        if len(faces) > 0:
                            embeddings.append(faces[0].normed_embedding)

        print("Total images: " + str(image_files))
        
        return embeddings
        
    finally:
        # Clean up the uploaded zip and extracted files
        if os.path.exists(temp_zip_path):
            os.remove(temp_zip_path)
        if os.path.exists(extract_folder):
            shutil.rmtree(extract_folder)
