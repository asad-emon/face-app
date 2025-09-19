from app.swapper import swap_faces
from app.utils import load_image_from_input, process_zip_file
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import base64
import io
from PIL import Image
from pydantic import BaseModel
import shutil

class SwapRequest(BaseModel):
    weight_file: str = None
    image_base64: str = None

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_IMAGE_SIZE_MB = 5

def process_image_to_base64(pil_image: Image.Image) -> str:
    processed_image = pil_image.convert('L').convert('RGB')
    buffer = io.BytesIO()
    processed_image.save(buffer, format='JPEG')
    return base64.b64encode(buffer.getvalue()).decode()

@app.get("/")
async def root():
    return {"message": "FastAPI Image Processing Server is running"}

@app.post("/swap")
async def upload_image(
    request: SwapRequest,
):
    try:
        if request.image_base64:
            processed_image = load_image_from_input(request.image_base64)
            weight_file = request.weight_file if hasattr(request, 'weight_file') else None
        else:
            raise HTTPException(status_code=400, detail="No image, URL, or base64 provided")

        output_image = swap_faces(processed_image, weight_file=weight_file)
        # Convert PIL Image to base64 string
        buffered = io.BytesIO()
        output_image.save(buffered, format="JPEG")
        img_str = base64.b64encode(buffered.getvalue()).decode('utf-8')

        # Return the base64 string in a JSON response
        return {"result": f"data:image/jpeg;base64,{img_str}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing image: {str(e)}")


@app.post("/upload-dataset")
async def upload_dataset(file: UploadFile = File(...)):
    """
    Accepts a ZIP file containing a face dataset, extracts it,
    computes embeddings, and stores them.
    """
    try:
        # Save the uploaded file temporarily
        temp_zip_path = f"/tmp/{file.filename}"
        with open(temp_zip_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Process the zip file to generate and store embeddings
        embeddings_path = await process_zip_file(temp_zip_path)
        return {
            "message": "Dataset processed successfully.",
            "embeddings_path": embeddings_path
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing dataset: {str(e)}")

