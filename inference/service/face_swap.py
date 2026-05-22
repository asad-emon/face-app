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
    def __init__(self, registry: Optional[ModelRegistry] = None):
        self._registry = registry or get_model_registry()

    @staticmethod
    def _run_gpen_on_patch(patch_bgr: np.ndarray, gpen_session) -> np.ndarray:
        gpen_input_name = gpen_session.get_inputs()[0].name
        gpen_output_name = gpen_session.get_outputs()[0].name
        h, w = patch_bgr.shape[:2]

        patch_resized = cv2.resize(patch_bgr, (512, 512), interpolation=cv2.INTER_LINEAR)
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

    @staticmethod
    def _build_expression_template(face) -> Optional[np.ndarray]:
        kps = getattr(face, "kps", None)
        bbox = getattr(face, "bbox", None)
        if kps is None or bbox is None:
            return None
        if len(kps) < 5:
            return None

        x1, y1, x2, y2 = bbox.astype(np.float32)
        width = max(1.0, x2 - x1)
        height = max(1.0, y2 - y1)
        rel = np.empty((5, 2), dtype=np.float32)
        rel[:, 0] = (kps[:5, 0] - x1) / width
        rel[:, 1] = (kps[:5, 1] - y1) / height
        return np.clip(rel, 0.0, 1.0)

    @staticmethod
    def _get_hair_mask(img_bgr: np.ndarray, face, extend_ratio: float = 0.65) -> Optional[np.ndarray]:
        """
        Segment the hair region above and around the face, then extend it
        downward to simulate long hair. Returns a uint8 mask (0/255).
        """
        h, w = img_bgr.shape[:2]
        x1, y1, x2, y2 = face.bbox.astype(int)
        x1 = max(0, x1)
        y1 = max(0, y1)
        x2 = min(w - 1, x2)
        y2 = min(h - 1, y2)

        face_w = max(1, x2 - x1)
        face_h = max(1, y2 - y1)

        # Define the hair search ROI: above the face, extended horizontally
        roi_x1 = max(0, x1 - int(face_w * 0.45))
        roi_x2 = min(w - 1, x2 + int(face_w * 0.45))
        roi_y1 = 0
        roi_y2 = min(h - 1, y1 + int(face_h * 0.12))  # just past hairline

        if roi_y2 <= roi_y1 or roi_x2 <= roi_x1:
            return None

        roi = img_bgr[roi_y1:roi_y2, roi_x1:roi_x2].copy()
        roi_h, roi_w = roi.shape[:2]

        if roi_h < 6 or roi_w < 6:
            return None

        hair_mask_roi = np.zeros((roi_h, roi_w), dtype=np.uint8)

        # Primary method: GrabCut
        try:
            mask_gc = np.zeros((roi_h, roi_w), dtype=np.uint8)
            # Bottom strip (near forehead) is probable foreground
            strip = max(1, roi_h // 5)
            mask_gc[roi_h - strip:, :] = cv2.GC_PR_FGD
            rect = (1, 1, roi_w - 2, roi_h - 2)
            bgd_model = np.zeros((1, 65), np.float64)
            fgd_model = np.zeros((1, 65), np.float64)
            cv2.grabCut(roi, mask_gc, rect, bgd_model, fgd_model, 5, cv2.GC_INIT_WITH_RECT)
            hair_mask_roi = np.where(
                (mask_gc == cv2.GC_FGD) | (mask_gc == cv2.GC_PR_FGD), 255, 0
            ).astype(np.uint8)
        except Exception:
            # Fallback: dark pixel detection in HSV
            hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
            hair_mask_roi = (hsv[:, :, 2] < 90).astype(np.uint8) * 255

        # Morphological cleanup
        k_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
        k_open = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        hair_mask_roi = cv2.morphologyEx(hair_mask_roi, cv2.MORPH_CLOSE, k_close)
        hair_mask_roi = cv2.morphologyEx(hair_mask_roi, cv2.MORPH_OPEN, k_open)

        # Place ROI mask back in full-image space
        full_mask = np.zeros((h, w), dtype=np.uint8)
        full_mask[roi_y1:roi_y2, roi_x1:roi_x2] = hair_mask_roi

        # Extend hair downward (simulate long hair)
        extend_px = max(1, int(face_h * extend_ratio))
        ext_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, extend_px))
        full_mask = cv2.dilate(full_mask, ext_kernel)

        # Protect the inner face area so the face itself stays intact
        inner_x1 = max(0, x1 + int(face_w * 0.12))
        inner_x2 = min(w - 1, x2 - int(face_w * 0.12))
        inner_y1 = max(0, y1 + int(face_h * 0.05))
        inner_y2 = min(h - 1, y2)
        full_mask[inner_y1:inner_y2, inner_x1:inner_x2] = 0

        return full_mask

    def _apply_long_black_hair(self, img_bgr: np.ndarray, face) -> np.ndarray:
        """Replace hair with long black hair via segmentation + recoloring."""
        hair_mask = self._get_hair_mask(img_bgr, face)
        if hair_mask is None or not hair_mask.any():
            return img_bgr

        # Smooth edges
        blur_k = 21
        smooth = cv2.GaussianBlur(hair_mask.astype(np.float32), (blur_k, blur_k), 0) / 255.0
        alpha = smooth[..., None]

        # Very dark brown-black (not pure 0 to keep slight depth)
        black = np.full_like(img_bgr, 10, dtype=np.float32)
        # Add very subtle highlights so it doesn't look flat
        black[:, :, 0] = 8   # B
        black[:, :, 1] = 8   # G
        black[:, :, 2] = 12  # R (very slight warmth)

        result = black * alpha + img_bgr.astype(np.float32) * (1.0 - alpha)
        return result.clip(0, 255).astype(np.uint8)

    def _apply_source_expression(
        self,
        img_bgr: np.ndarray,
        face,
        source_expression_template: Optional[np.ndarray],
        strength: float = 0.75,
    ) -> np.ndarray:
        if source_expression_template is None:
            return img_bgr
        target_kps = getattr(face, "kps", None)
        if target_kps is None or len(target_kps) < 5:
            return img_bgr

        x1, y1, x2, y2 = self._enlarge_box(face.bbox.astype(int), img_bgr.shape, scale=1.35)
        roi = img_bgr[y1:y2, x1:x2]
        if roi.size == 0:
            return img_bgr

        h, w = roi.shape[:2]
        if h < 8 or w < 8:
            return img_bgr

        source_pts = source_expression_template[:5].astype(np.float32).copy()
        source_pts[:, 0] *= w
        source_pts[:, 1] *= h
        target_pts = target_kps[:5].astype(np.float32).copy()
        target_pts[:, 0] -= x1
        target_pts[:, 1] -= y1

        desired_pts = target_pts + (source_pts - target_pts) * np.clip(strength, 0.0, 1.0)
        transform, _ = cv2.estimateAffinePartial2D(
            target_pts,
            desired_pts,
            method=cv2.RANSAC,
            ransacReprojThreshold=3.0,
        )
        if transform is None:
            return img_bgr

        warped = cv2.warpAffine(
            roi,
            transform,
            (w, h),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REFLECT_101,
        )
        feather = max(8, min(25, min(h, w) // 10))
        mask = self._create_feather_mask(h, w, feather=feather)
        blended = warped.astype(np.float32) * mask + roi.astype(np.float32) * (1 - mask)
        img_bgr[y1:y2, x1:x2] = blended.clip(0, 255).astype(np.uint8)
        return img_bgr

    def _preserve_target_expression(
        self,
        img_bgr: np.ndarray,
        original_face,
        strength: float = 0.85,
    ) -> np.ndarray:
        """After a swap, warp the swapped face region back toward the target's
        original landmark positions, restoring the target's expression."""
        target_kps = getattr(original_face, "kps", None)
        if target_kps is None or len(target_kps) < 5:
            return img_bgr

        x1, y1, x2, y2 = self._enlarge_box(
            original_face.bbox.astype(int), img_bgr.shape, scale=1.35
        )
        roi = img_bgr[y1:y2, x1:x2]
        if roi.size == 0:
            return img_bgr

        h, w = roi.shape[:2]
        if h < 8 or w < 8:
            return img_bgr

        # Detect the new landmarks on the already-swapped image
        self._registry.prepare_face_analyzer_for_image(img_bgr.shape)
        swapped_faces = self._registry.get_face_analyzer().get(img_bgr)
        if not swapped_faces:
            return img_bgr

        # Pick the swapped face closest to the original bbox centre
        orig_cx = (original_face.bbox[0] + original_face.bbox[2]) / 2
        orig_cy = (original_face.bbox[1] + original_face.bbox[3]) / 2
        swapped_face = min(
            swapped_faces,
            key=lambda f: (
                (f.bbox[0] + f.bbox[2]) / 2 - orig_cx
            ) ** 2 + (
                (f.bbox[1] + f.bbox[3]) / 2 - orig_cy
            ) ** 2,
        )
        new_kps = getattr(swapped_face, "kps", None)
        if new_kps is None or len(new_kps) < 5:
            return img_bgr

        src_pts = new_kps[:5].astype(np.float32).copy()
        src_pts[:, 0] -= x1
        src_pts[:, 1] -= y1

        tgt_pts = target_kps[:5].astype(np.float32).copy()
        tgt_pts[:, 0] -= x1
        tgt_pts[:, 1] -= y1

        desired_pts = src_pts + (tgt_pts - src_pts) * np.clip(strength, 0.0, 1.0)

        transform, _ = cv2.estimateAffinePartial2D(
            src_pts,
            desired_pts,
            method=cv2.RANSAC,
            ransacReprojThreshold=3.0,
        )
        if transform is None:
            return img_bgr

        warped = cv2.warpAffine(
            roi,
            transform,
            (w, h),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REFLECT_101,
        )
        feather = max(8, min(25, min(h, w) // 10))
        mask = self._create_feather_mask(h, w, feather=feather)
        blended = (
            warped.astype(np.float32) * mask
            + roi.astype(np.float32) * (1 - mask)
        )
        img_bgr[y1:y2, x1:x2] = blended.clip(0, 255).astype(np.uint8)
        return img_bgr

    def extract_face_features(self, pil_img: Image.Image):
        """
        Returns (embedding, expression_template, gender_str) where
        gender_str is 'M', 'F', or None.
        """
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
            return None, None, None
        primary_face = faces[0]
        gender = _face_sex(primary_face)
        return (
            primary_face.normed_embedding,
            self._build_expression_template(primary_face),
            gender,
        )

    def extract_embedding(self, pil_img: Image.Image):
        embedding, _, _ = self.extract_face_features(pil_img)
        return embedding

    def swap_with_embedding(
        self,
        pil_img: Image.Image,
        source_embedding: np.ndarray,
        enable_restore: bool = False,
        preserve_source_expression: bool = False,
        source_expression_template: Optional[np.ndarray] = None,
        preserve_target_expression: bool = True,
        target_expression_strength: float = 0.85,
        source_gender: Optional[str] = None,
        apply_hair: bool = True,
    ) -> Image.Image:
        img_rgb = np.array(pil_img)
        img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)

        swapped_bgr = self.swap_frame_with_embedding(
            img_bgr,
            source_embedding,
            enable_restore=enable_restore,
            preserve_source_expression=preserve_source_expression,
            source_expression_template=source_expression_template,
            preserve_target_expression=preserve_target_expression,
            target_expression_strength=target_expression_strength,
            source_gender=source_gender,
            apply_hair=apply_hair,
        )

        return Image.fromarray(cv2.cvtColor(swapped_bgr, cv2.COLOR_BGR2RGB))

    def swap_frame_with_embedding(
        self,
        img_bgr: np.ndarray,
        source_embedding: np.ndarray,
        enable_restore: bool = False,
        preserve_source_expression: bool = False,
        source_expression_template: Optional[np.ndarray] = None,
        preserve_target_expression: bool = True,
        target_expression_strength: float = 0.85,
        source_gender: Optional[str] = None,
        apply_hair: bool = True,
    ) -> np.ndarray:
        img_bgr = np.ascontiguousarray(img_bgr)

        self._registry.prepare_face_analyzer_for_image(img_bgr.shape)
        face_analyzer = self._registry.get_face_analyzer()
        swapper = self._registry.get_swapper()
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

        skipped_faces = 0
        gender_skipped = 0
        swapped_face_objs = []

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

                # Gender filter: skip faces that don't match the source model's gender
                if source_gender is not None:
                    target_gender = _face_sex(face)
                    if target_gender is not None and target_gender != source_gender:
                        gender_skipped += 1
                        logger.info(
                            "gender_mismatch_skip",
                            extra={
                                "event": "gender_mismatch_skip",
                                "source_gender": source_gender,
                                "target_gender": target_gender,
                            },
                        )
                        continue

                img_bgr = swapper.get(img_bgr, face, source_face, paste_back=True)
                swapped_face_objs.append(face)

                if preserve_source_expression:
                    img_bgr = self._apply_source_expression(
                        img_bgr,
                        face,
                        source_expression_template=source_expression_template,
                    )
                if preserve_target_expression:
                    img_bgr = self._preserve_target_expression(
                        img_bgr, face, strength=target_expression_strength
                    )

                if enable_restore and gpen_session is not None:
                    x1, y1, x2, y2 = self._enlarge_box(face.bbox.astype(int), img_bgr.shape, scale=1.6)
                    face_region = img_bgr[y1:y2, x1:x2]
                    if face_region.size == 0:
                        skipped_faces += 1
                        logger.warning(
                            "empty_face_region_for_restore",
                            extra={"event": "empty_face_region_for_restore"},
                        )
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

        # Apply long black hair to each swapped face
        if apply_hair:
            for face in swapped_face_objs:
                try:
                    img_bgr = self._apply_long_black_hair(img_bgr, face)
                except Exception as exc:
                    logger.warning(
                        "hair_replacement_failed",
                        extra={"event": "hair_replacement_failed", "error": str(exc)},
                    )

        logger.info(
            "swap_complete",
            extra={
                "event": "swap_complete",
                "face_count": len(faces),
                "swapped_count": len(swapped_face_objs),
                "skipped_faces": skipped_faces,
                "gender_skipped": gender_skipped,
            },
        )
        return img_bgr
