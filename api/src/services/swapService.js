import axios from "axios";
import FormData from "form-data";
import { FaceModel, GeneratedImage, InputImage, SwapJob, GeneratedVideo, User } from "../db.js";
import {
  INFERENCE_BASE_URL,
  INFERENCE_CALLBACK_TOKEN,
  API_BASE_URL,
  HF_SOURCE_SPACE_ID,
  HF_SPACE_DELETE_AFTER_JOB,
  HF_SPACE_DUPLICATE_OWNER,
  HF_SPACE_HARDWARE,
  HF_SPACE_NAME_PREFIX,
  HF_SPACE_READY_POLL_MS,
  HF_SPACE_READY_TIMEOUT_MS,
  HF_SPACE_SECRETS_JSON,
  HF_SPACE_SLEEP_TIME,
  HF_SPACE_STORAGE,
  HF_SPACE_VARIABLES_JSON,
  HF_SPACE_VISIBILITY,
  HF_TOKEN,
  HF_VIDEO_SPACE_MAX_PARALLEL,
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
const activeVideoSwapJobs = new Set();

const HF_HUB_URL = "https://huggingface.co";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hfVideoSpacesEnabled() {
  return Boolean(HF_TOKEN && HF_SOURCE_SPACE_ID);
}

function hfHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${HF_TOKEN}`,
    ...extra,
  };
}

function parseJsonArray(rawValue, label) {
  if (!rawValue) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON array`);
    }
    return parsed;
  } catch (err) {
    throw new Error(`Invalid ${label}: ${err.message}`);
  }
}

function safeSpaceName(value) {
  const safe = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return safe || `video-${Date.now().toString(36)}`;
}

function deriveSpaceAppUrl(repoId) {
  const [owner, name] = String(repoId).split("/");
  const subdomain = `${owner || ""}-${name || ""}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `https://${subdomain}.hf.space`;
}

async function getHfUsername() {
  const response = await axios.get(`${HF_HUB_URL}/api/whoami-v2`, {
    headers: hfHeaders(),
    timeout: 30000,
  });
  const name = response.data?.name;
  if (!name) {
    throw new Error("Unable to resolve Hugging Face token owner");
  }
  return name;
}

async function getSpaceInfo(repoId) {
  const response = await axios.get(`${HF_HUB_URL}/api/spaces/${repoId}`, {
    headers: hfHeaders(),
    timeout: 30000,
  });
  return response.data || {};
}

async function duplicateVideoSpace(videoId) {
  const owner = HF_SPACE_DUPLICATE_OWNER || (await getHfUsername());
  const targetName = safeSpaceName(`${HF_SPACE_NAME_PREFIX}-${videoId}-${Date.now().toString(36)}`);
  const targetRepoId = `${owner}/${targetName}`;
  const payload = {
    repository: targetRepoId,
  };

  if (HF_SPACE_VISIBILITY) {
    payload.visibility = HF_SPACE_VISIBILITY;
  }
  if (HF_SPACE_HARDWARE) {
    payload.hardware = HF_SPACE_HARDWARE;
  }
  if (HF_SPACE_STORAGE) {
    payload.storageTier = HF_SPACE_STORAGE;
  }
  if (Number.isFinite(HF_SPACE_SLEEP_TIME) && HF_SPACE_HARDWARE !== "cpu-basic") {
    payload.sleepTimeSeconds = HF_SPACE_SLEEP_TIME;
  }
  const secrets = parseJsonArray(HF_SPACE_SECRETS_JSON, "HF_SPACE_SECRETS_JSON");
  const variables = parseJsonArray(HF_SPACE_VARIABLES_JSON, "HF_SPACE_VARIABLES_JSON");
  if (secrets) {
    payload.secrets = secrets;
  }
  if (variables) {
    payload.variables = variables;
  }

  const response = await axios.post(
    `${HF_HUB_URL}/api/spaces/${HF_SOURCE_SPACE_ID}/duplicate`,
    payload,
    {
      headers: hfHeaders(),
      timeout: 120000,
    }
  );

  return {
    repoId: targetRepoId,
    repoUrl: response.data?.url || `${HF_HUB_URL}/spaces/${targetRepoId}`,
  };
}

async function waitForSpaceReady(repoId) {
  const deadline = Date.now() + HF_SPACE_READY_TIMEOUT_MS;
  let appUrl = deriveSpaceAppUrl(repoId);
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const info = await getSpaceInfo(repoId);
      if (info?.subdomain) {
        appUrl = `https://${info.subdomain}.hf.space`;
      }
      await axios.get(`${appUrl}/docs`, {
        headers: hfHeaders(),
        timeout: 15000,
        validateStatus: (status) => status >= 200 && status < 500,
      }).then((response) => {
        if (response.status >= 200 && response.status < 400) {
          return response;
        }
        throw new Error(`Space app returned ${response.status}`);
      });
      return appUrl;
    } catch (err) {
      lastError = err;
      await sleep(HF_SPACE_READY_POLL_MS);
    }
  }

  throw new Error(`Timed out waiting for duplicated Space ${repoId}: ${getErrorDetail(lastError)}`);
}

async function deleteHfSpace(repoId) {
  if (!repoId || !HF_SPACE_DELETE_AFTER_JOB) {
    return;
  }
  const [organization, name] = String(repoId).split("/");
  if (!organization || !name) {
    return;
  }
  await axios.delete(`${HF_HUB_URL}/api/repos/delete`, {
    headers: hfHeaders(),
    data: {
      type: "space",
      name,
      organization,
    },
    timeout: 30000,
  });
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

async function runSwapRemote(modelBytes, imageBytes, imageFilename, modelId, enableRestore, expressionStrength, manualGender, swapModel = "inswapper_128") {
  let response;
  for (let attempt = 0; attempt <= SWAP_MAX_RETRIES; attempt += 1) {
    const form = new FormData();
    form.append("model_id", String(modelId));
    form.append("enable_restore", enableRestore ? "1" : "0");
    form.append("target_expression_strength", String(typeof expressionStrength === 'number' ? expressionStrength : 0.85));
    if (manualGender === "M" || manualGender === "F") {
      form.append("manual_gender", manualGender);
    }
    if (swapModel && swapModel !== "inswapper_128") {
      form.append("swap_model", swapModel);
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

export async function runSwapAndStore(ownerId, modelId, imageId, enableRestore, expressionStrength, swapModel = "inswapper_128") {
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
    model.gender || null,
    swapModel
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
  inferenceBaseUrl,
  authorizationToken,
  modelBytes,
  videoBytes,
  videoFilename,
  videoMimeType,
  modelId,
  enableRestore,
  expressionStrength,
  manualGender,
  swapModel,
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
  if (swapModel && swapModel !== "inswapper_128") {
    form.append("swap_model", swapModel);
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

  const requestHeaders = form.getHeaders();
  if (authorizationToken) {
    requestHeaders.Authorization = `Bearer ${authorizationToken}`;
  }

  const response = await axios.post(`${inferenceBaseUrl || INFERENCE_BASE_URL}/swap-remote-video`, form, {
    headers: requestHeaders,
    responseType: callbackUrl ? "json" : "arraybuffer",
    timeout: 1800000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  return callbackUrl ? response.data : Buffer.from(response.data);
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
          strength,
          job.swap_model || "inswapper_128"
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
  drainVideoSwapQueue();
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

function canStartMoreVideoJobs() {
  return HF_VIDEO_SPACE_MAX_PARALLEL === 0 || activeVideoSwapJobs.size < HF_VIDEO_SPACE_MAX_PARALLEL;
}

function drainVideoSwapQueue() {
  while (videoSwapQueue.length > 0 && canStartMoreVideoJobs()) {
    const { videoId } = videoSwapQueue.shift();
    if (activeVideoSwapJobs.has(videoId)) {
      continue;
    }
    activeVideoSwapJobs.add(videoId);
    void processVideoSwapJob(videoId).finally(() => {
      activeVideoSwapJobs.delete(videoId);
      drainVideoSwapQueue();
    });
  }
}

async function processVideoSwapJob(videoId) {
  const video = await GeneratedVideo.findOne({ id: videoId });
  if (!video || video.status !== "queued") {
    return;
  }

  video.status = "processing";
  video.processing = true;
  video.error = null;
  video.started_at = new Date();
  video.finished_at = null;
  await video.save();

  let duplicatedSpaceId = null;

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

    let inferenceBaseUrl = INFERENCE_BASE_URL;
    let authorizationToken = null;
    const useHfSpace = hfVideoSpacesEnabled();
    if (useHfSpace) {
      const duplicated = await duplicateVideoSpace(video.id);
      duplicatedSpaceId = duplicated.repoId;
      video.hf_space_id = duplicated.repoId;
      video.hf_space_url = duplicated.repoUrl;
      video.progress_percent = Math.max(Number(video.progress_percent) || 0, 1);
      await video.save();
      inferenceBaseUrl = await waitForSpaceReady(duplicated.repoId);
      video.hf_space_url = inferenceBaseUrl;
      video.progress_percent = Math.max(Number(video.progress_percent) || 0, 2);
      await video.save();
      authorizationToken = HF_TOKEN;
    }

    if (!inferenceBaseUrl) {
      throw new Error("INFERENCE_BASE_URL is not configured");
    }

    let callbackUrl = null;
    let progressUrl = null;
    if (!useHfSpace) {
      const callbackBase = API_BASE_URL || "";
      if (!callbackBase) {
        throw new Error("API_BASE_URL is required for background video callbacks");
      }
      callbackUrl = `${callbackBase}/internal/videos/generated/${video.id}/content`;
      progressUrl = `${callbackBase}/internal/videos/generated/${video.id}/progress`;
    }

    const outputBytes = await triggerVideoSwap({
      generatedVideoId: video.id,
      inferenceBaseUrl,
      authorizationToken,
      modelBytes,
      videoBytes,
      videoFilename: video.filename,
      videoMimeType: video.input_mime_type || video.mime_type,
      modelId: video.face_model_id,
      enableRestore: Boolean(video.enable_restore),
      expressionStrength: video.expression_strength,
      manualGender: model.gender || null,
      swapModel: video.swap_model || "inswapper_128",
      callbackUrl,
      progressUrl,
      callbackToken: INFERENCE_CALLBACK_TOKEN,
    });

    if (useHfSpace) {
      const driveResult = await uploadBuffer({
        buffer: outputBytes,
        filename: `swapped-${video.id}-${Date.now()}.mp4`,
        mimeType: "video/mp4",
        authUser: owner,
      });
      video.filename = `swapped-${video.id}.mp4`;
      video.mime_type = driveResult.mime_type || "video/mp4";
      video.processing = false;
      video.status = "done";
      video.error = null;
      video.progress_percent = 100;
      video.drive_file_id = driveResult.drive_file_id;
      video.size = driveResult.size;
      video.finished_at = new Date();
      await video.save();
    }

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
  } finally {
    await deleteHfSpace(duplicatedSpaceId).catch((err) =>
      logApiError(`delete duplicated HF Space ${duplicatedSpaceId}`, err)
    );
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
