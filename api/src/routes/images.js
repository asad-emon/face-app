import express from "express";
import { GeneratedImage, InputImage, SwapJob } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import upload from "../middleware/upload.js";
import { parseBoolean } from "../utils/parsing.js";
import {
  serializeGeneratedImage,
  serializeInputImage,
} from "../utils/serialize.js";

const router = express.Router();

router.post("/images", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ detail: "No file uploaded" });
  }
  const filename = (req.file.originalname || "image").slice(0, 64);
  const image = await InputImage.create({
    filename,
    data: req.file.buffer,
    owner_id: req.user.id,
  });
  return res.json(serializeInputImage(image));
});

router.get("/images", requireAuth, async (req, res) => {
  const parsedSkip = Number(req.query.skip);
  const parsedLimit = Number(req.query.limit);
  const skip = Number.isInteger(parsedSkip) && parsedSkip >= 0 ? parsedSkip : 0;
  const limit =
    Number.isInteger(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 100)
      : 12;
  const includeData = parseBoolean(req.query.include_data, true);

  const filter = { owner_id: req.user.id };
  const [rows, count] = await Promise.all([
    InputImage.find(filter).sort({ id: -1 }).skip(skip).limit(limit).lean(),
    InputImage.countDocuments(filter),
  ]);

  return res.json({
    items: rows.map((row) => serializeInputImage(row, { includeData })),
    total: count,
    skip,
    limit,
  });
});

router.delete("/images/:id(\\d+)", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ detail: "Invalid image id" });
  }

  const inputImage = await InputImage.findOne({ id, owner_id: req.user.id }).lean();
  if (!inputImage) {
    return res.status(404).json({ detail: "Image not found" });
  }

  const generatedDeleteResult = await GeneratedImage.deleteMany({
    owner_id: req.user.id,
    input_image_id: id,
  });
  await SwapJob.deleteMany({
    owner_id: req.user.id,
    input_image_id: id,
  });
  const inputDeleteResult = await InputImage.deleteOne({
    id,
    owner_id: req.user.id,
  });

  return res.json({
    deleted_input: inputDeleteResult.deletedCount || 0,
    deleted_generated: generatedDeleteResult.deletedCount || 0,
  });
});

router.delete("/images", requireAuth, async (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    : [];

  if (ids.length === 0) {
    return res.status(400).json({ detail: "ids must be a non-empty array" });
  }

  const uniqueIds = [...new Set(ids)];
  const existingInputImages = await InputImage.find({
    owner_id: req.user.id,
    id: { $in: uniqueIds },
  })
    .select({ id: 1 })
    .lean();
  const existingIds = existingInputImages.map((item) => item.id);

  if (existingIds.length === 0) {
    return res.json({ deleted_input: 0, deleted_generated: 0 });
  }

  const generatedDeleteResult = await GeneratedImage.deleteMany({
    owner_id: req.user.id,
    input_image_id: { $in: existingIds },
  });
  await SwapJob.deleteMany({
    owner_id: req.user.id,
    input_image_id: { $in: existingIds },
  });
  const inputDeleteResult = await InputImage.deleteMany({
    owner_id: req.user.id,
    id: { $in: existingIds },
  });

  return res.json({
    deleted_input: inputDeleteResult.deletedCount || 0,
    deleted_generated: generatedDeleteResult.deletedCount || 0,
  });
});

router.get("/images/generated", requireAuth, async (req, res) => {
  const parsedSkip = Number(req.query.skip);
  const parsedLimit = Number(req.query.limit);
  const skip = Number.isInteger(parsedSkip) && parsedSkip >= 0 ? parsedSkip : 0;
  const limit =
    Number.isInteger(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 100)
      : 12;

  const filter = { owner_id: req.user.id };
  const [rows, count] = await Promise.all([
    GeneratedImage.find(filter).sort({ id: -1 }).skip(skip).limit(limit).lean(),
    GeneratedImage.countDocuments(filter),
  ]);
  return res.json({
    items: rows.map(serializeGeneratedImage),
    total: count,
    skip,
    limit,
  });
});

router.get("/images/generated/:id(\\d+)", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ detail: "Invalid generated image id" });
  }

  const image = await GeneratedImage.findOne({ id, owner_id: req.user.id }).lean();
  if (!image) {
    return res.status(404).json({ detail: "Generated image not found" });
  }

  return res.json(serializeGeneratedImage(image));
});

router.delete("/images/generated/:id(\\d+)", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ detail: "Invalid image id" });
  }

  const result = await GeneratedImage.deleteOne({ id, owner_id: req.user.id });

  if ((result.deletedCount || 0) === 0) {
    return res.status(404).json({ detail: "Image not found" });
  }

  return res.json({ deleted: result.deletedCount });
});

router.delete("/images/generated", requireAuth, async (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    : [];

  if (ids.length === 0) {
    return res.status(400).json({ detail: "ids must be a non-empty array" });
  }

  const uniqueIds = [...new Set(ids)];
  const result = await GeneratedImage.deleteMany({
    owner_id: req.user.id,
    id: { $in: uniqueIds },
  });

  return res.json({ deleted: result.deletedCount || 0 });
});

export default router;
