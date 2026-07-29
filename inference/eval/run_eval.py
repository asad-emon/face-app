"""Score swap quality so pipeline changes can be compared, not eyeballed.

Runs the swap service in-process over every (source, target) pair and reports
three metrics per pair:

* identity   - cosine similarity between the source embedding and the embedding
               re-extracted from the swapped face. Higher is better; this is
               what the swap is for.
* sharpness  - variance of the Laplacian inside the swapped face box, relative
               to the same measure on the original target face. ~1.0 means the
               swap preserved the target's level of detail; well below 1.0
               means the pipeline is blurring the face, well above it can mean
               over-sharpening from restoration.
* tone_delta - mean LAB distance between the swapped face and the target face
               it replaced. The target face is by definition lit correctly for
               the scene, so a swap that adapted to the scene's lighting scores
               low and a swap that kept the source's own tone scores high. This
               is what the "pasted-on" look measures as.

               (An earlier version compared the face against a ring of
               surrounding pixels; on anything but a tight portrait that ring
               is mostly background and the metric doesn't discriminate.)

Usage:

    python -m eval.run_eval --sources fixtures/sources --targets fixtures/targets \
                            --out out/baseline [--restore] [--swap-model hyperswap_256]

Run it once before a pipeline change and once after, then diff the CSVs.
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path
from typing import List, Optional, Tuple

import cv2
import numpy as np
from PIL import Image

# Allow both `python -m eval.run_eval` from inference/ and a direct path run.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from service.face_swap import (  # noqa: E402
    SWAP_MODEL_INSWAPPER,
    VALID_SWAP_MODELS,
    FaceSwapService,
)

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def list_images(directory: Path) -> List[Path]:
    return sorted(p for p in directory.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    a = np.asarray(a, dtype=np.float32).ravel()
    b = np.asarray(b, dtype=np.float32).ravel()
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom <= 0:
        return float("nan")
    return float(np.dot(a, b) / denom)


def _clip_box(bbox, shape) -> Optional[Tuple[int, int, int, int]]:
    h, w = shape[:2]
    x1, y1, x2, y2 = (int(v) for v in bbox)
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)
    if x2 - x1 < 8 or y2 - y1 < 8:
        return None
    return x1, y1, x2, y2


def sharpness(img_bgr: np.ndarray, bbox) -> float:
    box = _clip_box(bbox, img_bgr.shape)
    if box is None:
        return float("nan")
    x1, y1, x2, y2 = box
    gray = cv2.cvtColor(img_bgr[y1:y2, x1:x2], cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _face_lab_mean(img_bgr: np.ndarray, bbox) -> Optional[np.ndarray]:
    box = _clip_box(bbox, img_bgr.shape)
    if box is None:
        return None
    x1, y1, x2, y2 = box
    lab = cv2.cvtColor(img_bgr[y1:y2, x1:x2], cv2.COLOR_BGR2LAB).astype(np.float32)
    return lab.reshape(-1, 3).mean(axis=0)


def tone_delta(result_bgr: np.ndarray, result_bbox, target_bgr: np.ndarray, target_bbox) -> float:
    """LAB distance between the swapped face and the face it replaced."""
    after = _face_lab_mean(result_bgr, result_bbox)
    before = _face_lab_mean(target_bgr, target_bbox)
    if after is None or before is None:
        return float("nan")
    return float(np.linalg.norm(after - before))


def primary_face(service: FaceSwapService, img_bgr: np.ndarray):
    """Largest detected face, or None."""
    service._registry.prepare_face_analyzer_for_image(img_bgr.shape)
    faces = service._registry.get_face_analyzer().get(img_bgr)
    if not faces:
        return None
    return max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))


def contact_sheet(rows: List[Tuple[np.ndarray, np.ndarray, np.ndarray]], cell: int = 320):
    """Stack source / target / result triples into one image."""
    def fit(img: np.ndarray) -> np.ndarray:
        h, w = img.shape[:2]
        scale = cell / max(h, w)
        resized = cv2.resize(img, (max(1, int(w * scale)), max(1, int(h * scale))))
        canvas = np.zeros((cell, cell, 3), dtype=np.uint8)
        rh, rw = resized.shape[:2]
        top, left = (cell - rh) // 2, (cell - rw) // 2
        canvas[top:top + rh, left:left + rw] = resized
        return canvas

    return np.vstack([np.hstack([fit(i) for i in row]) for row in rows])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", type=Path, required=True)
    parser.add_argument("--targets", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--restore", action="store_true", help="enable face restoration")
    parser.add_argument("--swap-model", default=SWAP_MODEL_INSWAPPER, choices=sorted(VALID_SWAP_MODELS))
    parser.add_argument("--limit", type=int, default=0, help="cap on pairs, 0 for all")
    args = parser.parse_args()

    source_paths = list_images(args.sources)
    target_paths = list_images(args.targets)
    if not source_paths or not target_paths:
        parser.error("both --sources and --targets must contain images")

    args.out.mkdir(parents=True, exist_ok=True)
    service = FaceSwapService()

    rows = []
    sheet_rows = []
    pairs = [(s, t) for s in source_paths for t in target_paths]
    if args.limit:
        pairs = pairs[: args.limit]

    for source_path, target_path in pairs:
        source_pil = Image.open(source_path).convert("RGB")
        embedding, gender = service.extract_face_features(source_pil)
        if embedding is None:
            print(f"skip: no face in source {source_path.name}")
            continue

        target_pil = Image.open(target_path).convert("RGB")
        target_bgr = cv2.cvtColor(np.array(target_pil), cv2.COLOR_RGB2BGR)
        target_face = primary_face(service, target_bgr)
        if target_face is None:
            print(f"skip: no face in target {target_path.name}")
            continue

        before_sharp = sharpness(target_bgr, target_face.bbox)

        result_pil = service.swap_with_embedding(
            target_pil,
            embedding,
            enable_restore=args.restore,
            source_gender=gender,
            swap_model=args.swap_model,
        )
        result_bgr = cv2.cvtColor(np.array(result_pil), cv2.COLOR_RGB2BGR)

        result_face = primary_face(service, result_bgr)
        if result_face is None:
            print(f"warn: no face detected in result for {source_path.name} -> {target_path.name}")
            identity = float("nan")
            after_sharp = after_tone = float("nan")
        else:
            identity = cosine(embedding, result_face.normed_embedding)
            after_sharp = sharpness(result_bgr, result_face.bbox)
            after_tone = tone_delta(
                result_bgr, result_face.bbox, target_bgr, target_face.bbox
            )

        stem = f"{source_path.stem}__{target_path.stem}"
        cv2.imwrite(str(args.out / f"{stem}.png"), result_bgr)

        rows.append(
            {
                "source": source_path.name,
                "target": target_path.name,
                "identity": round(identity, 4),
                "sharpness_ratio": round(after_sharp / before_sharp, 4)
                if before_sharp
                else float("nan"),
                "tone_delta": round(after_tone, 4),
            }
        )
        sheet_rows.append(
            (
                cv2.cvtColor(np.array(source_pil), cv2.COLOR_RGB2BGR),
                target_bgr,
                result_bgr,
            )
        )
        print(f"{stem}: identity={identity:.3f} tone_delta={after_tone:.1f}")

    if not rows:
        print("no usable pairs")
        return 1

    csv_path = args.out / "metrics.csv"
    with csv_path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    cv2.imwrite(str(args.out / "contact_sheet.png"), contact_sheet(sheet_rows))

    identities = [r["identity"] for r in rows if not np.isnan(r["identity"])]
    tones = [r["tone_delta"] for r in rows if not np.isnan(r["tone_delta"])]
    print(f"\n{len(rows)} pairs -> {csv_path}")
    if identities:
        print(f"mean identity   : {np.mean(identities):.4f}")
    if tones:
        print(f"mean tone_delta : {np.mean(tones):.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
