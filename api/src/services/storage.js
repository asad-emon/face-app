import {
  DEFAULT_STORAGE_PROVIDER,
  STORAGE_GDRIVE,
  STORAGE_HUGGINGFACE,
} from "../config.js";
import * as driveBackend from "./driveStorage.js";
import * as hfBackend from "./hfStorage.js";

export { STORAGE_GDRIVE, STORAGE_HUGGINGFACE };

const backends = {
  [STORAGE_GDRIVE]: driveBackend,
  [STORAGE_HUGGINGFACE]: hfBackend,
};

// Records created before storage_provider existed live on Google Drive, so a
// missing/unknown provider always resolves to Drive for reads and deletes.
function getBackend(provider) {
  return backends[provider] || backends[STORAGE_GDRIVE];
}

let warnedHfFallback = false;

// Provider used for new uploads. Honors DEFAULT_STORAGE_PROVIDER but degrades
// to Google Drive when Hugging Face is selected without credentials, so that
// Drive-only deployments keep working.
export function resolveDefaultProvider() {
  const desired = backends[DEFAULT_STORAGE_PROVIDER]
    ? DEFAULT_STORAGE_PROVIDER
    : STORAGE_GDRIVE;
  if (desired === STORAGE_HUGGINGFACE && !hfBackend.isConfigured()) {
    if (!warnedHfFallback) {
      console.warn(
        "[WARN] DEFAULT_STORAGE_PROVIDER=huggingface but HF_TOKEN/HF_STORAGE_REPO are not configured; falling back to Google Drive"
      );
      warnedHfFallback = true;
    }
    return STORAGE_GDRIVE;
  }
  return desired;
}

export async function uploadBuffer({ provider, ...opts }) {
  const target = provider || resolveDefaultProvider();
  const result = await getBackend(target).uploadBuffer(opts);
  return { ...result, storage_provider: target };
}

export async function downloadBuffer(fileId, authUser, provider) {
  return getBackend(provider).downloadBuffer(fileId, authUser);
}

export async function downloadRange(fileId, start, end, authUser, provider) {
  return getBackend(provider).downloadRange(fileId, start, end, authUser);
}

export async function getFileMetadata(fileId, authUser, provider) {
  return getBackend(provider).getFileMetadata(fileId, authUser);
}

export async function deleteFile(fileId, authUser, provider) {
  if (!fileId) {
    return;
  }
  return getBackend(provider).deleteFile(fileId, authUser);
}

// files: array of { id, provider }. Falsy ids are skipped; failures are logged
// and never reject so callers can fire-and-forget cleanup.
export async function deleteManyFiles(files, authUser) {
  const targets = (files || []).filter((file) => file && file.id);
  if (targets.length === 0) {
    return;
  }
  await Promise.all(
    targets.map((file) =>
      deleteFile(file.id, authUser, file.provider).catch((err) =>
        console.warn(
          `[WARN] Failed to delete ${file.provider || STORAGE_GDRIVE} file ${file.id}: ${
            err?.message || err
          }`
        )
      )
    )
  );
}
