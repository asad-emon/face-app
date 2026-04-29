import express from "express";
import { GeneratedVideo } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { serializeGeneratedVideo } from "../utils/serialize.js";

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
    total_frames: Number(video.total_frames) || 0,
    processed_frames: Number(video.processed_frames) || 0,
    progress_percent: Number(video.progress_percent) || 0,
    has_content: Boolean(video.data && Buffer.from(video.data).length > 0),
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
  if (!video.data || Buffer.from(video.data).length === 0) {
    return res.status(404).json({ detail: "Video content is not available" });
  }

  const filename = video.filename || `generated-${video.id}.mp4`;
  const mimeType = video.mime_type || "video/mp4";
  const fullBuffer = Buffer.from(video.data);
  const total = fullBuffer.length;
  const range = req.headers.range;

  res.setHeader("Content-Type", mimeType);
  res.setHeader("Content-Disposition", `inline; filename=\"${filename}\"`);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");

  if (!range) {
    res.setHeader("Content-Length", String(total));
    return res.send(fullBuffer);
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  if (!match) {
    res.setHeader("Content-Range", `bytes */${total}`);
    return res.status(416).end();
  }

  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : total - 1;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start > end ||
    end >= total
  ) {
    res.setHeader("Content-Range", `bytes */${total}`);
    return res.status(416).end();
  }

  const chunk = fullBuffer.subarray(start, end + 1);
  res.status(206);
  res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
  res.setHeader("Content-Length", String(chunk.length));
  return res.send(chunk);
});

router.delete("/videos/generated/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ detail: "Invalid video id" });
  }

  const result = await GeneratedVideo.deleteOne({ id, owner_id: req.user.id });

  if ((result.deletedCount || 0) === 0) {
    return res.status(404).json({ detail: "Video not found" });
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
  const result = await GeneratedVideo.deleteMany({
    owner_id: req.user.id,
    id: { $in: uniqueIds },
  });

  return res.json({ deleted: result.deletedCount || 0 });
});

export default router;
