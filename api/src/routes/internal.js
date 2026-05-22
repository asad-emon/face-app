import express from "express";
import { GeneratedVideo, User } from "../db.js";
import { requireInferenceAuth } from "../middleware/auth.js";
import upload from "../middleware/upload.js";
import { logApiError } from "../utils/logging.js";
import { uploadBuffer, deleteFile } from "../services/driveStorage.js";

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
    const owner = await User.findOne({ id: video.owner_id });
    if (!owner) {
      return res.status(404).json({ detail: "Video owner not found" });
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

    const filename = req.body?.filename || file.originalname || video.filename;
    const mimeType = req.body?.mime_type || file.mimetype || "video/mp4";

    let driveResult;
    try {
      driveResult = await uploadBuffer({
        buffer: file.buffer,
        filename: filename || `generated-${video.id}.mp4`,
        mimeType,
        authUser: owner,
      });
    } catch (err) {
      logApiError(`POST /internal/videos/${id}/content drive upload`, err);
      return res.status(502).json({ detail: `Drive upload failed: ${err.message}` });
    }

    const previousDriveId = video.drive_file_id;

    video.filename = filename;
    video.mime_type = mimeType;
    video.processing = false;
    video.status = "done";
    video.error = null;
    video.total_frames = totalFrames || 0;
    video.processed_frames = processedFrames || 0;
    video.progress_percent = progressPercent;
    video.drive_file_id = driveResult.drive_file_id;
    video.size = driveResult.size;
    video.finished_at = new Date();
    await video.save();

    if (previousDriveId && previousDriveId !== driveResult.drive_file_id) {
      await deleteFile(previousDriveId, owner).catch((err) =>
        logApiError(`POST /internal/videos/${id}/content cleanup ${previousDriveId}`, err)
      );
    }

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
