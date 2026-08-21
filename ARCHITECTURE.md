# Architecture

## Overview

**face-app** is an AI face-swap studio: users build reusable "face models" from
reference photos, then apply them to target images or videos (self-uploaded or
sourced from [Civitai](https://civitai.com)) to produce face-swapped output.

It is a **monorepo of three independently deployable services**:

```
face-app/
├── client/       React 18 SPA (Vite, Chakra UI)
├── api/          Node.js / Express REST API + job workers (MongoDB)
└── inference/    Python / FastAPI ML microservice (InsightFace, ONNX Runtime)
```

```
┌──────────┐        ┌─────────────┐        ┌────────────────┐
│  client  │──HTTP─▶│     api     │──HTTP─▶│   inference     │
│ (React)  │◀───────│ (Express)   │◀───────│ (FastAPI/ONNX)  │
└──────────┘        └──────┬──────┘        └────────┬────────┘
                            │                        │
                       ┌────▼────┐          ┌────────▼────────┐
                       │ MongoDB │          │ HF model repo    │
                       └─────────┘          │ (weights cache)  │
                            │               └──────────────────┘
                  ┌─────────▼─────────┐
                  │ Storage (pluggable)│
                  │ Google Drive  or   │
                  │ Hugging Face Hub   │
                  └────────────────────┘
```

The `api` also proxies the Civitai API so the client can browse community
images/models without exposing the user's Civitai token to a third-party
origin.

## Services

### `client/` — React SPA

- Vite build, Chakra UI + Emotion for styling, Framer Motion for animation.
- Tabbed shell (`App.jsx`): Model Upload, Swap, Gallery, Civitai, Settings.
- `contexts/AppContext.jsx` — global auth token (JWT in localStorage, or
  parsed from an OAuth redirect hash), user settings, polling/waking the
  inference service (`InferenceStatusBanner`).
- `features/swap/` — swap workflow: model selection, target image queueing,
  video swap UI, input-image gallery.
- Talks only to `api`; never calls `inference` or Civitai directly.
- Dev server on port 5000/3000; served via nginx in production (Docker) or
  as static `dist/` on cPanel.

### `api/` — Express backend

Entry point: `api/src/server.js`. Responsibilities: auth, domain data
(MongoDB via Mongoose), file storage abstraction, job orchestration, and
proxying to `inference` and Civitai.

Key modules (`api/src/`):

| File | Responsibility |
|---|---|
| `db.js` | Mongoose schemas: `User`, `FaceModel`, `InputImage`, `GeneratedImage`, `GeneratedVideo`, `SwapJob`, `UserSettings`, `Counter` (auto-increment numeric IDs alongside Mongo ObjectIds) |
| `config.js` | Centralized env var loading (storage provider selection, JWT, timeouts, etc.) |
| `routes/auth.js` | Email/password auth (bcrypt + JWT) + Google OAuth2 login (also grants a per-user Drive refresh token) |
| `routes/models.js` | Face-model upload/versioning; `/models/generate` calls inference `/embedding` |
| `routes/images.js` | Input image upload/list/delete; generated-image list/rate/delete/download |
| `routes/videos.js` | Generated video listing, status, range-request streaming, delete |
| `routes/swaps.js` | `/swap-jobs` (async queued), `/swap` (sync), `/swap-video` (async video job) |
| `routes/internal.js` | Callback endpoints the inference service posts results/progress to (shared-token auth) |
| `routes/civitai.js` | Authenticated proxy to `civitai.com/api/v1`, validates image-proxy URLs stay on `civitai.com` |
| `routes/settings.js`, `routes/inference.js`, `routes/system.js` | User settings, inference health/wake probe, root healthcheck |
| `services/storage.js` | Provider-agnostic facade (`uploadBuffer`/`downloadBuffer`/`downloadRange`/`deleteFile`) dispatching to Drive or HF per-record `storage_provider` field |
| `services/driveStorage.js` | Google Drive backend (googleapis, per-user OAuth refresh token) |
| `services/hfStorage.js` | Hugging Face Hub backend (`@huggingface/hub`), retries on 409/412/429 |
| `services/swapService.js` | In-memory FIFO job queues (image + video), single active worker per queue, restart re-hydration of stuck jobs, input-file cleanup |
| `services/modelService.js` | Face-model versioning, "active model per person" logic |
| `middleware/auth.js` | `requireAuth` (JWT bearer), `requireInferenceAuth` (shared internal token) |
| `middleware/upload.js` | multer memory storage, 200MB limit |

No formal migration system — the Mongoose schema evolves via additive/optional
fields (e.g. `storage_provider`, `gender`) to stay compatible with older
documents.

### `inference/` — FastAPI ML microservice

Entry point: `inference/app.py` (uvicorn) → `inference/service/api.py`
(FastAPI routes). CPU-only ONNX Runtime; typically deployed as a Hugging Face
Space (Docker SDK).

| File | Responsibility |
|---|---|
| `service/api.py` | Routes: `/health`, `/warmup`, `/embedding`, `/swap-remote`, `/swap-remote-video`; structured request-timing middleware |
| `service/face_swap.py` | `FaceSwapService` — face detection/selection, running `inswapper_128`/`hyperswap_256`, optional GPEN-BFR-512 restoration, colour match, paste-back |
| `service/face_mask.py` | Builds the blend mask: feathered box + landmark-derived face silhouette + optional ONNX occlusion mask (hands/hair/objects); LAB colour matching; final affine paste-back |
| `service/model_registry.py` | Lazy thread-safe singleton loader/cache for ONNX models, downloaded from a Hugging Face model repo (`MODEL_REPO`) via `huggingface_hub`; manages InsightFace `FaceAnalysis` (`buffalo_l`) |
| `service/video_swap.py` | Thread-pool-parallel per-frame swap for video (decode/encode single-threaded, swap fanned out across `VIDEO_WORKER_COUNT` threads) |
| `service/settings.py` | Env-driven config (`lru_cache`) |
| `service/observability.py` | JSON structured logging, `timed_log` timing helper |
| `preload_models.py` | Pre-downloads/warms model cache at Docker build time |
| `eval/run_eval.py` | Offline harness: identity-retention (cosine similarity), sharpness, tone-match vs. a fixture set — run manually before/after pipeline changes, not CI-gated |

## Data flow

### Image swap (typical)

1. Client uploads face photos → `POST /models/generate` (api) → api calls
   inference `POST /embedding` → inference returns a `.safetensors` blob
   (face embedding + detected gender) → api stores it via the storage
   abstraction and creates a `FaceModel` document.
2. Client uploads a target photo → `POST /images` → stored via the storage
   abstraction → `InputImage` document created.
3. Client requests a swap → `POST /swap-jobs` (async, queued) or `POST /swap`
   (sync) → api validates ownership, downloads both binaries from storage,
   sends them to inference `POST /swap-remote` → inference detects/selects
   the face, runs the swap model, builds the mask, optionally restores
   (GPEN), colour-matches, pastes back, and returns image bytes → api
   uploads the result, creates a `GeneratedImage` document, updates
   `SwapJob` status, and (if `save_input_files` is off) deletes the input.
4. Client polls `GET /swap-jobs?ids=...` or fetches `GET /images/generated`.

### Video swap (fully async)

The video path is deliberately asynchronous because a video swap can take much
longer than a browser request should remain open. The client submits the work,
the API persists it and queues it, and the inference service calls the API back
with progress and the completed MP4.

```text
React client
    │ authenticated multipart upload
    ▼
Express API + MongoDB + blob storage
    │ background queue; model/video bytes sent as multipart
    ▼
FastAPI inference service
    │ progress callbacks + completed-video callback
    ▼
Express internal callback routes
    │ generated MP4 uploaded to blob storage
    ▼
MongoDB status/content endpoints
    │
    ▼
React swap screen or gallery video player
```

#### 1. Client collects the target video and options

The video tab in `client/src/features/swap/SwapContext.jsx` accepts one or more
local video files. It also accepts a video URL; the client fetches that URL and
turns the response into a `File` before submitting it.

The browser sends every selected file as `files` in a `FormData` request to
`POST /swap-video`, together with:

- `model_id`: the selected saved face model/version;
- `enable_restore`: whether optional GPEN-BFR restoration is enabled;
- `expression_strength`: stored with the job for configuration/compatibility;
- `swap_model`: `inswapper_128` or `hyperswap_256`.

The browser waits only for the API to accept the jobs. It then opens the video
gallery, where each generated-video record exposes status and progress.

#### 2. API authenticates and stages each input

`api/src/routes/swaps.js` protects the route with `requireAuth` and uses multer
memory storage. For every uploaded video, the API:

1. validates that a model ID and at least one video were provided;
2. verifies that the selected face model belongs to the authenticated user and
   is not deleted;
3. uploads the original video to the configured blob-storage provider;
4. creates one `GeneratedVideo` document;
5. enqueues that generated-video ID with `enqueueVideoSwapJob`;
6. returns HTTP `202` with the serialized records.

The input is staged before processing so the background worker does not depend
on the browser connection or on an in-memory upload buffer. The record stores
the input blob ID/provider separately from the output blob ID/provider.

At creation time the relevant record state is:

```text
status              "queued"
processing           true
drive_file_id       null
input_drive_file_id staged input's blob ID
total_frames        0
processed_frames    0
progress_percent    0
face_model_id       selected model
enable_restore      requested restoration flag
swap_model          selected model name
```

The historical `drive_file_id` field name is retained even when the selected
storage backend is Hugging Face; `storage_provider` identifies the actual
backend.

#### 3. API queue starts the background job

`api/src/services/swapService.js` maintains a FIFO `videoSwapQueue` and a
`videoSwapWorkerActive` guard. The worker:

1. removes the next video ID from the queue;
2. reloads the `GeneratedVideo` document;
3. skips it if it no longer exists or is not `queued`;
4. changes it to `status: "processing"` and records `started_at`;
5. loads the owner, face model, staged input video, and serialized face
   embedding from storage;
6. constructs the progress and content callback URLs;
7. calls the inference service;
8. verifies that the inference callback stored output content;
9. finalizes the record, or marks it failed with a truncated error.

The API processes one video job at a time in this Node process. The inference
service separately parallelizes frames within the active video job.

On API startup, `bootstrapVideoSwapQueue()` rehydrates records that were queued
or processing without output content. Processing records are reset to queued so
an API restart can resume them instead of leaving them permanently stuck.

#### 4. API calls the remote inference service

The worker downloads two binary payloads in parallel:

```text
model_file   = saved face-model .safetensors file
target_video = original staged video
```

It posts both as multipart form fields to
`POST {INFERENCE_BASE_URL}/swap-remote-video`. It also sends:

```text
model_id
enable_restore
target_expression_strength
manual_gender       model.gender, when known
swap_model
callback_url        /internal/videos/generated/:id/content
progress_url        /internal/videos/generated/:id/progress
callback_token      INFERENCE_CALLBACK_TOKEN
```

`VIDEO_SWAP_TIMEOUT_MS` controls the Axios request timeout; a value of `0`
means no timeout. Unlike the synchronous image path, the video request is not
retried by the API worker. A failed request transitions the generated video to
`failed`.

#### 5. Inference validates the model and decodes the video

The FastAPI route reads the uploaded model and video bytes. It loads the
`.safetensors` model and requires an `embedding` tensor. The optional
`source_gender` tensor is decoded as `1.0 → M` or `0.0 → F`. A valid
`manual_gender` value overrides the stored value. Gender is only used later as
a candidate-face filter; it is not the identity representation.

The video bytes are written to a temporary input file. OpenCV
`VideoCapture` opens it and reads:

- FPS, defaulting to `25.0` when the source reports no valid FPS;
- frame width and height;
- total frame count, when available.

The output writer is created at the same width, height, and FPS using the
OpenCV `mp4v` codec. The pipeline preserves the video dimensions and nominal
frame rate instead of resizing the entire video.

#### 6. Inference warms shared ONNX models

Before frames enter the worker pool, `ModelRegistry.warmup_for_frames()` loads
and configures the models that this job can touch:

- InsightFace `buffalo_l` analyzer with detection, recognition, genderage, and
  106-point landmarks;
- `inswapper_128.onnx`, for `inswapper_128`;
- `Hyperswap_1b_256.onnx`, for `hyperswap_256`;
- `GPEN-BFR-512.onnx`, when restoration is enabled;
- the optional occluder ONNX model, when occlusion masking is enabled.

Models are loaded through a thread-safe singleton and cached/downloaded from
the configured Hugging Face model repository. Detector sizing is selected from
the input dimensions and prepared before concurrent frame work begins. This
avoids workers racing to mutate detector state or loading duplicate sessions.

#### 7. Frames are decoded, swapped, and encoded in order

`inference/service/video_swap.py` keeps `cv2.VideoCapture.read()` and
`cv2.VideoWriter.write()` on the calling thread because those OpenCV objects are
not thread-safe. Only the expensive `swap_frame` operation is parallelized.

The multi-worker path:

1. reads the next frame;
2. submits it to a `ThreadPoolExecutor`;
3. stores its future in a FIFO deque;
4. keeps at most `VIDEO_WORKER_COUNT × 2` frames in flight;
5. waits for the oldest future and writes it before advancing output order;
6. reports progress based on frames actually written.

Workers can finish out of order, but the FIFO drain writes frames in source
order. The bounded deque also prevents the entire video from being decoded
into memory. If `VIDEO_WORKER_COUNT` is zero or negative, the service
auto-selects up to four workers, capped at roughly half of the available CPU
cores. A configured positive value is used directly, with a minimum of one.
Either way, the resolved count is capped at one below the total logical CPU
count, so a video job always leaves a thread free for the FastAPI process
(health checks, progress callbacks, concurrent image-swap requests). A single
worker uses a serial path without thread-pool overhead. Both paths log the
resolved `worker_count` alongside the machine's `cpu_total`.

#### 8. Each frame runs the face-swap operation

Every worker calls
`FaceSwapService.swap_frame_with_embedding(frame, ...)`. For one BGR frame,
the operations are:

1. **Detect faces.** InsightFace returns face boxes, normalized recognition
   embeddings, gender/age metadata, five-point keypoints, and dense 106-point
   landmarks.
2. **Normalize the source identity.** The saved embedding is L2-normalized and
   wrapped as the source-face representation.
3. **Filter candidates.** If source gender is known, conflicting detected
   genders are skipped. Unknown target gender is retained. If a single face
   would otherwise be rejected, the filter falls back to that face so a
   misclassification does not produce an untouched frame.
4. **Process every selected face.** Multiple qualifying faces in one frame are
   swapped, not only the largest face.
5. **Generate an aligned replacement crop.**
   - `inswapper_128`: InsightFace receives the frame, target face, and source
     identity, returning a replacement crop and affine matrix.
   - `hyperswap_256`: the target is ArcFace-aligned from its five keypoints to
     256×256, the source embedding is normalized, ONNX Runtime receives the
     target crop plus embedding, and the output is converted to BGR.
6. **Lift to working crop resolution.** The 128×128 or 256×256 model output is
   upscaled to the configured `FACE_SWAP_CROP_SIZE` when larger. The affine
   matrix is scaled with it, and the original target frame is warped into the
   same aligned crop space.
7. **Build the soft replacement mask.** Three masks are intersected:
   - a feathered crop-box mask to avoid a square seam;
   - a dense-landmark face silhouette, extended upward by the forehead ratio
     and optionally eroded, or a fallback ellipse;
   - an optional soft occlusion mask that keeps hands, hair, glasses,
     microphones, and other crossing objects in front.
8. **Optionally restore detail.** GPEN-BFR receives the crop resized to 512×512.
   Its output is resized back and blended according to `RESTORE_BLEND`.
9. **Match color.** The crop and aligned target are converted to LAB. Within
   the replacement mask, target mean and standard deviation are transferred to
   the generated crop, then mixed using `COLOR_MATCH_STRENGTH`. Hair and
   background do not influence the statistics because they are outside the
   mask.
10. **Paste back.** The affine transform is inverted, only the affected frame
    ROI is warped, and the crop is alpha-blended:

    ```text
    output = mask × swapped_crop + (1 - mask) × target_frame
    ```

    The result remains at the original frame resolution.

The current video implementation repeats this detector/swap/mask/blend path for
each frame. It does not have an explicit face-track object, optical-flow
propagation, temporal attention model, or cross-frame smoothing layer. Temporal
consistency comes mainly from the fixed source embedding, repeated geometry
processing, and ordered output.

The form fields `preserve_expression`, `preserve_target_expression`,
`target_expression_strength`, and `apply_hair` are accepted for older clients
but currently ignored by inference. No additional expression or hair
post-processing is applied.

#### 9. Inference reports progress

Inference sends an initial callback with zero processed frames, then reports as
frames are written. The interval is `max(1, floor(total_frames × 0.02))`, or
every 30 frames when the total frame count is unavailable.

Progress is calculated as:

```text
round(processed_frames / total_frames × 100)
```

The callback sends form data to
`/internal/videos/generated/:id/progress` with the
`x-inference-token` header. The API clamps values to 0–100 and stores
`total_frames`, `processed_frames`, and `progress_percent` in MongoDB.
Progress cannot run ahead of actual output because the frame driver reports
only frames already written.

#### 10. Inference finalizes and posts the MP4

After the last frame:

1. the OpenCV writer is released;
2. the raw `mp4v` output is transcoded with ffmpeg to H.264 MP4, `yuv420p`, and
   `+faststart`;
3. the final bytes are read;
4. the result is posted as multipart `file` data to
   `/internal/videos/generated/:id/content`;
5. the callback includes filename, MIME type, total frames, processed frames,
   and `progress_percent=100`;
6. inference returns `202 {"status":"posted"}`.

If ffmpeg is unavailable or transcoding fails, the service logs a warning and
falls back to copying the raw OpenCV output. Temporary input, raw-output, and
transcoded-output files are removed in the route's `finally` block.

**Current audio behavior:** the ffmpeg command explicitly uses `-an`, and the
OpenCV writer only writes video frames. The output therefore does not contain
the source audio track. Audio is not currently extracted, synchronized, or
remuxed.

#### 11. API stores the completed output

The internal content callback is protected by `requireInferenceAuth`, which
checks the shared inference callback token. It:

1. validates the generated-video ID and uploaded file;
2. reloads the video record and owner;
3. uploads the completed MP4 to blob storage;
4. sets output metadata, `drive_file_id`, `storage_provider`, and `size`;
5. sets `status: "done"`, `processing: false`, progress to 100, and
   `finished_at`;
6. removes an older output blob if present;
7. calls `deleteVideoInputIfNotSaved`.

The worker then verifies that a completed record has output content. If the
callback did not store a file, the worker marks the video failed with
`Inference finished without posting generated video content`.

If `save_input_files` is disabled, the staged input is deleted after output
generation and its input storage ID and size are cleared in MongoDB. If enabled,
the staged input remains until the generated video is deleted.

#### 12. Client status polling and playback

The client can poll `GET /videos/generated/:id/status`, which returns:

```text
processing
status
error
total_frames
processed_frames
progress_percent
has_content
```

The swap utility polls approximately every two seconds. Once
`processing=false` and `has_content=true`, it downloads
`GET /videos/generated/:id/content`.

The gallery displays:

- `queued`: the background worker is waiting;
- `processing`: a progress bar;
- `failed`: the stored error;
- `done` without a loaded source: “Ready to load”;
- a loaded result: a controlled browser `<video>` element.

The content endpoint is authenticated and supports full downloads and HTTP byte
ranges. Range support lets browsers seek/stream large MP4s without requiring a
single complete response before playback. The API sets `Content-Type`,
`Content-Disposition: inline`, `Accept-Ranges: bytes`, and private no-cache
headers.

#### 13. Failure, cleanup, and restart behavior

Failures during staging, model retrieval, inference, callback upload, or output
verification are recorded as:

```text
status      "failed"
processing  false
error       truncated detail, maximum 2000 characters
finished_at timestamp
```

The content endpoint returns HTTP `409` for unfinished jobs and `404` when no
output exists. The client treats `409` as “keep polling.” Deleting a generated
video removes its MongoDB record, output blob, and any retained input blob.

#### Video pipeline properties and current limitations

- **Async orchestration:** one API-level video job runs at a time in the Node
  process; inference parallelizes frames within that job.
- **Frame order:** worker completion can be out of order, but output order is
  always the original source order.
- **Memory bound:** only a small number of decoded frames are in flight.
- **Resolution/FPS:** dimensions and nominal FPS come from OpenCV metadata;
  invalid FPS falls back to 25 FPS.
- **Identity source:** inference receives a precomputed normalized embedding,
  not the original source photos.
- **Multi-face behavior:** every detected face passing the gender filter is
  swapped in every frame; there is no per-track target selector.
- **Temporal behavior:** there is no explicit optical-flow, temporal-attention,
  or cross-frame identity-smoothing stage.
- **Audio:** source audio is dropped by the current `-an` transcode command.
- **Security:** browser users call only the API; inference callbacks require the
  shared internal token; ownership checks prevent cross-user model/video access.

## Data storage

- **Database**: MongoDB (Atlas in production) via Mongoose. Collections:
  `users`, `face_models`, `input_images`, `generated_images`,
  `generated_videos`, `swap_jobs`, `user_settings`, `counters`.
- **Binary/blob storage**: pluggable, selected per-record via a
  `storage_provider` field (`api/src/services/storage.js`):
  - **Google Drive** — per-user OAuth2 refresh token, uploads into a shared
    `GOOGLE_DRIVE_FOLDER_ID`.
  - **Hugging Face Hub** — a dataset/space/model repo (`HF_STORAGE_REPO`)
    used as a blob bucket.
  - `DEFAULT_STORAGE_PROVIDER` picks the provider for new uploads (falls
    back to Drive if HF isn't configured); old and new records coexist.
- **ML model weights** (`inference/models/`): downloaded/cached from a
  separate Hugging Face model repo (default
  `asadujjaman-emon/face-app-models`) via `huggingface_hub`.

## External integrations

- **Google OAuth 2.0** — sign-in and Drive API access (scopes: `drive`,
  `userinfo.email`, `userinfo.profile`).
- **Hugging Face Hub** — generic blob storage, ML model weight repo, and the
  usual deployment target for `inference` (as a HF Space).
- **Civitai API** (`civitai.com/api/v1`) — proxied read-only for browsing
  community models/images, using a user-supplied Civitai API token.
- **cPanel / FTP** — production deployment target for `client` + `api`.

## Configuration

Each service loads its own env vars; there is no shared `.env`.

- **api** (`api/src/config.js`): `PORT`, `JWT_SECRET`, `JWT_ALGORITHM`,
  `ACCESS_TOKEN_EXPIRE_MINUTES`, `MONGODB_URI`, `CLIENT_ORIGIN`,
  `API_BASE_URL`, `INFERENCE_BASE_URL`, `INFERENCE_CALLBACK_TOKEN`,
  `CLIENT_AUTH_REDIRECT_URL`, `VIDEO_SWAP_TIMEOUT_MS`, `SWAP_TIMEOUT_MS`,
  `SWAP_MAX_RETRIES`, `SWAP_RETRY_DELAY_MS`, `SWAP_QUEUE_POLL_LIMIT`,
  `GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI`, `GOOGLE_DRIVE_FOLDER_ID`,
  `GOOGLE_OAUTH_REFRESH_TOKEN`, `DEFAULT_STORAGE_PROVIDER`,
  `HF_TOKEN`/`HUGGINGFACE_TOKEN`, `HF_STORAGE_REPO`, `HF_STORAGE_REPO_TYPE`,
  `HF_STORAGE_BRANCH`.
- **client** (`client/.env`, Vite-prefixed): `VITE_API_BASE_URL`,
  `VITE_API_TIMEOUT`, `VITE_MAX_RETRIES`, `VITE_RETRY_DELAY`,
  `VITE_ENABLE_LOGGING`.
- **inference** (`inference/service/settings.py`): `MODEL_REPO`,
  `LOCAL_MODEL_DIR`, `DETECTION_SIZE_MIN/MAX/RATIO/STEP`, `PORT`,
  `FACE_MASK_BLUR`, `FACE_MASK_FOREHEAD_RATIO`, `FACE_MASK_ERODE`,
  `OCCLUSION_MASK_ENABLED`, `OCCLUDER_MODEL_FILE`, `FACE_SWAP_CROP_SIZE`,
  `COLOR_MATCH_STRENGTH`, `RESTORE_BLEND`, `OUTPUT_JPEG_QUALITY`,
  `VIDEO_WORKER_COUNT`, `LOG_LEVEL`.

Separate `.env`/`.env.docker`/`.env.prod` files exist per service for
different deployment targets (bare/Replit vs. docker-compose vs. cPanel).

## Build & deploy

- Each service has its own `Dockerfile` (plus `Dockerfile.dev` for hot
  reload). `inference/Dockerfile` installs OpenCV/ffmpeg/InsightFace system
  deps and pre-warms the model cache at build time.
- `docker-compose.yml` + `docker-compose.override.yml` run all three
  services locally: `inference` (7860) ← `api` (8080) ← `client` (3000/80).
- **CI/CD** (`.github/workflows/`):
  - `deploy.yml` — builds the client and FTP-deploys `client/dist/` + the
    `api/` source to a cPanel host on every push to `main`
    (`.cpanel.yml` holds the cPanel-side deploy task config).
  - `sync-space.yml` — mirrors `inference/` into a Hugging Face Space repo
    on every push to `main`, so the microservice runs as an HF Space.
- No Kubernetes/Terraform/other IaC.

## Testing

There is no automated unit/integration test suite. The only
quality-verification tool is `inference/eval/run_eval.py`, a manual offline
harness that scores identity retention, sharpness, and tone match against a
fixture set (`inference/eval/fixtures/`, images not committed for privacy)
— run manually before/after pipeline changes, not wired into CI.

## Known inconsistencies

- `replit.md` documents an earlier, Google-Drive-only storage design; this
  document supersedes it. The dual storage providers, Civitai integration,
  and occlusion-mask pipeline all postdate `replit.md`.
