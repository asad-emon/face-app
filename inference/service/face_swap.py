from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np
from PIL import Image
from skimage.exposure import match_histograms

from .model_registry import ModelRegistry, get_model_registry


@dataclass
class DummyFace:
    normed_embedding: np.ndarray


class FaceSwapService:
    def __init__(self, registry: Optional[ModelRegistry] = None):
        self._registry = registry or get_model_registry()

    @staticmethod
    def _run_gpen_on_patch(patch_bgr: np.ndarray, gpen_session) -> np.ndarray:
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
        faces = self._registry.get_face_analyzer().get(img_bgr)
        if not faces:
            return None
        return faces[0].normed_embedding

    def swap_with_embedding(self, pil_img: Image.Image, source_embedding: np.ndarray) -> Image.Image:
        img_rgb = np.array(pil_img)
        img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)

        self._registry.prepare_face_analyzer_for_image(img_bgr.shape)
        face_analyzer = self._registry.get_face_analyzer()
        swapper = self._registry.get_swapper()
        gpen_session = self._registry.get_gpen_session()

        faces = face_analyzer.get(img_bgr)
        norm = np.linalg.norm(source_embedding)
        embedding = source_embedding / norm if norm > 0 else source_embedding
        source_face = DummyFace(embedding)

        for face in faces:
            if face.normed_embedding is None:
                print("Warning: embedding not found for a face, skipping.")
                continue

            img_bgr = swapper.get(img_bgr, face, source_face, paste_back=True)

            if gpen_session is None:
                continue

            x1, y1, x2, y2 = self._enlarge_box(face.bbox.astype(int), img_bgr.shape, scale=1.6)
            face_region = img_bgr[y1:y2, x1:x2]
            if face_region.size == 0:
                print("Warning: face region is empty, skipping restoration.")
                continue

            restored_patch = self._run_gpen_on_patch(face_region, gpen_session)
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

        return Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))
