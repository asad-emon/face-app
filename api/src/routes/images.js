import express from "express";
import { Op } from "sequelize";
import { GeneratedImage, InputImage, SwapJob, sequelize } from "../db.js";
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

  const { count, rows } = await InputImage.findAndCountAll({
    where: { owner_id: req.user.id },
    order: [["id", "DESC"]],
    offset: skip,
    limit,
  });

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

  const result = await sequelize.transaction(async (transaction) => {
    const inputImage = await InputImage.findOne({
      where: { id, owner_id: req.user.id },
      transaction,
    });
    if (!inputImage) {
      return null;
    }

    const deletedGenerated = await GeneratedImage.destroy({
      where: {
        owner_id: req.user.id,
        input_image_id: id,
      },
      transaction,
    });
    await SwapJob.destroy({
      where: {
        owner_id: req.user.id,
        input_image_id: id,
      },
      transaction,
    });
    const deletedInput = await InputImage.destroy({
      where: { id, owner_id: req.user.id },
      transaction,
    });

    return { deleted_input: deletedInput, deleted_generated: deletedGenerated };
  });

  if (!result) {
    return res.status(404).json({ detail: "Image not found" });
  }

  return res.json(result);
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
  const result = await sequelize.transaction(async (transaction) => {
    const existingInputImages = await InputImage.findAll({
      where: {
        owner_id: req.user.id,
        id: { [Op.in]: uniqueIds },
      },
      attributes: ["id"],
      transaction,
    });
    const existingIds = existingInputImages.map((item) => item.id);

    if (existingIds.length === 0) {
      return { deleted_input: 0, deleted_generated: 0 };
    }

    const deletedGenerated = await GeneratedImage.destroy({
      where: {
        owner_id: req.user.id,
        input_image_id: { [Op.in]: existingIds },
      },
      transaction,
    });
    await SwapJob.destroy({
      where: {
        owner_id: req.user.id,
        input_image_id: { [Op.in]: existingIds },
      },
      transaction,
    });
    const deletedInput = await InputImage.destroy({
      where: {
        owner_id: req.user.id,
        id: { [Op.in]: existingIds },
      },
      transaction,
    });

    return { deleted_input: deletedInput, deleted_generated: deletedGenerated };
  });

  return res.json(result);
});

router.get("/images/generated", requireAuth, async (req, res) => {
  const parsedSkip = Number(req.query.skip);
  const parsedLimit = Number(req.query.limit);
  const skip = Number.isInteger(parsedSkip) && parsedSkip >= 0 ? parsedSkip : 0;
  const limit =
    Number.isInteger(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 100)
      : 12;

  const { count, rows } = await GeneratedImage.findAndCountAll({
    where: { owner_id: req.user.id },
    order: [["id", "DESC"]],
    offset: skip,
    limit,
  });
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

  const image = await GeneratedImage.findOne({
    where: { id, owner_id: req.user.id },
  });
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

  const deleted = await GeneratedImage.destroy({
    where: { id, owner_id: req.user.id },
  });

  if (deleted === 0) {
    return res.status(404).json({ detail: "Image not found" });
  }

  return res.json({ deleted });
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
  const deleted = await GeneratedImage.destroy({
    where: {
      owner_id: req.user.id,
      id: { [Op.in]: uniqueIds },
    },
  });

  return res.json({ deleted });
});

export default router;
