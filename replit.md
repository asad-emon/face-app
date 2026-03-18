# Face App

A multi-component face-swapping web application using AI.

## Architecture

- **client/** — React + Vite frontend (Chakra UI), port 5000
- **api/** — Node.js + Express backend API, port 8080
- **inference/** — Python + FastAPI AI inference service (face-swap models), port 7860

## Tech Stack

- **Frontend**: React 18, Vite, Chakra UI, Firebase (auth/storage)
- **Backend**: Node.js, Express, Sequelize ORM, PostgreSQL
- **Inference**: Python, FastAPI, InsightFace, ONNX Runtime, OpenCV

## Workflows

- **Start application** — Starts the Vite dev server on port 5000 (webview)
- **API Server** — Starts the Express API on port 8080 (console)

The inference service (Python/FastAPI) requires GPU/heavy dependencies and is intended to run separately (originally via Docker). In dev mode, it should be started manually if needed.

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string (set by Replit database)
- `CLIENT_ORIGIN` — Frontend URL for CORS
- `JWT_SECRET` — Secret for JSON web tokens
- `PORT` — API port (8080)
- `API_BASE_URL` — Base URL of the API
- `INFERENCE_BASE_URL` — URL of the inference service
- `INFERENCE_CALLBACK_TOKEN` — Token for inference callbacks

## Database

Uses Replit's built-in PostgreSQL. The API uses Sequelize ORM and auto-syncs tables on startup.

Tables: `users`, `face_models`, `input_images`, `generated_images`, `generated_videos`, `swap_jobs`

## Frontend Configuration

Vite is configured to:
- Run on `0.0.0.0:5000`
- Allow all hosts (for Replit proxy)
- Proxy `/api` requests to `http://localhost:8080`
