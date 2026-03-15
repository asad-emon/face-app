import io
import os
import shutil
import subprocess
import tempfile
import uuid
from time import perf_counter
from typing import List, Optional

import numpy as np
import cv2
import requests
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response, JSONResponse
from PIL import Image
from safetensors.numpy import load as load_safetensor, save as save_safetensor

from .face_swap import FaceSwapService
from .observability import configure_logging, get_logger, timed_log


def _parse_form_bool(value: str) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _transcode_to_h264_mp4(raw_input_path: str, output_path: str, logger) -> None:
    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        shutil.copyfile(raw_input_path, output_path)
        logger.warning(
            "ffmpeg_not_found",
            extra={"event": "ffmpeg_not_found", "fallback": "raw_copy"},
        )
        return

    command = [
        ffmpeg_bin,
        "-y",
        "-i",
        raw_input_path,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-an",
        output_path,
    ]
    completed = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode == 0 and os.path.exists(output_path):
        return

    logger.warning(
        "ffmpeg_transcode_failed",
        extra={
            "event": "ffmpeg_transcode_failed",
            "return_code": completed.returncode,
            "stderr_tail": (completed.stderr or "")[-500:],
            "fallback": "raw_copy",
        },
    )
    shutil.copyfile(raw_input_path, output_path)


def _post_generated_video(
    callback_url: str,
    output_bytes: bytes,
    filename: str,
    mime_type: str,
    callback_token: Optional[str],
    total_frames: Optional[int],
    processed_frames: Optional[int],
    progress_percent: Optional[int],
    logger,
) -> None:
    if not callback_url:
        return

    headers = {}
    if callback_token:
        headers["x-inference-token"] = callback_token

    try:
        data = {
            "filename": filename,
            "mime_type": mime_type,
        }
        if total_frames is not None:
            data["total_frames"] = str(total_frames)
        if processed_frames is not None:
            data["processed_frames"] = str(processed_frames)
        if progress_percent is not None:
            data["progress_percent"] = str(progress_percent)

        response = requests.post(
            callback_url,
            headers=headers,
            data=data,
            files={"file": (filename, output_bytes, mime_type)},
            timeout=120,
        )
        if response.status_code >= 400:
            logger.warning(
                "callback_post_failed",
                extra={
                    "event": "callback_post_failed",
                    "status_code": response.status_code,
                    "response_tail": (response.text or "")[-500:],
                },
            )
    except Exception as exc:
        logger.warning(
            "callback_post_error",
            extra={"event": "callback_post_error", "error": str(exc)},
        )


def _post_video_progress(
    progress_url: str,
    processed_frames: int,
    total_frames: Optional[int],
    callback_token: Optional[str],
    logger,
) -> None:
    if not progress_url:
        return

    headers = {}
    if callback_token:
        headers["x-inference-token"] = callback_token

    progress_percent = None
    if total_frames and total_frames > 0:
        progress_percent = min(100, round((processed_frames / total_frames) * 100))

    data = {
        "processed_frames": str(processed_frames),
    }
    if total_frames is not None:
        data["total_frames"] = str(total_frames)
    if progress_percent is not None:
        data["progress_percent"] = str(progress_percent)

    try:
        response = requests.post(
            progress_url,
            headers=headers,
            data=data,
            timeout=30,
        )
        if response.status_code >= 400:
            logger.warning(
                "progress_post_failed",
                extra={
                    "event": "progress_post_failed",
                    "status_code": response.status_code,
                    "response_tail": (response.text or "")[-500:],
                },
            )
    except Exception as exc:
        logger.warning(
            "progress_post_error",
            extra={"event": "progress_post_error", "error": str(exc)},
        )


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
        preserve_expression: str = Form("1"),
        model_file: UploadFile = File(...),
        target_image: UploadFile = File(...),
    ):
        del model_id
        restore_enabled = _parse_form_bool(enable_restore)
        preserve_expression_enabled = _parse_form_bool(preserve_expression)
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
                source_expression_template = tensors.get("source_expression_template")
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
                preserve_source_expression=preserve_expression_enabled,
                source_expression_template=source_expression_template,
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
        source_expression_template = None
        with timed_log(logger, "embedding_batch", file_count=len(files)):
            for upload in files:
                data = await upload.read()
                if not data:
                    continue

                try:
                    image = Image.open(io.BytesIO(data)).convert("RGB")
                except Exception:
                    continue

                embedding, expression_template = swap_service.extract_face_features(image)
                if embedding is not None:
                    embeddings.append(embedding)
                    if source_expression_template is None and expression_template is not None:
                        source_expression_template = expression_template

        if not embeddings:
            raise HTTPException(status_code=400, detail="No faces found in uploaded images")

        avg_embedding = np.mean(embeddings, axis=0)
        tensors = {"embedding": avg_embedding.astype(np.float32)}
        if source_expression_template is not None:
            tensors["source_expression_template"] = source_expression_template.astype(np.float32)
        tensor_bytes = save_safetensor(tensors)
        return Response(content=tensor_bytes, media_type="application/octet-stream")

    @app.post("/swap-remote-video")
    async def swap_remote_video(
        model_id: str = Form(...),
        enable_restore: str = Form("0"),
        preserve_expression: str = Form("1"),
        callback_url: Optional[str] = Form(None),
        progress_url: Optional[str] = Form(None),
        callback_token: Optional[str] = Form(None),
        model_file: UploadFile = File(...),
        target_video: UploadFile = File(...),
    ):
        del model_id
        restore_enabled = _parse_form_bool(enable_restore)
        preserve_expression_enabled = _parse_form_bool(preserve_expression)
        model_bytes = await model_file.read()
        target_bytes = await target_video.read()

        if not model_bytes:
            raise HTTPException(status_code=400, detail="Empty model_file")
        if not target_bytes:
            raise HTTPException(status_code=400, detail="Empty target_video")

        try:
            with timed_log(logger, "parse_model_file_video"):
                tensors = load_safetensor(model_bytes)
                source_embedding = tensors.get("embedding")
                source_expression_template = tensors.get("source_expression_template")
        except Exception as exc:
            logger.warning(
                "invalid_model_file_video",
                extra={"event": "invalid_model_file_video", "error": str(exc)},
            )
            raise HTTPException(status_code=400, detail=f"Invalid model_file: {exc}")

        if source_embedding is None:
            raise HTTPException(status_code=400, detail="Model file missing 'embedding'")

        input_suffix = os.path.splitext(target_video.filename or "video.mp4")[1] or ".mp4"
        input_path = ""
        raw_output_path = ""
        output_path = ""
        cap = None
        writer = None

        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=input_suffix) as input_file:
                input_file.write(target_bytes)
                input_path = input_file.name

            with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as raw_output_file:
                raw_output_path = raw_output_file.name
            with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as output_file:
                output_path = output_file.name

            with timed_log(logger, "decode_target_video"):
                cap = cv2.VideoCapture(input_path)

            if not cap.isOpened():
                raise HTTPException(status_code=400, detail="Invalid target_video")

            fps = cap.get(cv2.CAP_PROP_FPS)
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            if total_frames <= 0:
                total_frames = None

            if width <= 0 or height <= 0:
                raise HTTPException(status_code=400, detail="Unable to read video dimensions")

            if not fps or fps <= 0:
                fps = 25.0

            writer = cv2.VideoWriter(
                raw_output_path,
                cv2.VideoWriter_fourcc(*"mp4v"),
                fps,
                (width, height),
            )

            if not writer.isOpened():
                raise HTTPException(status_code=500, detail="Failed to initialize video writer")

            frame_count = 0
            report_every = 30
            if total_frames:
                report_every = max(1, int(total_frames * 0.02))
            last_reported = 0
            if progress_url:
                _post_video_progress(
                    progress_url=progress_url,
                    processed_frames=0,
                    total_frames=total_frames,
                    callback_token=callback_token,
                    logger=logger,
                )
            with timed_log(logger, "swap_remote_video_inference", restore_enabled=restore_enabled):
                while True:
                    ok, frame = cap.read()
                    if not ok:
                        break
                    swapped = swap_service.swap_frame_with_embedding(
                        frame,
                        source_embedding,
                        enable_restore=restore_enabled,
                        preserve_source_expression=preserve_expression_enabled,
                        source_expression_template=source_expression_template,
                    )
                    writer.write(swapped)
                    frame_count += 1
                    if progress_url and (frame_count == total_frames or frame_count - last_reported >= report_every):
                        _post_video_progress(
                            progress_url=progress_url,
                            processed_frames=frame_count,
                            total_frames=total_frames,
                            callback_token=callback_token,
                            logger=logger,
                        )
                        last_reported = frame_count

            if frame_count == 0:
                raise HTTPException(status_code=400, detail="Video has no readable frames")

            writer.release()
            writer = None

            with timed_log(logger, "transcode_output_video", frame_count=frame_count):
                _transcode_to_h264_mp4(raw_output_path, output_path, logger)

            with timed_log(logger, "encode_output_video", frame_count=frame_count):
                with open(output_path, "rb") as file_obj:
                    output_bytes = file_obj.read()

            logger.info(
                "video_encoded",
                extra={
                    "event": "video_encoded",
                    "output_path": output_path,
                    "frame_count": frame_count,
                },
            )
            if callback_url:
                with timed_log(logger, "post_output_video", frame_count=frame_count):
                    _post_generated_video(
                        callback_url=callback_url,
                        output_bytes=output_bytes,
                        filename=f"swapped-{uuid.uuid4().hex}.mp4",
                        mime_type="video/mp4",
                        callback_token=callback_token,
                        total_frames=total_frames,
                        processed_frames=frame_count,
                        progress_percent=100,
                        logger=logger,
                    )
                return JSONResponse(content={"status": "posted"}, status_code=202)
            return Response(content=output_bytes, media_type="video/mp4")
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception(
                "swap_remote_video_failed",
                extra={"event": "swap_remote_video_failed", "error": str(exc)},
            )
            raise HTTPException(status_code=500, detail=f"Video swap failed: {exc}")
        finally:
            if cap is not None:
                cap.release()
            if writer is not None:
                writer.release()
            if input_path and os.path.exists(input_path):
                os.remove(input_path)
            if raw_output_path and os.path.exists(raw_output_path):
                os.remove(raw_output_path)
            if output_path and os.path.exists(output_path):
                os.remove(output_path)

    return app
