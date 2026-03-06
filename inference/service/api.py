import io
from typing import List

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image
from safetensors.numpy import load as load_safetensor, save as save_safetensor

from .face_swap import FaceSwapService


def create_app() -> FastAPI:
    app = FastAPI()
    swap_service = FaceSwapService()

    @app.post("/swap-remote")
    async def swap_remote(
        model_id: str = Form(...),
        model_file: UploadFile = File(...),
        target_image: UploadFile = File(...),
    ):
        del model_id
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
            target_pil = Image.open(io.BytesIO(target_bytes)).convert("RGB")
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid target_image: {exc}")

        output_image = swap_service.swap_with_embedding(target_pil, source_embedding)
        buffered = io.BytesIO()
        output_image.save(buffered, format="JPEG")
        return Response(content=buffered.getvalue(), media_type="image/jpeg")

    @app.post("/embedding")
    async def create_embedding(files: List[UploadFile] = File(..., alias="file")):
        if not files:
            raise HTTPException(status_code=400, detail="No files provided")

        embeddings = []
        for upload in files:
            data = await upload.read()
            if not data:
                continue

            try:
                image = Image.open(io.BytesIO(data)).convert("RGB")
            except Exception:
                continue

            embedding = swap_service.extract_embedding(image)
            if embedding is not None:
                embeddings.append(embedding)

        if not embeddings:
            raise HTTPException(status_code=400, detail="No faces found in uploaded images")

        avg_embedding = np.mean(embeddings, axis=0)
        tensor_bytes = save_safetensor({"embedding": avg_embedding})
        return Response(content=tensor_bytes, media_type="application/octet-stream")

    return app

