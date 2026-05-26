import express from "express";
import { FaceModel, GeneratedVideo, InputImage, SwapJob } from "../db.js";
import { API_BASE_URL, HF_SOURCE_SPACE_ID, HF_TOKEN, INFERENCE_BASE_URL, SWAP_QUEUE_POLL_LIMIT } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import upload from "../middleware/upload.js";
import { logApiError } from "../utils/logging.js";
import { getErrorDetail, parseBoolean, parseSwapModel } from "../utils/parsing.js";
import { serializeGeneratedVideo, serializeSwapJob } from "../utils/serialize.js";
import { uploadBuffer, deleteFile } from "../services/driveStorage.js";
import { enqueueSwapJob, enqueueVideoSwapJob, runSwapAndStore } from "../services/swapService.js";

const router = express.Router();

router.post("/swap-jobs", requireAuth, async (req, res) => {
  const modelId = Number(req.body?.model_id);
  const enableRestore = parseBoolean(req.body?.enable_restore, true);
  const expressionStrength = Math.max(0, Math.min(1, Number(req.body?.expression_strength ?? 0.85))) || 0.85;
  const swapModel = parseSwapModel(req.body?.swap_model);
  const imageIds = Array.isArray(req.body?.image_ids)
    ? req.body.image_ids
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
    : [];

  if (!modelId || imageIds.length === 0) {
    return res.status(400).json({ detail: "model_id and non-empty image_ids are required" });
  }
  if (!INFERENCE_BASE_URL) {
    return res.status(500).json({ detail: "INFERENCE_BASE_URL is not configured" });
  }

  const model = await FaceModel.findOne({
    id: modelId,
    owner_id: req.user.id,
    is_deleted: false,
  })
    .select({ id: 1 })
    .lean();
  if (!model) {
    return res.status(404).json({ detail: "Model not found" });
  }

  const uniqueImageIds = [...new Set(imageIds)];
  const ownedImages = await InputImage.find({
    owner_id: req.user.id,
    id: { $in: uniqueImageIds },
  })
    .select({ id: 1 })
    .lean();
  if (ownedImages.length !== uniqueImageIds.length) {
    return res.status(404).json({ detail: "One or more input images were not found" });
  }

  const created = [];
  for (const imageId of uniqueImageIds) {
    const job = await SwapJob.create({
      owner_id: req.user.id,
      face_model_id: modelId,
      input_image_id: imageId,
      enable_restore: enableRestore,
      swap_model: swapModel,
      status: "queued",
    });
    created.push(job);
  }

  created.forEach((job) => enqueueSwapJob(job.id, expressionStrength));
  return res.status(202).json({
    items: created.map(serializeSwapJob),
    total: created.length,
  });
});

router.get("/swap-jobs", requireAuth, async (req, res) => {
  const ids = String(req.query.ids || "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (ids.length === 0) {
    return res.status(400).json({ detail: "ids query param is required (comma-separated)" });
  }
  if (ids.length > SWAP_QUEUE_POLL_LIMIT) {
    return res.status(400).json({ detail: `Maximum ${SWAP_QUEUE_POLL_LIMIT} ids per poll request` });
  }

  const uniqueIds = [...new Set(ids)];
  const jobs = await SwapJob.find({
    owner_id: req.user.id,
    id: { $in: uniqueIds },
  })
    .sort({ id: 1 })
    .limit(SWAP_QUEUE_POLL_LIMIT)
    .lean();

  return res.json({
    items: jobs.map(serializeSwapJob),
    total: jobs.length,
  });
});

router.post("/swap", requireAuth, async (req, res) => {
  const modelId = Number(req.query.model_id || req.body.model_id);
  const imageId = Number(req.query.image_id || req.body.image_id);
  const enableRestore = parseBoolean(
    req.query.enable_restore ?? req.body.enable_restore,
    true
  );
  const expressionStrength = Math.max(0, Math.min(1, Number(
    req.query.expression_strength ?? req.body.expression_strength ?? 0.85
  ))) || 0.85;
  const swapModel = parseSwapModel(req.query.swap_model ?? req.body?.swap_model);

  if (!modelId || !imageId) {
    return res.status(400).json({ detail: "model_id and image_id are required" });
  }
  if (!INFERENCE_BASE_URL) {
    return res.status(500).json({ detail: "INFERENCE_BASE_URL is not configured" });
  }

  try {
    const { outputBytes } = await runSwapAndStore(req.user.id, modelId, imageId, enableRestore, expressionStrength, swapModel);
    return res.json({
      result: `data:image/jpeg;base64,${outputBytes.toString("base64")}`,
    });
  } catch (err) {
    if (String(err?.message || "").toLowerCase().includes("not found")) {
      return res.status(404).json({ detail: "Model or image not found" });
    }
    logApiError("POST /swap", err);
    const detail = getErrorDetail(err);
    return res.status(502).json({ detail: `Swap service failed: ${detail}` });
  }
});

router.post(
  "/swap-video",
  requireAuth,
  upload.fields([
    { name: "file", maxCount: 1 },
    { name: "files", maxCount: 20 },
  ]),
  async (req, res) => {
  const modelId = Number(req.query.model_id || req.body.model_id);
  const enableRestore = parseBoolean(
    req.query.enable_restore ?? req.body.enable_restore,
    false
  );
  const expressionStrength = Math.max(0, Math.min(1, Number(
    req.query.expression_strength ?? req.body.expression_strength ?? 0.85
  ))) || 0.85;
  const swapModel = parseSwapModel(req.query.swap_model ?? req.body?.swap_model);
  const videos = [
    ...(Array.isArray(req.files?.file) ? req.files.file : []),
    ...(Array.isArray(req.files?.files) ? req.files.files : []),
  ];

  if (!modelId) {
    return res.status(400).json({ detail: "model_id is required" });
  }
  if (videos.length === 0) {
    return res.status(400).json({ detail: "No videos uploaded" });
  }

  const model = await FaceModel.findOne({
    id: modelId,
    owner_id: req.user.id,
    is_deleted: false,
  })
    .select({ drive_file_id: 1 })
    .lean();
  if (!model) {
    return res.status(404).json({ detail: "Model not found" });
  }

  if (!INFERENCE_BASE_URL && !(HF_TOKEN && HF_SOURCE_SPACE_ID)) {
    return res.status(500).json({ detail: "INFERENCE_BASE_URL or HF_TOKEN + HF_SOURCE_SPACE_ID is required" });
  }
  if (!API_BASE_URL && !(HF_TOKEN && HF_SOURCE_SPACE_ID)) {
    return res.status(500).json({ detail: "API_BASE_URL is required for background video processing" });
  }

  const created = [];
  const uploadedInputDriveIds = [];
  try {
    for (const video of videos) {
      const inputDrive = await uploadBuffer({
        buffer: video.buffer,
        filename: `video-input-${req.user.id}-${modelId}-${Date.now()}-${video.originalname || "target.mp4"}`,
        mimeType: video.mimetype || "video/mp4",
        authUser: req.user,
      });
      uploadedInputDriveIds.push(inputDrive.drive_file_id);

      const generatedVideo = await GeneratedVideo.create({
        filename: video.originalname || "target.mp4",
        mime_type: "video/mp4",
        processing: true,
        status: "queued",
        error: null,
        total_frames: 0,
        processed_frames: 0,
        progress_percent: 0,
        drive_file_id: null,
        input_drive_file_id: inputDrive.drive_file_id,
        input_mime_type: video.mimetype || "video/mp4",
        input_size: inputDrive.size,
        owner_id: req.user.id,
        face_model_id: modelId,
        enable_restore: enableRestore,
        expression_strength: expressionStrength,
        swap_model: swapModel,
      });
      created.push(generatedVideo);
    }

    created.forEach((video) => enqueueVideoSwapJob(video.id));

    const payload = {
      items: created.map(serializeGeneratedVideo),
      total: created.length,
    };
    if (created.length === 1) {
      return res.status(202).json({ ...serializeGeneratedVideo(created[0]), ...payload });
    }
    return res.status(202).json(payload);
  } catch (err) {
    if (created.length > 0) {
      await GeneratedVideo.deleteMany({
        owner_id: req.user.id,
        id: { $in: created.map((video) => video.id) },
      });
    }
    await Promise.all(
      uploadedInputDriveIds.map((driveId) =>
        deleteFile(driveId, req.user).catch((deleteErr) =>
          logApiError(`POST /swap-video cleanup ${driveId}`, deleteErr)
        )
      )
    );
    logApiError("POST /swap-video", err);
    const detail = err.response?.data?.detail || err.message;
    return res.status(502).json({ detail: `Video swap service failed: ${detail}` });
  }
});

export default router;
