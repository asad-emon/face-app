from dataclasses import dataclass
from typing import List, Optional, Tuple

import cv2
import numpy as np
from PIL import Image
from insightface.utils.face_align import estimate_norm

from .face_mask import (
    combine_masks,
    create_box_mask,
    create_ellipse_mask,
    create_occlusion_mask,
    create_region_mask,
    match_color_lab,
    paste_back,
)
from .model_registry import ModelRegistry, get_model_registry
from .observability import get_logger, timed_log
from .settings import get_settings

SWAP_MODEL_INSWAPPER = "inswapper_128"
SWAP_MODEL_HYPERSWAP = "hyperswap_256"
VALID_SWAP_MODELS = {SWAP_MODEL_INSWAPPER, SWAP_MODEL_HYPERSWAP}

# The face restoration model only accepts this resolution.
GPEN_INPUT_SIZE = 512


@dataclass
class DummyFace:
    normed_embedding: np.ndarray


logger = get_logger("inference.face_swap")

# Gender constants
GENDER_FEMALE = "F"
GENDER_MALE = "M"


def _face_sex(face) -> Optional[str]:
    """Return 'M' or 'F' from face.sex, or None if not available."""
    sex = getattr(face, "sex", None)
    if sex is None:
        return None
    s = str(sex).strip().upper()
    if s in ("M", "MALE"):
        return GENDER_MALE
    if s in ("F", "FEMALE"):
        return GENDER_FEMALE
    return None


class FaceSwapService:
    """Swaps faces by working entirely in a high-resolution aligned crop.

    The swap models emit small squares (128px for inswapper, 256px for
    hyperswap). Rather than pasting those straight back, every stage after the
    model - masking, restoration, colour matching - runs in one upscaled
    aligned frame, and the result reaches the image through a single warp. That
    keeps the blend edge at roughly display resolution and lets restoration see
    the face alone instead of a rectangle of hair and background.
    """

    def __init__(self, registry: Optional[ModelRegistry] = None):
        self._registry = registry or get_model_registry()
        self._settings = get_settings()

    @staticmethod
    def _run_gpen_on_patch(patch_bgr: np.ndarray, gpen_session) -> np.ndarray:
        gpen_input_name = gpen_session.get_inputs()[0].name
        gpen_output_name = gpen_session.get_outputs()[0].name
        h, w = patch_bgr.shape[:2]

        if (h, w) == (GPEN_INPUT_SIZE, GPEN_INPUT_SIZE):
            patch_resized = patch_bgr
        else:
            patch_resized = cv2.resize(
                patch_bgr,
                (GPEN_INPUT_SIZE, GPEN_INPUT_SIZE),
                interpolation=cv2.INTER_LINEAR,
            )

        blob = patch_resized.astype(np.float32) / 127.5 - 1.0
        blob = np.transpose(blob, (2, 0, 1))[np.newaxis, :]
        out = gpen_session.run([gpen_output_name], {gpen_input_name: blob})[0][0]
        out = np.transpose(out, (1, 2, 0))
        out = ((out + 1.0) * 127.5).clip(0, 255).astype(np.uint8)

        if out.shape[:2] == (h, w):
            return out
        return cv2.resize(out, (w, h), interpolation=cv2.INTER_LINEAR)

    def _build_swap_mask(
        self,
        aligned_bgr: np.ndarray,
        face,
        matrix: np.ndarray,
    ) -> np.ndarray:
        """Mask, in aligned-crop space, of the pixels the swap may replace.

        Combines a feathered crop border, the landmark-derived face silhouette
        and, when the occluder model is available, whatever covers the face.
        """
        size = aligned_bgr.shape[0]
        box_mask = create_box_mask(size, blur=self._settings.face_mask_blur)

        region_mask = None
        landmarks = getattr(face, "landmark_2d_106", None)
        if landmarks is not None:
            region_mask = create_region_mask(
                size,
                landmarks,
                matrix,
                forehead_ratio=self._settings.face_mask_forehead_ratio,
                erode_ratio=self._settings.face_mask_erode,
            )
        if region_mask is None:
            region_mask = create_ellipse_mask(size)

        occlusion_mask = None
        occluder_session = self._registry.get_occluder_session()
        if occluder_session is not None:
            try:
                occlusion_mask = create_occlusion_mask(aligned_bgr, occluder_session)
            except Exception as exc:
                logger.warning(
                    "occlusion_mask_failed",
                    extra={"event": "occlusion_mask_failed", "error": str(exc)},
                )

        mask = combine_masks(box_mask, region_mask, occlusion_mask)
        return box_mask if mask is None else mask

    def _upscale_to_crop_space(
        self,
        img_bgr: np.ndarray,
        model_output_bgr: np.ndarray,
        matrix: np.ndarray,
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Lift a swap model's small output into the working crop resolution.

        Returns (crop, aligned_target, matrix) all in that resolution. Scaling
        the output coordinates of a 2x3 affine is exact - both the linear part
        and the translation scale by the same factor - so no re-alignment is
        needed.
        """
        crop_size = max(model_output_bgr.shape[0], self._settings.face_swap_crop_size)
        scale = crop_size / model_output_bgr.shape[0]
        matrix_hi = matrix * scale

        if scale > 1.0:
            crop = cv2.resize(
                model_output_bgr,
                (crop_size, crop_size),
                interpolation=cv2.INTER_LANCZOS4,
            )
        else:
            crop = model_output_bgr

        aligned_target = cv2.warpAffine(
            img_bgr,
            matrix_hi,
            (crop_size, crop_size),
            flags=cv2.INTER_LINEAR,
            borderValue=0.0,
        )
        return crop, aligned_target, matrix_hi

    def _finalize_crop(
        self,
        img_bgr: np.ndarray,
        crop: np.ndarray,
        aligned_target: np.ndarray,
        face,
        matrix_hi: np.ndarray,
        gpen_session,
    ) -> np.ndarray:
        """Restore, colour match and paste one swapped crop into the frame."""
        mask = self._build_swap_mask(aligned_target, face, matrix_hi)

        if gpen_session is not None:
            with timed_log(logger, "restore_face", crop_size=crop.shape[0]):
                restored = self._run_gpen_on_patch(crop, gpen_session)
            blend = float(np.clip(self._settings.restore_blend, 0.0, 1.0))
            if blend < 1.0:
                crop = cv2.addWeighted(restored, blend, crop, 1.0 - blend, 0.0)
            else:
                crop = restored

        with timed_log(logger, "match_color", crop_size=crop.shape[0]):
            crop = match_color_lab(
                crop,
                aligned_target,
                mask,
                strength=self._settings.color_match_strength,
            )

        return paste_back(img_bgr, crop, mask, matrix_hi)

    def _run_inswapper(
        self,
        img_bgr: np.ndarray,
        face,
        source_face,
        swapper,
        gpen_session,
    ) -> np.ndarray:
        """Swap with inswapper, pasting back through our own face mask.

        insightface's built-in paste_back blends a plain eroded square, which
        bleeds swapped pixels onto hair, glasses and background; the mask built
        here follows the face itself.
        """
        bgr_fake, M = swapper.get(img_bgr, face, source_face, paste_back=False)
        bgr_fake = np.ascontiguousarray(bgr_fake)

        crop, aligned_target, matrix_hi = self._upscale_to_crop_space(img_bgr, bgr_fake, M)
        return self._finalize_crop(
            img_bgr, crop, aligned_target, face, matrix_hi, gpen_session
        )

    def _run_hyperswap(
        self,
        img_bgr: np.ndarray,
        face,
        source_embedding: np.ndarray,
        hyperswap_session,
        gpen_session,
    ) -> np.ndarray:
        kps = getattr(face, "kps", None)
        if kps is None or len(kps) < 5:
            return img_bgr

        M = estimate_norm(kps[:5].astype(np.float32), 256, mode="arcface")
        if M is None:
            return img_bgr
        aimg = cv2.warpAffine(img_bgr, M, (256, 256), flags=cv2.INTER_LINEAR)

        emb = np.asarray(source_embedding, dtype=np.float32).ravel()
        norm = np.linalg.norm(emb)
        emb = (emb / norm) if norm > 0 else emb
        emb_batch = emb[np.newaxis, :]

        target_rgb = aimg[:, :, ::-1].copy().astype(np.float32)
        target_norm = target_rgb / 127.5 - 1.0
        target_batch = np.transpose(target_norm, (2, 0, 1))[np.newaxis, :].astype(np.float32)

        feed = {}
        for inp in hyperswap_session.get_inputs():
            if len(inp.shape) == 4:
                feed[inp.name] = target_batch
            else:
                feed[inp.name] = emb_batch

        out = hyperswap_session.run([hyperswap_session.get_outputs()[0].name], feed)[0]
        swapped = out[0]
        if swapped.shape[0] == 3:
            swapped = np.transpose(swapped, (1, 2, 0))

        swapped_uint8 = ((swapped + 1.0) * 127.5).clip(0, 255).astype(np.uint8)
        swapped_bgr = np.ascontiguousarray(swapped_uint8[:, :, ::-1])

        crop, aligned_target, matrix_hi = self._upscale_to_crop_space(
            img_bgr, swapped_bgr, M
        )
        return self._finalize_crop(
            img_bgr, crop, aligned_target, face, matrix_hi, gpen_session
        )

    @staticmethod
    def _select_faces(faces, source_gender: Optional[str]) -> Tuple[List, int]:
        """Apply the gender filter, returning (faces to swap, skipped count).

        Faces whose gender the detector couldn't determine are always kept. If
        the filter would reject every face in a single-face image the filter is
        dropped for that image: genderage misclassifies often enough that the
        alternative - returning the target untouched with a 200 - looks
        identical to a broken swap.
        """
        if source_gender is None:
            return list(faces), 0

        selected = [
            face
            for face in faces
            if (_face_sex(face) or source_gender) == source_gender
        ]
        if not selected and len(faces) == 1:
            logger.info(
                "gender_filter_fallback",
                extra={
                    "event": "gender_filter_fallback",
                    "source_gender": source_gender,
                    "target_gender": _face_sex(faces[0]),
                },
            )
            return list(faces), 0

        skipped = len(faces) - len(selected)
        if skipped:
            logger.info(
                "gender_mismatch_skip",
                extra={
                    "event": "gender_mismatch_skip",
                    "source_gender": source_gender,
                    "skipped_count": skipped,
                },
            )
        return selected, skipped

    def extract_face_features(self, pil_img: Image.Image):
        """Returns (embedding, gender) where gender is 'M', 'F', or None."""
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
            return None, None
        primary_face = faces[0]
        return primary_face.normed_embedding, _face_sex(primary_face)

    def extract_embedding(self, pil_img: Image.Image):
        embedding, _ = self.extract_face_features(pil_img)
        return embedding

    def swap_with_embedding(
        self,
        pil_img: Image.Image,
        source_embedding: np.ndarray,
        enable_restore: bool = False,
        source_gender: Optional[str] = None,
        swap_model: str = SWAP_MODEL_INSWAPPER,
    ) -> Image.Image:
        img_rgb = np.array(pil_img)
        img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)

        swapped_bgr = self.swap_frame_with_embedding(
            img_bgr,
            source_embedding,
            enable_restore=enable_restore,
            source_gender=source_gender,
            swap_model=swap_model,
        )

        return Image.fromarray(cv2.cvtColor(swapped_bgr, cv2.COLOR_BGR2RGB))

    def swap_frame_with_embedding(
        self,
        img_bgr: np.ndarray,
        source_embedding: np.ndarray,
        enable_restore: bool = False,
        source_gender: Optional[str] = None,
        swap_model: str = SWAP_MODEL_INSWAPPER,
    ) -> np.ndarray:
        img_bgr = np.ascontiguousarray(img_bgr)
        use_hyperswap = swap_model == SWAP_MODEL_HYPERSWAP

        self._registry.prepare_face_analyzer_for_image(img_bgr.shape)
        face_analyzer = self._registry.get_face_analyzer()
        swapper = None if use_hyperswap else self._registry.get_swapper()
        hyperswap_session = self._registry.get_hyperswap_session() if use_hyperswap else None
        gpen_session = self._registry.get_gpen_session() if enable_restore else None

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

        selected_faces, gender_skipped = self._select_faces(faces, source_gender)

        skipped_faces = 0
        swapped_count = 0

        with timed_log(
            logger,
            "swap_faces",
            face_count=len(selected_faces),
            restore_enabled=enable_restore,
        ):
            for face in selected_faces:
                if face.normed_embedding is None:
                    skipped_faces += 1
                    logger.warning(
                        "missing_face_embedding",
                        extra={"event": "missing_face_embedding"},
                    )
                    continue

                if use_hyperswap:
                    img_bgr = self._run_hyperswap(
                        img_bgr, face, source_embedding, hyperswap_session, gpen_session
                    )
                else:
                    img_bgr = self._run_inswapper(
                        img_bgr, face, source_face, swapper, gpen_session
                    )
                swapped_count += 1

        logger.info(
            "swap_complete",
            extra={
                "event": "swap_complete",
                "face_count": len(faces),
                "swapped_count": swapped_count,
                "skipped_faces": skipped_faces,
                "gender_skipped": gender_skipped,
            },
        )
        return img_bgr
