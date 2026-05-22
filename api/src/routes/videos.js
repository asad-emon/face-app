import express from "express";
import { GeneratedVideo } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { logApiError } from "../utils/logging.js";
import { serializeGeneratedVideo } from "../utils/serialize.js";
import {
  downloadBuffer,
  downloadRange,
  deleteFile,
  deleteManyFiles,
} from "../services/driveStorage.js";

const router = express.Router();

router.get("/videos/generated", requireAuth, async (req, res) => {
  const parsedSkip = Number(req.query.skip);
  const parsedLimit = Number(req.query.limit);
  const skip = Number.isInteger(parsedSkip) && parsedSkip >= 0 ? parsedSkip : 0;
  const limit =
    Number.isInteger(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 100)
      : 8;

  const filter = { owner_id: req.user.id };
  const [rows, count] = await Promise.all([
    GeneratedVideo.find(filter).sort({ id: -1 }).skip(skip).limit(limit).lean(),
    GeneratedVideo.countDocuments(filter),
  ]);
  return res.json({
    items: rows.map(serializeGeneratedVideo),
    total: count,
    skip,
    limit,
  });
});

router.get("/videos/generated/:id/status", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ detail: "Invalid video id" });
  }

  const video = await GeneratedVideo.findOne({ id, owner_id: req.user.id }).lean();
  if (!video) {
    return res.status(404).json({ detail: "Video not found" });
  }

  return res.json({
    id: video.id,
    processing: Boolean(video.processing),
    status: video.status || (video.processing ? "processing" : video.drive_file_id ? "done" : "failed"),
    error: video.error || null,
    total_frames: Number(video.total_frames) || 0,
    processed_frames: Number(video.processed_frames) || 0,
    progress_percent: Number(video.progress_percent) || 0,
    has_content: Boolean(video.drive_file_id),
  });
});

router.get("/videos/generated/:id/content", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ detail: "Invalid video id" });
  }

  const video = await GeneratedVideo.findOne({ id, owner_id: req.user.id }).lean();
  if (!video) {
    return res.status(404).json({ detail: "Video not found" });
  }
  if (video.processing) {
    return res.status(409).json({ detail: "Video is still processing" });
  }
  if (!video.drive_file_id) {
    return res.status(404).json({ detail: "Video content is not available" });
  }

  const filename = video.filename || `generated-${video.id}.mp4`;
  const mimeType = video.mime_type || "video/mp4";
  const total = Number(video.size) || 0;
  const range = req.headers.range;

  res.setHeader("Content-Type", mimeType);
  res.setHeader("Content-Disposition", `inline; filename=\"${filename}\"`);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");

  try {
    if (!range) {
      const fullBuffer = await downloadBuffer(video.drive_file_id, req.user);
      res.setHeader("Content-Length", String(fullBuffer.length));
      return res.send(fullBuffer);
    }

    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (!match) {
      if (total > 0) res.setHeader("Content-Range", `bytes */${total}`);
      return res.status(416).end();
    }

    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2]
      ? Number(match[2])
      : total > 0
      ? total - 1
      : null;

    if (
      !Number.isInteger(start) ||
      start < 0 ||
      (end !== null && (!Number.isInteger(end) || start > end || (total > 0 && end >= total)))
    ) {
      if (total > 0) res.setHeader("Content-Range", `bytes */${total}`);
      return res.status(416).end();
    }

    const chunk = await downloadRange(video.drive_file_id, start, end, req.user);
    const chunkEnd = start + chunk.length - 1;
    const totalForHeader = total > 0 ? total : chunkEnd + 1;
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${chunkEnd}/${totalForHeader}`);
    res.setHeader("Content-Length", String(chunk.length));
    return res.send(chunk);
  } catch (err) {
    logApiError(`GET /videos/generated/:id/content drive ${video.drive_file_id}`, err);
    return res.status(502).json({ detail: "Failed to fetch video content" });
  }
});

router.delete("/videos/generated/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ detail: "Invalid video id" });
  }

  const existing = await GeneratedVideo.findOne({ id, owner_id: req.user.id }).lean();
  if (!existing) {
    return res.status(404).json({ detail: "Video not found" });
  }

  const result = await GeneratedVideo.deleteOne({ id, owner_id: req.user.id });
  if ((result.deletedCount || 0) === 0) {
    return res.status(404).json({ detail: "Video not found" });
  }

  if (existing.drive_file_id) {
    await deleteFile(existing.drive_file_id, req.user).catch((err) =>
      logApiError(`DELETE /videos/generated/:id drive ${existing.drive_file_id}`, err)
    );
  }
  if (existing.input_drive_file_id) {
    await deleteFile(existing.input_drive_file_id, req.user).catch((err) =>
      logApiError(`DELETE /videos/generated/:id input drive ${existing.input_drive_file_id}`, err)
    );
  }

  return res.json({ deleted: result.deletedCount });
});

router.delete("/videos/generated", requireAuth, async (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    : [];

  if (ids.length === 0) {
    return res.status(400).json({ detail: "ids must be a non-empty array" });
  }

  const uniqueIds = [...new Set(ids)];
  const existing = await GeneratedVideo.find({
    owner_id: req.user.id,
    id: { $in: uniqueIds },
  })
    .select({ drive_file_id: 1, input_drive_file_id: 1 })
    .lean();

  const result = await GeneratedVideo.deleteMany({
    owner_id: req.user.id,
    id: { $in: uniqueIds },
  });

  await deleteManyFiles(
    existing.flatMap((v) => [v.drive_file_id, v.input_drive_file_id]),
    req.user
  );

  return res.json({ deleted: result.deletedCount || 0 });
});

export default router;
