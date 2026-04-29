import axios from "axios";
import FormData from "form-data";
import { FaceModel, GeneratedImage, InputImage, SwapJob, GeneratedVideo } from "../db.js";
import {
  INFERENCE_BASE_URL,
  SWAP_MAX_RETRIES,
  SWAP_RETRY_DELAY_MS,
  SWAP_TIMEOUT_MS,
} from "../config.js";
import { getErrorDetail } from "../utils/parsing.js";
import { logApiError } from "../utils/logging.js";
import {
  uploadBuffer,
  downloadBuffer,
  deleteFile,
} from "./driveStorage.js";

const swapQueue = [];
let swapWorkerActive = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetrySwapRequest(err) {
  const code = String(err?.code || "").toUpperCase();
  const message = String(err?.message || "").toLowerCase();

  if (code === "ECONNRESET" || code === "ECONNABORTED" || code === "ETIMEDOUT" || code === "EPIPE") {
    return true;
  }
  if (message.includes("socket hang up") || message.includes("network error") || message.includes("timeout")) {
    return true;
  }
  return false;
}

async function runSwapRemote(modelBytes, imageBytes, imageFilename, modelId, enableRestore) {
  let response;
  for (let attempt = 0; attempt <= SWAP_MAX_RETRIES; attempt += 1) {
    const form = new FormData();
    form.append("model_id", String(modelId));
    form.append("enable_restore", enableRestore ? "1" : "0");
    form.append("model_file", modelBytes, {
      filename: "model.safetensors",
      contentType: "application/octet-stream",
    });
    form.append("target_image", imageBytes, {
      filename: imageFilename || "target.png",
      contentType: "image/png",
    });

    try {
      response = await axios.post(`${INFERENCE_BASE_URL}/swap-remote`, form, {
        headers: form.getHeaders(),
        responseType: "arraybuffer",
        timeout: SWAP_TIMEOUT_MS,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      break;
    } catch (err) {
      const canRetry = attempt < SWAP_MAX_RETRIES && shouldRetrySwapRequest(err);
      if (!canRetry) {
        throw err;
      }
      console.warn(
        `[WARN] POST /swap upstream request failed (attempt ${attempt + 1}/${SWAP_MAX_RETRIES + 1}): ${
          err?.message || err
        }`
      );
      if (SWAP_RETRY_DELAY_MS > 0) {
        await sleep(SWAP_RETRY_DELAY_MS);
      }
    }
  }
  return Buffer.from(response.data);
}

export async function runSwapAndStore(ownerId, modelId, imageId, enableRestore) {
  const model = await FaceModel.findOne({
    id: modelId,
    owner_id: ownerId,
    is_deleted: false,
  }).lean();
  const image = await InputImage.findOne({
    id: imageId,
    owner_id: ownerId,
  }).lean();
  if (!model || !image) {
    throw new Error("Model or image not found");
  }

  const [modelBytes, imageBytes] = await Promise.all([
    downloadBuffer(model.drive_file_id),
    downloadBuffer(image.drive_file_id),
  ]);

  const outputBytes = await runSwapRemote(
    modelBytes,
    imageBytes,
    image.filename,
    modelId,
    enableRestore
  );

  let driveResult;
  try {
    driveResult = await uploadBuffer({
      buffer: outputBytes,
      filename: `swap-${ownerId}-${modelId}-${imageId}-${Date.now()}.jpg`,
      mimeType: "image/jpeg",
    });
  } catch (err) {
    throw new Error(`Drive upload failed: ${err.message}`);
  }

  let generated;
  try {
    generated = await GeneratedImage.create({
      drive_file_id: driveResult.drive_file_id,
      mime_type: driveResult.mime_type,
      size: driveResult.size,
      owner_id: ownerId,
      input_image_id: imageId,
      face_model_id: modelId,
    });
  } catch (err) {
    await deleteFile(driveResult.drive_file_id).catch(() => {});
    throw err;
  }

  return { outputBytes, generatedImageId: generated.id };
}

export async function triggerVideoSwap({
  generatedVideoId,
  modelDriveId,
  video,
  modelId,
  enableRestore,
  callbackUrl,
  progressUrl,
  callbackToken,
}) {
  let modelBytes;
  try {
    modelBytes = await downloadBuffer(modelDriveId);
  } catch (err) {
    await GeneratedVideo.updateOne(
      { id: generatedVideoId },
      { $set: { processing: false } }
    );
    logApiError("triggerVideoSwap: download model from Drive", err);
    return;
  }

  const form = new FormData();
  form.append("model_id", String(modelId));
  form.append("enable_restore", enableRestore ? "1" : "0");
  if (callbackUrl) {
    form.append("callback_url", callbackUrl);
  }
  if (progressUrl) {
    form.append("progress_url", progressUrl);
  }
  if (callbackToken) {
    form.append("callback_token", callbackToken);
  }
  form.append("model_file", modelBytes, {
    filename: "model.safetensors",
    contentType: "application/octet-stream",
  });
  form.append("target_video", video.buffer, {
    filename: video.originalname || "target.mp4",
    contentType: video.mimetype || "video/mp4",
  });

  try {
    const response = await axios.post(`${INFERENCE_BASE_URL}/swap-remote-video`, form, {
      headers: form.getHeaders(),
      responseType: "stream",
      timeout: 1800000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    if (response?.data?.resume) {
      response.data.resume();
    }
  } catch (err) {
    await GeneratedVideo.updateOne(
      { id: generatedVideoId },
      { $set: { processing: false } }
    );
    logApiError("triggerVideoSwap", err);
  }
}

export function enqueueSwapJob(jobId) {
  if (!swapQueue.includes(jobId)) {
    swapQueue.push(jobId);
  }
  void processSwapQueue();
}

async function processSwapQueue() {
  if (swapWorkerActive) {
    return;
  }
  swapWorkerActive = true;

  try {
    while (swapQueue.length > 0) {
      const jobId = swapQueue.shift();
      const job = await SwapJob.findOne({ id: jobId });
      if (!job || job.status !== "queued") {
        continue;
      }

      job.status = "processing";
      job.error = null;
      job.started_at = new Date();
      job.finished_at = null;
      await job.save();

      try {
        const { generatedImageId } = await runSwapAndStore(
          job.owner_id,
          job.face_model_id,
          job.input_image_id,
          Boolean(job.enable_restore)
        );
        job.status = "done";
        job.generated_image_id = generatedImageId;
        job.error = null;
        job.finished_at = new Date();
        await job.save();
      } catch (err) {
        const detail = getErrorDetail(err).slice(0, 2000);
        job.status = "failed";
        job.error = detail;
        job.finished_at = new Date();
        await job.save();
        logApiError(`processSwapQueue job ${job.id}`, err);
      }
    }
  } finally {
    swapWorkerActive = false;
    if (swapQueue.length > 0) {
      void processSwapQueue();
    }
  }
}

export async function bootstrapSwapQueue() {
  const queuedJobs = await SwapJob.find({ status: "queued" })
    .select({ id: 1 })
    .sort({ id: 1 })
    .lean();
  queuedJobs.forEach((job) => enqueueSwapJob(job.id));
}
