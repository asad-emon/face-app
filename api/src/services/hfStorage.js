import axios from "axios";
import { randomUUID } from "crypto";
import { deleteFile as hubDeleteFile, uploadFile as hubUploadFile } from "@huggingface/hub";
import {
  HF_TOKEN,
  HF_STORAGE_REPO,
  HF_STORAGE_REPO_TYPE,
  HF_STORAGE_BRANCH,
} from "../config.js";

export function isConfigured() {
  return Boolean(HF_TOKEN && HF_STORAGE_REPO);
}

function getConfig() {
  if (!HF_TOKEN) {
    throw new Error(
      "Hugging Face storage not configured: HF_TOKEN (or HUGGINGFACE_TOKEN) is required"
    );
  }
  if (!HF_STORAGE_REPO) {
    throw new Error("Hugging Face storage not configured: HF_STORAGE_REPO is required");
  }
  return {
    accessToken: HF_TOKEN,
    repo: { type: HF_STORAGE_REPO_TYPE, name: HF_STORAGE_REPO },
    branch: HF_STORAGE_BRANCH,
  };
}

function resolveUrl(key) {
  const { repo, branch } = getConfig();
  const prefix =
    repo.type === "dataset"
      ? "datasets/"
      : repo.type === "space"
      ? "spaces/"
      : "";
  const encodedPath = String(key)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://huggingface.co/${prefix}${repo.name}/resolve/${encodeURIComponent(
    branch
  )}/${encodedPath}`;
}

function sanitizeName(name) {
  return String(name || "")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 200);
}

function statusOf(err) {
  return err?.statusCode || err?.status || err?.response?.status || null;
}

async function withRetry(fn, attempts = 3) {
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = statusOf(err);
      // Concurrent commits to the same branch can fail with a conflict; retry.
      if (status !== 409 && status !== 412 && status !== 429) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw lastErr;
}

export async function uploadBuffer({ buffer, filename, mimeType }) {
  const { accessToken, repo, branch } = getConfig();
  const buf = Buffer.from(buffer);
  const safeName = sanitizeName(filename) || `upload-${Date.now()}`;
  const safeMime = mimeType || "application/octet-stream";
  const key = `uploads/${randomUUID()}-${safeName}`;

  await withRetry(() =>
    hubUploadFile({
      repo,
      accessToken,
      branch,
      file: {
        path: key,
        content: new Blob([buf], { type: safeMime }),
      },
      commitTitle: `Upload ${safeName}`,
    })
  );

  return {
    drive_file_id: key,
    filename: safeName,
    mime_type: safeMime,
    size: buf.length,
  };
}

export async function downloadBuffer(key) {
  if (!key) {
    throw new Error("storage key is required");
  }
  const { accessToken } = getConfig();
  const response = await axios.get(resolveUrl(key), {
    responseType: "arraybuffer",
    headers: { Authorization: `Bearer ${accessToken}` },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  return Buffer.from(response.data);
}

export async function downloadRange(key, start, end) {
  if (!key) {
    throw new Error("storage key is required");
  }
  const { accessToken } = getConfig();
  const headers = { Authorization: `Bearer ${accessToken}` };
  if (Number.isInteger(start) || Number.isInteger(end)) {
    const startStr = Number.isInteger(start) ? String(start) : "0";
    const endStr = Number.isInteger(end) ? String(end) : "";
    headers.Range = `bytes=${startStr}-${endStr}`;
  }
  const response = await axios.get(resolveUrl(key), {
    responseType: "arraybuffer",
    headers,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  return Buffer.from(response.data);
}

export async function getFileMetadata(key) {
  if (!key) {
    throw new Error("storage key is required");
  }
  const { accessToken } = getConfig();
  const response = await axios.head(resolveUrl(key), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return {
    drive_file_id: key,
    filename: key.split("/").pop() || "",
    mime_type: response.headers["content-type"] || "application/octet-stream",
    size: Number(response.headers["content-length"]) || 0,
  };
}

export async function deleteFile(key) {
  if (!key) {
    return;
  }
  const { accessToken, repo, branch } = getConfig();
  try {
    await withRetry(() =>
      hubDeleteFile({
        repo,
        accessToken,
        branch,
        path: key,
      })
    );
  } catch (err) {
    if (statusOf(err) === 404) {
      return;
    }
    throw err;
  }
}
