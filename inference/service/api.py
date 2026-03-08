import io
import uuid
from time import perf_counter
from typing import List

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from PIL import Image
from safetensors.numpy import load as load_safetensor, save as save_safetensor

from .face_swap import FaceSwapService
from .observability import configure_logging, get_logger, timed_log


def _parse_form_bool(value: str) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def create_app() -> FastAPI:
    configure_logging()
    logger = get_logger("inference.api")
    app = FastAPI()
    swap_service = FaceSwapService()

    @app.middleware("http")
    async def request_timing_middleware(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        start = perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = round((perf_counter() - start) * 1000, 2)
            logger.exception(
                "request_failed",
                extra={
                    "event": "request_failed",
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "duration_ms": duration_ms,
                },
            )
            raise

        duration_ms = round((perf_counter() - start) * 1000, 2)
        response.headers["x-request-id"] = request_id
        logger.info(
            "request_complete",
            extra={
                "event": "request_complete",
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": duration_ms,
            },
        )
        return response

    @app.post("/swap-remote")
    async def swap_remote(
        model_id: str = Form(...),
        enable_restore: str = Form("0"),
        model_file: UploadFile = File(...),
        target_image: UploadFile = File(...),
    ):
        del model_id
        restore_enabled = _parse_form_bool(enable_restore)
        model_bytes = await model_file.read()
        target_bytes = await target_image.read()

        if not model_bytes:
            raise HTTPException(status_code=400, detail="Empty model_file")
        if not target_bytes:
            raise HTTPException(status_code=400, detail="Empty target_image")

        try:
            with timed_log(logger, "parse_model_file"):
                tensors = load_safetensor(model_bytes)
                source_embedding = tensors.get("embedding")
        except Exception as exc:
            logger.warning(
                "invalid_model_file",
                extra={"event": "invalid_model_file", "error": str(exc)},
            )
            raise HTTPException(status_code=400, detail=f"Invalid model_file: {exc}")

        if source_embedding is None:
            raise HTTPException(status_code=400, detail="Model file missing 'embedding'")

        try:
            with timed_log(logger, "decode_target_image"):
                target_pil = Image.open(io.BytesIO(target_bytes)).convert("RGB")
        except Exception as exc:
            logger.warning(
                "invalid_target_image",
                extra={"event": "invalid_target_image", "error": str(exc)},
            )
            raise HTTPException(status_code=400, detail=f"Invalid target_image: {exc}")

        with timed_log(logger, "swap_remote_inference", restore_enabled=restore_enabled):
            output_image = swap_service.swap_with_embedding(
                target_pil,
                source_embedding,
                enable_restore=restore_enabled,
            )
        buffered = io.BytesIO()
        with timed_log(logger, "encode_output_image"):
            output_image.save(buffered, format="JPEG")
        return Response(content=buffered.getvalue(), media_type="image/jpeg")

    @app.post("/embedding")
    async def create_embedding(files: List[UploadFile] = File(..., alias="file")):
        if not files:
            raise HTTPException(status_code=400, detail="No files provided")

        embeddings = []
        with timed_log(logger, "embedding_batch", file_count=len(files)):
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
