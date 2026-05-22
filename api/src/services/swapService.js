import axios from "axios";
import FormData from "form-data";
import { FaceModel, GeneratedImage, InputImage, SwapJob, GeneratedVideo, User } from "../db.js";
import {
  INFERENCE_BASE_URL,
  INFERENCE_CALLBACK_TOKEN,
  API_BASE_URL,
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
const videoSwapQueue = [];
let videoSwapWorkerActive = false;

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

async function runSwapRemote(modelBytes, imageBytes, imageFilename, modelId, enableRestore, expressionStrength, manualGender) {
  let response;
  for (let attempt = 0; attempt <= SWAP_MAX_RETRIES; attempt += 1) {
    const form = new FormData();
    form.append("model_id", String(modelId));
    form.append("enable_restore", enableRestore ? "1" : "0");
    form.append("target_expression_strength", String(typeof expressionStrength === 'number' ? expressionStrength : 0.85));
    if (manualGender === "M" || manualGender === "F") {
      form.append("manual_gender", manualGender);
    }
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
        `[WARN] POST /swap upstream request failed (attempt ${attempt + 1}/${SWAP_MAX_RETRIES + 1}): ${err?.message || err
        }`
      );
      if (SWAP_RETRY_DELAY_MS > 0) {
        await sleep(SWAP_RETRY_DELAY_MS);
      }
    }
  }
  return Buffer.from(response.data);
}

export async function runSwapAndStore(ownerId, modelId, imageId, enableRestore, expressionStrength) {
  const owner = await User.findOne({ id: ownerId });
  if (!owner) {
    throw new Error("Owner not found");
  }
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
    downloadBuffer(model.drive_file_id, owner),
    downloadBuffer(image.drive_file_id, owner),
  ]);

  const outputBytes = await runSwapRemote(
    modelBytes,
    imageBytes,
    image.filename,
    modelId,
    enableRestore,
    expressionStrength,
    model.gender || null
  );

  let driveResult;
  try {
    driveResult = await uploadBuffer({
      buffer: outputBytes,
      filename: `swap-${ownerId}-${modelId}-${imageId}-${Date.now()}.jpg`,
      mimeType: "image/jpeg",
      authUser: owner,
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
    await deleteFile(driveResult.drive_file_id, owner).catch(() => { });
    throw err;
  }

  return { outputBytes, generatedImageId: generated.id };
}

export async function triggerVideoSwap({
  generatedVideoId,
  modelBytes,
  videoBytes,
  videoFilename,
  videoMimeType,
  modelId,
  enableRestore,
  expressionStrength,
  manualGender,
  callbackUrl,
  progressUrl,
  callbackToken,
}) {
  const form = new FormData();
  form.append("model_id", String(modelId));
  form.append("enable_restore", enableRestore ? "1" : "0");
  form.append("target_expression_strength", String(typeof expressionStrength === 'number' ? expressionStrength : 0.85));
  if (manualGender === "M" || manualGender === "F") {
    form.append("manual_gender", manualGender);
  }
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
  form.append("target_video", videoBytes, {
    filename: videoFilename || "target.mp4",
    contentType: videoMimeType || "video/mp4",
  });

  const response = await axios.post(`${INFERENCE_BASE_URL}/swap-remote-video`, form, {
    headers: form.getHeaders(),
    timeout: 1800000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  return response.data;
}

export function enqueueSwapJob(jobId, expressionStrength = 0.85) {
  if (!swapQueue.some((item) => item.jobId === jobId)) {
    swapQueue.push({ jobId, expressionStrength });
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
      const { jobId, expressionStrength: strength } = swapQueue.shift();
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
          Boolean(job.enable_restore),
          strength
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

export function enqueueVideoSwapJob(videoId) {
  if (!videoSwapQueue.some((item) => item.videoId === videoId)) {
    videoSwapQueue.push({ videoId });
  }
  void processVideoSwapQueue();
}

async function markVideoFailed(video, err) {
  const detail = getErrorDetail(err).slice(0, 2000);
  video.status = "failed";
  video.processing = false;
  video.error = detail;
  video.finished_at = new Date();
  await video.save();
  logApiError(`processVideoSwapQueue video ${video.id}`, err);
}

async function processVideoSwapQueue() {
  if (videoSwapWorkerActive) {
    return;
  }
  videoSwapWorkerActive = true;

  try {
    while (videoSwapQueue.length > 0) {
      const { videoId } = videoSwapQueue.shift();
      const video = await GeneratedVideo.findOne({ id: videoId });
      if (!video || video.status !== "queued") {
        continue;
      }

      video.status = "processing";
      video.processing = true;
      video.error = null;
      video.started_at = new Date();
      video.finished_at = null;
      await video.save();

      try {
        const owner = await User.findOne({ id: video.owner_id });
        if (!owner) {
          throw new Error("Video owner not found");
        }
        const model = await FaceModel.findOne({
          id: video.face_model_id,
          owner_id: video.owner_id,
          is_deleted: false,
        }).lean();
        if (!model) {
          throw new Error("Model not found");
        }
        if (!video.input_drive_file_id) {
          throw new Error("Queued video input is missing");
        }

        const [modelBytes, videoBytes] = await Promise.all([
          downloadBuffer(model.drive_file_id, owner),
          downloadBuffer(video.input_drive_file_id, owner),
        ]);

        const callbackBase = API_BASE_URL || "";
        if (!callbackBase) {
          throw new Error("API_BASE_URL is required for background video callbacks");
        }
        const callbackUrl = `${callbackBase}/internal/videos/generated/${video.id}/content`;
        const progressUrl = `${callbackBase}/internal/videos/generated/${video.id}/progress`;

        await triggerVideoSwap({
          generatedVideoId: video.id,
          modelBytes,
          videoBytes,
          videoFilename: video.filename,
          videoMimeType: video.input_mime_type || video.mime_type,
          modelId: video.face_model_id,
          enableRestore: Boolean(video.enable_restore),
          expressionStrength: video.expression_strength,
          manualGender: model.gender || null,
          callbackUrl,
          progressUrl,
          callbackToken: INFERENCE_CALLBACK_TOKEN,
        });

        const completed = await GeneratedVideo.findOne({ id: video.id });
        if (completed && completed.status === "processing" && completed.drive_file_id) {
          completed.status = "done";
          completed.processing = false;
          completed.progress_percent = 100;
          completed.error = null;
          completed.finished_at = completed.finished_at || new Date();
          await completed.save();
        } else if (completed && !completed.drive_file_id && completed.status === "processing") {
          throw new Error("Inference finished without posting generated video content");
        }
      } catch (err) {
        await markVideoFailed(video, err);
      }
    }
  } finally {
    videoSwapWorkerActive = false;
    if (videoSwapQueue.length > 0) {
      void processVideoSwapQueue();
    }
  }
}

export async function bootstrapVideoSwapQueue() {
  const queuedVideos = await GeneratedVideo.find({
    $or: [
      { status: { $in: ["queued", "processing"] } },
      { status: { $exists: false }, processing: true },
    ],
    drive_file_id: null,
  })
    .select({ id: 1, status: 1 })
    .sort({ id: 1 })
    .lean();

  await GeneratedVideo.updateMany(
    {
      $or: [
        { status: "processing" },
        { status: { $exists: false }, processing: true },
      ],
      drive_file_id: null,
    },
    { $set: { status: "queued", processing: true, started_at: null, error: null } }
  );

  queuedVideos.forEach((video) => enqueueVideoSwapJob(video.id));
}
