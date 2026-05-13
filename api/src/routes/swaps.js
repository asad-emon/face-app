import express from "express";
import { FaceModel, GeneratedVideo, InputImage, SwapJob } from "../db.js";
import { INFERENCE_BASE_URL, INFERENCE_CALLBACK_TOKEN, SWAP_QUEUE_POLL_LIMIT } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import upload from "../middleware/upload.js";
import { logApiError } from "../utils/logging.js";
import { getApiBaseUrl } from "../utils/http.js";
import { getErrorDetail, parseBoolean } from "../utils/parsing.js";
import { serializeGeneratedVideo, serializeSwapJob } from "../utils/serialize.js";
import { enqueueSwapJob, runSwapAndStore, triggerVideoSwap } from "../services/swapService.js";

const router = express.Router();

router.post("/swap-jobs", requireAuth, async (req, res) => {
  const modelId = Number(req.body?.model_id);
  const enableRestore = parseBoolean(req.body?.enable_restore, true);
  const expressionStrength = Math.max(0, Math.min(1, Number(req.body?.expression_strength ?? 0.85))) || 0.85;
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

  if (!modelId || !imageId) {
    return res.status(400).json({ detail: "model_id and image_id are required" });
  }
  if (!INFERENCE_BASE_URL) {
    return res.status(500).json({ detail: "INFERENCE_BASE_URL is not configured" });
  }

  try {
    const { outputBytes } = await runSwapAndStore(req.user.id, modelId, imageId, enableRestore, expressionStrength);
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

router.post("/swap-video", requireAuth, upload.single("file"), async (req, res) => {
  const modelId = Number(req.query.model_id || req.body.model_id);
  const enableRestore = parseBoolean(
    req.query.enable_restore ?? req.body.enable_restore,
    false
  );
  const expressionStrength = Math.max(0, Math.min(1, Number(
    req.query.expression_strength ?? req.body.expression_strength ?? 0.85
  ))) || 0.85;
  const video = req.file;

  if (!modelId) {
    return res.status(400).json({ detail: "model_id is required" });
  }
  if (!video) {
    return res.status(400).json({ detail: "No video uploaded" });
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

  if (!INFERENCE_BASE_URL) {
    return res.status(500).json({ detail: "INFERENCE_BASE_URL is not configured" });
  }

  let generatedVideo = null;
  try {
    generatedVideo = await GeneratedVideo.create({
      filename: video.originalname || "target.mp4",
      mime_type: video.mimetype || "video/mp4",
      processing: true,
      total_frames: 0,
      processed_frames: 0,
      progress_percent: 0,
      drive_file_id: null,
      owner_id: req.user.id,
      face_model_id: modelId,
    });

    const apiBaseUrl = getApiBaseUrl(req);
    if (!apiBaseUrl) {
      return res.status(500).json({ detail: "API_BASE_URL is not configured" });
    }
    const callbackUrl = `${apiBaseUrl}/internal/videos/generated/${generatedVideo.id}/content`;
    const progressUrl = `${apiBaseUrl}/internal/videos/generated/${generatedVideo.id}/progress`;

    void triggerVideoSwap({
      generatedVideoId: generatedVideo.id,
      ownerId: req.user.id,
      modelDriveId: model.drive_file_id,
      video,
      modelId,
      enableRestore,
      expressionStrength,
      callbackUrl,
      progressUrl,
      callbackToken: INFERENCE_CALLBACK_TOKEN,
    });

    return res.status(202).json(serializeGeneratedVideo(generatedVideo));
  } catch (err) {
    if (generatedVideo) {
      await GeneratedVideo.updateOne(
        { id: generatedVideo.id, owner_id: req.user.id },
        { $set: { processing: false } }
      );
    }
    logApiError("POST /swap-video", err);
    const detail = err.response?.data?.detail || err.message;
    return res.status(502).json({ detail: `Video swap service failed: ${detail}` });
  }
});

export default router;
