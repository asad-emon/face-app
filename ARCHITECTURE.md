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

`POST /swap-video` creates a `GeneratedVideo` doc and enqueues a job.
`swapService` downloads the model + video and calls inference
`POST /swap-remote-video` with `callback_url`/`progress_url` pointing back
at `api`'s `internal/videos/...` routes (secured by `INFERENCE_CALLBACK_TOKEN`
via `requireInferenceAuth`). Inference reports per-frame progress and POSTs
the finished MP4 back; api stores it and marks the job done.

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
