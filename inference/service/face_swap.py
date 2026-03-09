from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np
from PIL import Image
from skimage.exposure import match_histograms

from .model_registry import ModelRegistry, get_model_registry
from .observability import get_logger, timed_log


@dataclass
class DummyFace:
    normed_embedding: np.ndarray


logger = get_logger("inference.face_swap")


class FaceSwapService:
    def __init__(self, registry: Optional[ModelRegistry] = None):
        self._registry = registry or get_model_registry()

    @staticmethod
    def _select_gpen_input_size(patch_bgr: np.ndarray) -> int:
        h, w = patch_bgr.shape[:2]
        return 1024 if max(h, w) > 512 else 512

    @staticmethod
    def _run_gpen_on_patch(patch_bgr: np.ndarray, gpen_session, input_size: int) -> np.ndarray:
        gpen_input_name = gpen_session.get_inputs()[0].name
        gpen_output_name = gpen_session.get_outputs()[0].name
        h, w = patch_bgr.shape[:2]

        patch_resized = cv2.resize(patch_bgr, (input_size, input_size), interpolation=cv2.INTER_LINEAR)
        blob = patch_resized.astype(np.float32) / 127.5 - 1.0
        blob = np.transpose(blob, (2, 0, 1))[np.newaxis, :]
        out = gpen_session.run([gpen_output_name], {gpen_input_name: blob})[0][0]
        out = np.transpose(out, (1, 2, 0))
        out = ((out + 1.0) * 127.5).clip(0, 255).astype(np.uint8)
        return cv2.resize(out, (w, h), interpolation=cv2.INTER_LINEAR)

    @staticmethod
    def _enlarge_box(box, image_shape, scale: float = 1.6):
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
        return nx1, ny1, nx2, ny2

    @staticmethod
    def _create_feather_mask(h: int, w: int, feather: int = 30) -> np.ndarray:
        mask = np.zeros((h, w), dtype=np.float32)
        cv2.ellipse(
            mask,
            (w // 2, h // 2),
            (w // 2 - feather, h // 2 - feather),
            0,
            0,
            360,
            1,
            -1,
        )
        mask = cv2.GaussianBlur(mask, (feather * 2 + 1, feather * 2 + 1), 0)
        return mask[..., None]

    def extract_embedding(self, pil_img: Image.Image):
        img_rgb = np.array(pil_img)
        img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
        self._registry.prepare_face_analyzer_for_image(img_bgr.shape)
        with timed_log(
            logger,
            "extract_embedding",
            image_width=img_bgr.shape[1],
            image_height=img_bgr.shape[0],
        ):
            faces = self._registry.get_face_analyzer().get(img_bgr)
        if not faces:
            return None
        return faces[0].normed_embedding

    def swap_with_embedding(
        self,
        pil_img: Image.Image,
        source_embedding: np.ndarray,
        enable_restore: bool = False,
    ) -> Image.Image:
        img_rgb = np.array(pil_img)
        img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)

        swapped_bgr = self.swap_frame_with_embedding(
            img_bgr,
            source_embedding,
            enable_restore=enable_restore,
        )

        return Image.fromarray(cv2.cvtColor(swapped_bgr, cv2.COLOR_BGR2RGB))

    def swap_frame_with_embedding(
        self,
        img_bgr: np.ndarray,
        source_embedding: np.ndarray,
        enable_restore: bool = False,
    ) -> np.ndarray:
        img_bgr = np.ascontiguousarray(img_bgr)

        self._registry.prepare_face_analyzer_for_image(img_bgr.shape)
        face_analyzer = self._registry.get_face_analyzer()
        swapper = self._registry.get_swapper()

        with timed_log(
            logger,
            "face_detection_for_swap",
            image_width=img_bgr.shape[1],
            image_height=img_bgr.shape[0],
        ):
            faces = face_analyzer.get(img_bgr)
        norm = np.linalg.norm(source_embedding)
        embedding = source_embedding / norm if norm > 0 else source_embedding
        source_face = DummyFace(embedding)

        skipped_faces = 0
        with timed_log(
            logger,
            "swap_faces",
            face_count=len(faces),
            restore_enabled=enable_restore,
        ):
            for face in faces:
                if face.normed_embedding is None:
                    skipped_faces += 1
                    logger.warning(
                        "missing_face_embedding",
                        extra={"event": "missing_face_embedding"},
                    )
                    continue

                img_bgr = swapper.get(img_bgr, face, source_face, paste_back=True)

                if not enable_restore:
                    continue

                x1, y1, x2, y2 = self._enlarge_box(face.bbox.astype(int), img_bgr.shape, scale=1.6)
                face_region = img_bgr[y1:y2, x1:x2]
                if face_region.size == 0:
                    skipped_faces += 1
                    logger.warning(
                        "empty_face_region_for_restore",
                        extra={"event": "empty_face_region_for_restore"},
                    )
                    continue

                gpen_input_size = self._select_gpen_input_size(face_region)
                gpen_session = self._registry.get_gpen_session(gpen_input_size)
                if gpen_session is None:
                    continue

                restored_patch = self._run_gpen_on_patch(face_region, gpen_session, gpen_input_size)
                restored_patch_matched = match_histograms(
                    restored_patch,
                    face_region,
                    channel_axis=-1,
                ).astype(restored_patch.dtype)
                mask = self._create_feather_mask(
                    restored_patch.shape[0],
                    restored_patch.shape[1],
                    feather=30,
                )
                blended_region = (
                    restored_patch_matched.astype(np.float32) * mask
                    + img_bgr[y1:y2, x1:x2].astype(np.float32) * (1 - mask)
                )
                img_bgr[y1:y2, x1:x2] = blended_region.clip(0, 255).astype(np.uint8)

        logger.info(
            "swap_complete",
            extra={
                "event": "swap_complete",
                "face_count": len(faces),
                "skipped_faces": skipped_faces,
            },
        )
        return img_bgr
