# Face App

A multi-component face-swapping web application using AI.

## Architecture

- **client/** — React + Vite frontend (Chakra UI), port 5000
- **api/** — Node.js + Express backend API, port 8080
- **inference/** — Python + FastAPI AI inference service (face-swap models), port 7860

## Tech Stack

- **Frontend**: React 18, Vite, Chakra UI, Firebase (auth/storage)
- **Backend**: Node.js, Express, Mongoose ODM, MongoDB Atlas
- **Inference**: Python, FastAPI, InsightFace, ONNX Runtime, OpenCV

## Workflows

- **Start application** — Starts the Vite dev server on port 5000 (webview)
- **API Server** — Starts the Express API on port 8080 (console)

The inference service (Python/FastAPI) requires GPU/heavy dependencies and is intended to run separately (originally via Docker). In dev mode, it should be started manually if needed.

## Environment Variables

- `MONGODB_URI` — MongoDB Atlas connection string (secret)
- `CLIENT_ORIGIN` — Frontend URL for CORS
- `JWT_SECRET` — Secret for JSON web tokens
- `PORT` — API port (8080)
- `API_BASE_URL` — Base URL of the API
- `INFERENCE_BASE_URL` — URL of the inference service
- `INFERENCE_CALLBACK_TOKEN` — Token for inference callbacks

## Database

Uses MongoDB Atlas via Mongoose ODM. A `counters` collection provides
auto-incrementing integer `id` fields so the public API contract (numeric
IDs) stays stable for the frontend.

Collections: `users`, `face_models`, `input_images`, `generated_images`, `generated_videos`, `swap_jobs`, `counters`

The Atlas cluster's Network Access list must allow connections from Replit
(easiest: allow `0.0.0.0/0`, since Replit egress IPs are not stable).

## Frontend Configuration

Vite is configured to:
- Run on `0.0.0.0:5000`
- Allow all hosts (for Replit proxy)
- Proxy `/api` requests to `http://localhost:8080`
