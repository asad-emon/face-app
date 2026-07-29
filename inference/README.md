
---
title: Face App
emoji: 💻
colorFrom: pink
colorTo: gray
sdk: docker
pinned: true
license: unknown
short_description: face swap application
---

Check out the configuration reference at https://huggingface.co/docs/hub/spaces-config-reference

## Model Cache

Model files are downloaded from `MODEL_REPO` through `huggingface_hub` and stored
in the hub-managed cache at `LOCAL_MODEL_DIR`.

- `inswapper_128.onnx`
- `GPEN-BFR-512.onnx`
- `Hyperswap_1b_256.onnx`
- `face_occluder.onnx` (optional, see below)

Default paths:

- `MODEL_REPO=asadujjaman-emon/face-app-models`
- `LOCAL_MODEL_DIR=models`

## Swap Pipeline

The swap models emit a small square — 128px for `inswapper_128`, 256px for
`hyperswap_256`. Everything after the model runs in a single upscaled aligned
crop (`FACE_SWAP_CROP_SIZE`, default 512) and reaches the image through one
warp:

1. the model output is scaled up into crop space (the swap's affine matrix is
   scaled with it, which is exact for a 2x3 affine),
2. the face mask is built at that resolution, so the blend edge is no longer a
   128px feather stretched across the face,
3. face restoration, when enabled, runs on the aligned face alone rather than
   on a rectangle of the finished frame that also contains hair and background,
4. the swapped face is tone-matched to the target pixels it is about to cover,
5. `paste_back` blends it into the frame.

Tuning:

- `FACE_SWAP_CROP_SIZE=512` — working resolution for masking, restoration and
  colour matching. Values below the model's own output size are ignored.
- `COLOR_MATCH_STRENGTH=0.8` — how far the swapped face's LAB mean/std is moved
  toward the target's. `0` disables colour matching.
- `RESTORE_BLEND=0.8` — how much of the restored face to keep when
  `enable_restore` is set. Lower values avoid plastic-looking skin.
- `OUTPUT_JPEG_QUALITY=95` — image output quality. Chroma subsampling is always
  disabled. Pass `output_format=png` to `/swap-remote` for lossless output.

## Face Mask

Swapped pixels are pasted back through a generated mask instead of the plain
square the swap models produce, so hair, glasses and image background around
the face survive the swap. The mask is the intersection of:

1. a feathered crop border,
2. the face silhouette from the 106-point landmarks (extended over the
   forehead), falling back to a canonical ellipse if landmarks are missing,
3. an occlusion mask, when a single-channel occluder model (XSeg style, e.g.
   `face_occluder.onnx`) is published in `MODEL_REPO`. Its soft output is used
   as-is rather than thresholded, so edges where a hand or strand of hair
   crosses the face stay smooth. It is looked up once per process; when absent
   the service logs `occluder_unavailable` and keeps using the geometric masks.
   Costs roughly 0.2s per face on CPU — noticeable for video, where it runs on
   every face of every frame.

Tuning:

- `FACE_MASK_BLUR=0.25` — edge feathering, as a fraction of the crop size
- `FACE_MASK_FOREHEAD_RATIO=0.55` — forehead coverage above the eyebrows, as a
  fraction of the brow-to-chin distance
- `FACE_MASK_ERODE=0.0` — optional inward bias on the silhouette before
  feathering, as a fraction of the crop size. Off by default: the feather
  already pulls the edge inward, and eroding further measurably costs identity
  (0.81 → 0.73 cosine at `0.05`). Raise it only if a swap bleeds past the jaw.
- `OCCLUSION_MASK_ENABLED=1` — set to `0` to skip the occluder entirely
- `OCCLUDER_MODEL_FILE=face_occluder.onnx`

## Video

Frames are decoded and encoded on one thread — neither `cv2.VideoCapture` nor
`cv2.VideoWriter` is thread-safe — while the swap itself runs on a worker pool.
Threads rather than processes: the swap is dominated by ONNX Runtime and OpenCV
calls that release the GIL, and workers share one copy of the models instead of
loading ~1 GB each. Output order is preserved, and the result is bit-identical
to serial processing.

- `VIDEO_WORKER_COUNT=0` — `0` auto-sizes to `min(4, cores / 2)`. Set a number
  to override.

Scaling is sub-linear, because ONNX Runtime already spreads each individual
inference across every core. Measured on 12 cores at 640x480 with two faces per
frame: 1.24x at 2 workers, 1.60x at 4, 1.78x at 6, 1.82x at 8. The auto default
stays at 4 so a video job doesn't starve concurrent image swaps; raise it on a
dedicated box.

## Evaluation

`inference/eval/run_eval.py` scores swap quality so pipeline changes can be
compared rather than eyeballed. Point it at a directory of source faces and a
directory of targets:

```
python -m eval.run_eval --sources eval/fixtures/sources \
                        --targets eval/fixtures/targets \
                        --out eval/out/baseline
```

It writes `metrics.csv` (identity retention, sharpness, tone match) and a
`contact_sheet.png` of source / target / result triples. Record a baseline
before changing the pipeline and re-run afterwards.
