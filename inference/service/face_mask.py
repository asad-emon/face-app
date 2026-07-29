"""Face mask generation for pasting a swapped face back into the frame.

The swap models only ever see an aligned square crop, so every mask here is
built in that aligned space (same coordinate frame as the model output) and is
warped back into the frame together with the swapped pixels.

Three components are combined by intersection:

* box mask      - feathers the crop border so the paste has no hard seam
* region mask   - the actual face silhouette from the 106-point landmarks,
                  extended upward over the forehead (falls back to a canonical
                  ellipse when dense landmarks are unavailable)
* occlusion mask- optional, model driven: keeps hands/hair/objects that cover
                  the face in front of the swapped pixels

`match_color_lab` and `paste_back` then apply the mask: the first adapts the
swapped face's tone to the target pixels it is about to cover, the second warps
the crop back into the frame and blends it.
"""

from typing import Optional, Sequence, Tuple

import cv2
import numpy as np

from .observability import get_logger

logger = get_logger("inference.face_mask")

# (top, right, bottom, left) as fractions of the crop size.
Padding = Tuple[float, float, float, float]

DEFAULT_MASK_BLUR = 0.25
DEFAULT_MASK_PADDING: Padding = (0.0, 0.0, 0.0, 0.0)
# Forehead height as a fraction of the brow-to-chin distance. The landmark set
# stops at the eyebrows, so without this the hairline area would be excluded.
DEFAULT_FOREHEAD_RATIO = 0.55
# Optional inward bias on the silhouette before feathering, as a fraction of the
# crop size. Off by default: the feather below already pulls the effective edge
# inward, and eroding on top of it measurably costs identity (0.81 -> 0.73
# cosine at 0.05) by handing the face border back to the target. Exposed for
# targets where the swap bleeds past the jaw.
DEFAULT_ERODE_RATIO = 0.0

_BOX_MASK_CACHE: dict = {}


def create_box_mask(
    size: int,
    blur: float = DEFAULT_MASK_BLUR,
    padding: Padding = DEFAULT_MASK_PADDING,
) -> np.ndarray:
    """Feathered rectangle covering the aligned crop.

    Cached per (size, blur, padding); the returned array is read-only.
    """
    key = (size, round(float(blur), 4), tuple(round(float(p), 4) for p in padding))
    cached = _BOX_MASK_CACHE.get(key)
    if cached is not None:
        return cached

    blur_amount = int(size * 0.5 * max(0.0, blur))
    blur_area = max(blur_amount // 2, 1)
    pad_top, pad_right, pad_bottom, pad_left = padding

    mask = np.ones((size, size), dtype=np.float32)
    mask[: max(blur_area, int(size * pad_top)), :] = 0
    mask[size - max(blur_area, int(size * pad_bottom)) :, :] = 0
    mask[:, : max(blur_area, int(size * pad_left))] = 0
    mask[:, size - max(blur_area, int(size * pad_right)) :] = 0

    if blur_amount > 0:
        mask = cv2.GaussianBlur(mask, (0, 0), blur_amount * 0.25)

    mask = np.clip(mask, 0.0, 1.0)
    mask.flags.writeable = False
    _BOX_MASK_CACHE[key] = mask
    return mask


def create_ellipse_mask(size: int, feather_ratio: float = 0.06) -> np.ndarray:
    """Canonical face-shaped ellipse for the aligned crop.

    Used when dense landmarks are unavailable. Because the crop is arcface
    aligned the face always sits in the same place, so fixed proportions hold.
    """
    mask = np.zeros((size, size), dtype=np.float32)
    cv2.ellipse(
        mask,
        (int(size * 0.5), int(size * 0.52)),
        (int(size * 0.44), int(size * 0.50)),
        0,
        0,
        360,
        1.0,
        -1,
    )
    sigma = max(1.0, size * feather_ratio)
    return np.clip(cv2.GaussianBlur(mask, (0, 0), sigma), 0.0, 1.0)


def transform_points(points: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    """Apply a 2x3 affine matrix to an (N, 2) point array."""
    pts = np.asarray(points, dtype=np.float32).reshape(-1, 1, 2)
    return cv2.transform(pts, matrix).reshape(-1, 2)


def create_region_mask(
    size: int,
    landmarks: Sequence[Sequence[float]],
    matrix: np.ndarray,
    forehead_ratio: float = DEFAULT_FOREHEAD_RATIO,
    feather_ratio: float = 0.05,
    erode_ratio: float = DEFAULT_ERODE_RATIO,
) -> Optional[np.ndarray]:
    """Face silhouette mask from dense landmarks, in aligned-crop space.

    `landmarks` are in frame coordinates; `matrix` is the frame -> aligned crop
    affine used for the swap. Returns None when the landmarks are too sparse to
    describe a silhouette.
    """
    pts = np.asarray(landmarks, dtype=np.float32)
    if pts.ndim != 2 or pts.shape[0] < 68:
        return None

    pts = transform_points(pts[:, :2], matrix)

    brow_y = float(pts[:, 1].min())
    chin_y = float(pts[:, 1].max())
    face_height = chin_y - brow_y
    if face_height <= 1.0:
        return None

    # The 106-point set stops at the eyebrows: lift the upper points to cover
    # the forehead so the swapped skin reaches the hairline.
    upper = pts[pts[:, 1] < brow_y + face_height * 0.3].copy()
    if len(upper) > 0:
        upper[:, 1] -= face_height * max(0.0, forehead_ratio)
        pts = np.vstack([pts, upper])

    hull = cv2.convexHull(pts.astype(np.float32))
    mask = np.zeros((size, size), dtype=np.float32)
    cv2.fillConvexPoly(mask, hull.astype(np.int32), 1.0)

    erode_px = int(size * max(0.0, erode_ratio))
    if erode_px > 0:
        kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (erode_px * 2 + 1, erode_px * 2 + 1)
        )
        mask = cv2.erode(mask, kernel)

    sigma = max(1.0, size * feather_ratio)
    return np.clip(cv2.GaussianBlur(mask, (0, 0), sigma), 0.0, 1.0)


def create_occlusion_mask(crop_bgr: np.ndarray, session) -> Optional[np.ndarray]:
    """Mask of the unoccluded face area, from a single-channel occluder model.

    Returns None if the session's signature isn't the expected one so the
    caller can fall back to the geometric masks.
    """
    size = crop_bgr.shape[0]
    model_input = session.get_inputs()[0]
    shape = model_input.shape

    def _dim(value, default: int) -> int:
        return value if isinstance(value, int) and value > 0 else default

    channels_last = isinstance(shape[-1], int) and shape[-1] == 3
    if channels_last:
        in_h, in_w = _dim(shape[1], 256), _dim(shape[2], 256)
    else:
        in_h, in_w = _dim(shape[2], 256), _dim(shape[3], 256)

    resized = cv2.resize(crop_bgr, (in_w, in_h), interpolation=cv2.INTER_AREA)
    blob = resized[:, :, ::-1].astype(np.float32) / 255.0
    blob = blob[np.newaxis] if channels_last else np.transpose(blob, (2, 0, 1))[np.newaxis]

    output = session.run(None, {model_input.name: blob})[0]
    output = np.squeeze(np.asarray(output, dtype=np.float32))
    if output.ndim != 2:
        logger.warning(
            "occlusion_mask_unexpected_output",
            extra={
                "event": "occlusion_mask_unexpected_output",
                "output_shape": list(np.asarray(output).shape),
            },
        )
        return None

    # Keep the model's soft alpha: thresholding it stair-steps the edge where a
    # hand or strand of hair crosses the face.
    mask = np.clip(output, 0.0, 1.0).astype(np.float32)
    mask = cv2.resize(mask, (size, size), interpolation=cv2.INTER_LINEAR)
    sigma = max(1.0, size * 0.02)
    return np.clip(cv2.GaussianBlur(mask, (0, 0), sigma), 0.0, 1.0)


def combine_masks(*masks: Optional[np.ndarray]) -> Optional[np.ndarray]:
    """Intersect every available mask; the strictest one wins per pixel."""
    combined = None
    for mask in masks:
        if mask is None:
            continue
        combined = mask if combined is None else np.minimum(combined, mask)
    return None if combined is None else np.clip(combined, 0.0, 1.0)


def match_color_lab(
    crop_bgr: np.ndarray,
    reference_bgr: np.ndarray,
    mask: Optional[np.ndarray] = None,
    strength: float = 0.8,
) -> np.ndarray:
    """Shift `crop_bgr`'s LAB mean/std toward `reference_bgr`.

    Both images are in the same aligned-crop space, and `mask` selects the
    pixels the swap will actually replace — statistics are taken over that
    region only, so hair and background around the face don't drag the skin
    tone. Mean/std transfer is used rather than histogram matching: on a single
    small crop a histogram match is noisy enough to swing skin tone visibly,
    and it costs considerably more on CPU.
    """
    if strength <= 0.0:
        return crop_bgr

    crop_lab = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    ref_lab = cv2.cvtColor(reference_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)

    if mask is None:
        weights = np.ones(crop_lab.shape[:2], dtype=np.float32)
    else:
        weights = np.clip(mask, 0.0, 1.0).astype(np.float32)
    total = float(weights.sum())
    if total < 1.0:
        return crop_bgr

    w = weights[..., None]
    crop_mean = (crop_lab * w).sum(axis=(0, 1)) / total
    ref_mean = (ref_lab * w).sum(axis=(0, 1)) / total
    crop_std = np.sqrt(((crop_lab - crop_mean) ** 2 * w).sum(axis=(0, 1)) / total)
    ref_std = np.sqrt(((ref_lab - ref_mean) ** 2 * w).sum(axis=(0, 1)) / total)

    # A near-zero std means a flat channel; leave it alone rather than divide.
    scale = np.where(crop_std > 1e-3, ref_std / np.maximum(crop_std, 1e-3), 1.0)
    matched = (crop_lab - crop_mean) * scale + ref_mean

    blended = crop_lab + (matched - crop_lab) * float(np.clip(strength, 0.0, 1.0))
    blended = np.clip(blended, 0.0, 255.0).astype(np.uint8)
    return cv2.cvtColor(blended, cv2.COLOR_LAB2BGR)


def paste_back(
    target_bgr: np.ndarray,
    crop_bgr: np.ndarray,
    mask: np.ndarray,
    matrix: np.ndarray,
) -> np.ndarray:
    """Blend an aligned crop back into the frame using `mask`.

    `matrix` is the frame -> crop affine. Only the region the crop actually
    lands on is warped, which keeps full-HD video frames cheap.
    """
    frame_h, frame_w = target_bgr.shape[:2]
    crop_h, crop_w = crop_bgr.shape[:2]
    inverse = cv2.invertAffineTransform(matrix)

    corners = np.array(
        [[0, 0], [crop_w, 0], [crop_w, crop_h], [0, crop_h]], dtype=np.float32
    )
    projected = transform_points(corners, inverse)
    x1 = max(0, int(np.floor(projected[:, 0].min())) - 1)
    y1 = max(0, int(np.floor(projected[:, 1].min())) - 1)
    x2 = min(frame_w, int(np.ceil(projected[:, 0].max())) + 1)
    y2 = min(frame_h, int(np.ceil(projected[:, 1].max())) + 1)
    if x2 <= x1 or y2 <= y1:
        return target_bgr

    roi_inverse = inverse.copy()
    roi_inverse[0, 2] -= x1
    roi_inverse[1, 2] -= y1
    roi_w, roi_h = x2 - x1, y2 - y1

    warped_crop = cv2.warpAffine(
        crop_bgr,
        roi_inverse,
        (roi_w, roi_h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE,
    )
    warped_mask = cv2.warpAffine(
        mask,
        roi_inverse,
        (roi_w, roi_h),
        flags=cv2.INTER_LINEAR,
        borderValue=0.0,
    )
    alpha = np.clip(warped_mask, 0.0, 1.0)[:, :, np.newaxis]

    roi = target_bgr[y1:y2, x1:x2]
    blended = warped_crop.astype(np.float32) * alpha + roi.astype(np.float32) * (1.0 - alpha)
    target_bgr[y1:y2, x1:x2] = blended.clip(0, 255).astype(np.uint8)
    return target_bgr
