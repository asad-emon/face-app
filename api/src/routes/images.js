import express from "express";
import { GeneratedImage, InputImage, SwapJob } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import upload from "../middleware/upload.js";
import { logApiError } from "../utils/logging.js";
import { parseBoolean } from "../utils/parsing.js";
import {
  serializeGeneratedImage,
  serializeInputImage,
} from "../utils/serialize.js";
import {
  uploadBuffer,
  downloadBuffer,
  deleteFile,
  deleteManyFiles,
} from "../services/driveStorage.js";

const router = express.Router();

router.post("/images", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ detail: "No file uploaded" });
  }
  const filename = (req.file.originalname || "image").slice(0, 64);
  try {
    const driveResult = await uploadBuffer({
      buffer: req.file.buffer,
      filename,
      mimeType: req.file.mimetype || "application/octet-stream",
      authUser: req.user,
    });
    const image = await InputImage.create({
      filename,
      drive_file_id: driveResult.drive_file_id,
      mime_type: driveResult.mime_type,
      size: driveResult.size,
      owner_id: req.user.id,
    });
    return res.json(
      serializeInputImage(image, {
        includeData: true,
        data: req.file.buffer,
      })
    );
  } catch (err) {
    logApiError("POST /images", err);
    return res.status(502).json({ detail: `Drive upload failed: ${err.message}` });
  }
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

  let dataMap = new Map();
  if (includeData && rows.length > 0) {
    const downloads = await Promise.all(
      rows.map(async (row) => {
        if (!row.drive_file_id) return [row.id, null];
        try {
          const buffer = await downloadBuffer(row.drive_file_id, req.user);
          return [row.id, buffer];
        } catch (err) {
          logApiError(`GET /images download ${row.drive_file_id}`, err);
          return [row.id, null];
        }
      })
    );
    dataMap = new Map(downloads);
  }

  return res.json({
    items: rows.map((row) =>
      serializeInputImage(row, {
        includeData,
        data: dataMap.get(row.id) || null,
      })
    ),
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

  const generatedToDelete = await GeneratedImage.find({
    owner_id: req.user.id,
    input_image_id: id,
  })
    .select({ drive_file_id: 1 })
    .lean();

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

  await deleteManyFiles([
    inputImage.drive_file_id,
    ...generatedToDelete.map((g) => g.drive_file_id),
  ], req.user);

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
    .select({ id: 1, drive_file_id: 1 })
    .lean();
  const existingIds = existingInputImages.map((item) => item.id);

  if (existingIds.length === 0) {
    return res.json({ deleted_input: 0, deleted_generated: 0 });
  }

  const generatedToDelete = await GeneratedImage.find({
    owner_id: req.user.id,
    input_image_id: { $in: existingIds },
  })
    .select({ drive_file_id: 1 })
    .lean();

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

  await deleteManyFiles([
    ...existingInputImages.map((i) => i.drive_file_id),
    ...generatedToDelete.map((g) => g.drive_file_id),
  ], req.user);

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

  const downloads = await Promise.all(
    rows.map(async (row) => {
      if (!row.drive_file_id) return [row.id, null];
      try {
        const buffer = await downloadBuffer(row.drive_file_id, req.user);
        return [row.id, buffer];
      } catch (err) {
        logApiError(`GET /images/generated download ${row.drive_file_id}`, err);
        return [row.id, null];
      }
    })
  );
  const dataMap = new Map(downloads);

  return res.json({
    items: rows.map((row) =>
      serializeGeneratedImage(row, { data: dataMap.get(row.id) || null })
    ),
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

  let data = null;
  if (image.drive_file_id) {
    try {
      data = await downloadBuffer(image.drive_file_id, req.user);
    } catch (err) {
      logApiError(`GET /images/generated/:id download ${image.drive_file_id}`, err);
    }
  }

  return res.json(serializeGeneratedImage(image, { data }));
});

router.delete("/images/generated/:id(\\d+)", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ detail: "Invalid image id" });
  }

  const existing = await GeneratedImage.findOne({ id, owner_id: req.user.id }).lean();
  if (!existing) {
    return res.status(404).json({ detail: "Image not found" });
  }

  const result = await GeneratedImage.deleteOne({ id, owner_id: req.user.id });
  if ((result.deletedCount || 0) === 0) {
    return res.status(404).json({ detail: "Image not found" });
  }

  await deleteFile(existing.drive_file_id, req.user).catch((err) =>
    logApiError(`DELETE /images/generated/:id drive ${existing.drive_file_id}`, err)
  );

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
  const existing = await GeneratedImage.find({
    owner_id: req.user.id,
    id: { $in: uniqueIds },
  })
    .select({ drive_file_id: 1 })
    .lean();

  const result = await GeneratedImage.deleteMany({
    owner_id: req.user.id,
    id: { $in: uniqueIds },
  });

  await deleteManyFiles(existing.map((g) => g.drive_file_id), req.user);

  return res.json({ deleted: result.deletedCount || 0 });
});

export default router;
