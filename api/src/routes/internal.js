import express from "express";
import { GeneratedVideo } from "../db.js";
import { requireInferenceAuth } from "../middleware/auth.js";
import upload from "../middleware/upload.js";

const router = express.Router();

router.post(
  "/internal/videos/generated/:id/content",
  requireInferenceAuth,
  upload.single("file"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ detail: "Invalid video id" });
    }
    const file = req.file;
    if (!file) {
      return res.status(400).json({ detail: "No video uploaded" });
    }

    const video = await GeneratedVideo.findOne({ id });
    if (!video) {
      return res.status(404).json({ detail: "Video not found" });
    }

    const parsedTotal = Number(req.body?.total_frames);
    const parsedProcessed = Number(req.body?.processed_frames);
    const parsedProgress = Number(req.body?.progress_percent);
    const totalFrames =
      Number.isFinite(parsedTotal) && parsedTotal > 0
        ? parsedTotal
        : video.total_frames;
    const processedFrames =
      Number.isFinite(parsedProcessed) && parsedProcessed >= 0
        ? parsedProcessed
        : video.processed_frames;
    const progressPercent = Number.isFinite(parsedProgress)
      ? Math.max(0, Math.min(100, parsedProgress))
      : 100;

    video.filename = req.body?.filename || file.originalname || video.filename;
    video.mime_type = req.body?.mime_type || file.mimetype || "video/mp4";
    video.processing = false;
    video.total_frames = totalFrames || 0;
    video.processed_frames = processedFrames || 0;
    video.progress_percent = progressPercent;
    video.data = file.buffer;
    await video.save();

    return res.json({ id: video.id, processing: false });
  }
);

router.post(
  "/internal/videos/generated/:id/progress",
  requireInferenceAuth,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ detail: "Invalid video id" });
    }

    const video = await GeneratedVideo.findOne({ id });
    if (!video) {
      return res.status(404).json({ detail: "Video not found" });
    }

    const parsedTotal = Number(req.body?.total_frames);
    const parsedProcessed = Number(req.body?.processed_frames);
    const parsedProgress = Number(req.body?.progress_percent);
    const totalFrames =
      Number.isFinite(parsedTotal) && parsedTotal > 0
        ? parsedTotal
        : video.total_frames;
    const processedFrames =
      Number.isFinite(parsedProcessed) && parsedProcessed >= 0
        ? parsedProcessed
        : video.processed_frames;
    let progressPercent = Number.isFinite(parsedProgress)
      ? Math.max(0, Math.min(100, parsedProgress))
      : null;
    if (progressPercent === null && totalFrames > 0) {
      progressPercent = Math.min(100, Math.round((processedFrames / totalFrames) * 100));
    }

    video.total_frames = totalFrames || 0;
    video.processed_frames = processedFrames || 0;
    video.progress_percent = progressPercent ?? video.progress_percent ?? 0;
    await video.save();

    return res.json({
      id: video.id,
      processing: Boolean(video.processing),
      total_frames: Number(video.total_frames) || 0,
      processed_frames: Number(video.processed_frames) || 0,
      progress_percent: Number(video.progress_percent) || 0,
    });
  }
);

export default router;
