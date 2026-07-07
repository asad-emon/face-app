import dotenv from "dotenv";

dotenv.config();

export const PORT = Number(process.env.PORT || 8080);
export const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
export const JWT_ALGORITHM = process.env.JWT_ALGORITHM || "HS256";
export const ACCESS_TOKEN_EXPIRE_MINUTES = Number(
  process.env.ACCESS_TOKEN_EXPIRE_MINUTES || 300
);
export const INFERENCE_BASE_URL = process.env.INFERENCE_BASE_URL || "";
export const API_BASE_URL = process.env.API_BASE_URL || "";
export const INFERENCE_CALLBACK_TOKEN = process.env.INFERENCE_CALLBACK_TOKEN || "";
export const VIDEO_SWAP_TIMEOUT_MS = Math.max(0, Number(process.env.VIDEO_SWAP_TIMEOUT_MS || 0));
export const GOOGLE_OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || "";
export const GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
export const GOOGLE_OAUTH_REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI || "";
export const CLIENT_AUTH_REDIRECT_URL =
  process.env.CLIENT_AUTH_REDIRECT_URL || process.env.CLIENT_ORIGIN || "http://localhost:5000";
export const SWAP_TIMEOUT_MS = Number(process.env.SWAP_TIMEOUT_MS || 600000);
export const SWAP_MAX_RETRIES = Math.max(0, Number(process.env.SWAP_MAX_RETRIES || 2));
export const SWAP_RETRY_DELAY_MS = Math.max(0, Number(process.env.SWAP_RETRY_DELAY_MS || 750));
export const SWAP_QUEUE_POLL_LIMIT = Math.max(1, Number(process.env.SWAP_QUEUE_POLL_LIMIT || 200));
export const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN;

// Storage providers for generated/input content. Supported: "huggingface", "gdrive".
export const STORAGE_GDRIVE = "gdrive";
export const STORAGE_HUGGINGFACE = "huggingface";

// Provider used for newly uploaded content. Defaults to Hugging Face, falling
// back to Google Drive at runtime when HF credentials are not configured.
export const DEFAULT_STORAGE_PROVIDER = (
  process.env.DEFAULT_STORAGE_PROVIDER || STORAGE_HUGGINGFACE
).toLowerCase();

// Hugging Face Hub storage (dataset/model/space repo used as a bucket).
export const HF_TOKEN = process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || "";
export const HF_STORAGE_REPO = process.env.HF_STORAGE_REPO || "";
export const HF_STORAGE_REPO_TYPE = (process.env.HF_STORAGE_REPO_TYPE || "dataset").toLowerCase();
export const HF_STORAGE_BRANCH = process.env.HF_STORAGE_BRANCH || "main";
