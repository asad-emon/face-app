import express from "express";
import axios from "axios";
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
} from "../services/storage.js";

const router = express.Router();

const INSTAGRAM_HOST_RE = /(^|\.)instagram\.com$|(^|\.)cdninstagram\.com$|(^|\.)fbcdn\.net$|(^|\.)fbsbx\.com$/i;
const MAX_REMOTE_IMAGE_BYTES = 25 * 1024 * 1024;

function isAllowedInstagramUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && INSTAGRAM_HOST_RE.test(url.hostname);
  } catch (_err) {
    return false;
  }
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function extractOgImage(html) {
  const metaTags = String(html || "").match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const property = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (String(property || "").toLowerCase() !== "og:image") {
      continue;
    }
    const content = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
    if (content) {
      return decodeHtmlEntities(content);
    }
  }
  return "";
}

function decodeInstagramUrl(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"');
}

function extractInstagramImageUrls(html) {
  const source = String(html || "");
  const candidates = [];
  const addCandidate = (value) => {
    const decoded = decodeInstagramUrl(value).trim();
    if (decoded && isAllowedInstagramUrl(decoded)) {
      candidates.push(decoded);
    }
  };

  const metaTags = source.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const property = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (/^og:image(?::secure_url)?$/i.test(String(property || ""))) {
      addCandidate(tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1]);
    }
  }

  // Instagram embeds the original carousel images as display_url values in
  // the page JSON. These are higher-resolution than the og:image preview.
  for (const match of source.matchAll(/["']display_url["']\s*:\s*["']([^"']+)["']/gi)) {
    addCandidate(match[1]);
  }
  for (const match of source.matchAll(/["']image_versions2["'][\s\S]{0,800}?["']url["']\s*:\s*["']([^"']+)["']/gi)) {
    addCandidate(match[1]);
  }

  return [...new Set(candidates)];
}

async function fetchInstagramImage(rawUrl) {
  if (!isAllowedInstagramUrl(rawUrl)) {
    const error = new Error("Only HTTPS Instagram image or post URLs are supported.");
    error.status = 400;
    throw error;
  }

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (compatible; FaceAppImageImporter/1.0; +https://www.instagram.com/)",
    Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  };
  const response = await axios.get(rawUrl, {
    responseType: "arraybuffer",
    headers,
    maxContentLength: MAX_REMOTE_IMAGE_BYTES,
    maxBodyLength: MAX_REMOTE_IMAGE_BYTES,
    timeout: 20000,
    validateStatus: (status) => status >= 200 && status < 400,
  });
  const contentType = String(response.headers["content-type"] || "").toLowerCase();

  if (contentType.startsWith("image/")) {
    return {
      buffer: Buffer.from(response.data),
      contentType: contentType.split(";")[0] || "image/jpeg",
    };
  }

  if (!contentType.includes("text/html")) {
    const error = new Error("Instagram URL did not return an image or an Instagram page.");
    error.status = 422;
    throw error;
  }

  const html = Buffer.from(response.data).toString("utf8");
  const imageUrl = extractInstagramImageUrls(html)[0] || extractOgImage(html);
  if (!imageUrl || !isAllowedInstagramUrl(imageUrl)) {
    const error = new Error("Could not find a downloadable image at that Instagram URL.");
    error.status = 422;
    throw error;
  }

  const imageResponse = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    headers,
    maxContentLength: MAX_REMOTE_IMAGE_BYTES,
    maxBodyLength: MAX_REMOTE_IMAGE_BYTES,
    timeout: 20000,
    validateStatus: (status) => status >= 200 && status < 400,
  });
  const imageContentType = String(imageResponse.headers["content-type"] || "image/jpeg").toLowerCase();
  if (!imageContentType.startsWith("image/")) {
    const error = new Error("Instagram did not return a downloadable image.");
    error.status = 422;
    throw error;
  }

  return {
    buffer: Buffer.from(imageResponse.data),
    contentType: imageContentType.split(";")[0] || "image/jpeg",
  };
}

router.get("/instagram/images", requireAuth, async (req, res) => {
  const postUrl = String(req.query.url || "").trim();
  if (!isAllowedInstagramUrl(postUrl)) {
    return res.status(400).json({ detail: "Only HTTPS Instagram post URLs are supported." });
  }

  try {
    const response = await axios.get(postUrl, {
      responseType: "text",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; FaceAppImageImporter/1.0; +https://www.instagram.com/)",
        Accept: "text/html,application/xhtml+xml",
      },
      maxContentLength: MAX_REMOTE_IMAGE_BYTES,
      timeout: 20000,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    const urls = extractInstagramImageUrls(response.data);
    if (urls.length === 0) {
      return res.status(422).json({ detail: "Could not find images in that Instagram post." });
    }
    return res.json({
      items: urls.map((imageUrl, index) => ({
        id: `${index}-${Buffer.from(imageUrl).toString("base64url").slice(0, 16)}`,
        url: imageUrl,
        preview_url: `/instagram/image?url=${encodeURIComponent(imageUrl)}`,
      })),
      total: urls.length,
    });
  } catch (err) {
    const status = Number(err?.status) || err.response?.status || 502;
    logApiError("GET /instagram/images", err);
    return res.status(status >= 400 && status < 600 ? status : 502).json({
      detail: err.message || "Failed to fetch Instagram post images.",
    });
  }
});

router.get("/instagram/image", requireAuth, async (req, res) => {
  const imageUrl = String(req.query.url || "").trim();
  try {
    const { buffer, contentType } = await fetchInstagramImage(imageUrl);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Cache-Control", "private, max-age=300");
    return res.send(buffer);
  } catch (err) {
    const status = Number(err?.status) || err.response?.status || 502;
    logApiError("GET /instagram/image", err);
    return res.status(status >= 400 && status < 600 ? status : 502).json({
      detail: err.message || "Failed to fetch Instagram image.",
    });
  }
});

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
      storage_provider: driveResult.storage_provider,
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
    return res.status(502).json({ detail: `Storage upload failed: ${err.message}` });
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
          const buffer = await downloadBuffer(row.drive_file_id, req.user, row.storage_provider);
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
    .select({ drive_file_id: 1, storage_provider: 1 })
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
    { id: inputImage.drive_file_id, provider: inputImage.storage_provider },
    ...generatedToDelete.map((g) => ({ id: g.drive_file_id, provider: g.storage_provider })),
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
    .select({ id: 1, drive_file_id: 1, storage_provider: 1 })
    .lean();
  const existingIds = existingInputImages.map((item) => item.id);

  if (existingIds.length === 0) {
    return res.json({ deleted_input: 0, deleted_generated: 0 });
  }

  const generatedToDelete = await GeneratedImage.find({
    owner_id: req.user.id,
    input_image_id: { $in: existingIds },
  })
    .select({ drive_file_id: 1, storage_provider: 1 })
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
    ...existingInputImages.map((i) => ({ id: i.drive_file_id, provider: i.storage_provider })),
    ...generatedToDelete.map((g) => ({ id: g.drive_file_id, provider: g.storage_provider })),
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

  // Default newest-first; `sort=rating` orders by highest rating first (unrated
  // rows fall to the end since MongoDB sorts null lowest on a descending sort).
  const sortSpec =
    String(req.query.sort || "").toLowerCase() === "rating"
      ? { rating: -1, id: -1 }
      : { id: -1 };

  const filter = { owner_id: req.user.id };
  const [rows, count] = await Promise.all([
    GeneratedImage.find(filter).sort(sortSpec).skip(skip).limit(limit).lean(),
    GeneratedImage.countDocuments(filter),
  ]);

  const downloads = await Promise.all(
    rows.map(async (row) => {
      if (!row.drive_file_id) return [row.id, null];
      try {
        const buffer = await downloadBuffer(row.drive_file_id, req.user, row.storage_provider);
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
      data = await downloadBuffer(image.drive_file_id, req.user, image.storage_provider);
    } catch (err) {
      logApiError(`GET /images/generated/:id download ${image.drive_file_id}`, err);
    }
  }

  return res.json(serializeGeneratedImage(image, { data }));
});

router.patch("/images/generated/:id(\\d+)/rating", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ detail: "Invalid generated image id" });
  }

  const raw = req.body?.rating;
  let rating;
  if (raw === null || raw === "" || raw === undefined) {
    rating = null; // clear the rating
  } else {
    rating = Number(raw);
    if (!Number.isFinite(rating) || rating < 1 || rating > 10) {
      return res.status(400).json({ detail: "rating must be a number between 1 and 10" });
    }
    rating = Math.round(rating * 10) / 10; // one decimal place
  }

  const image = await GeneratedImage.findOneAndUpdate(
    { id, owner_id: req.user.id },
    { $set: { rating } },
    { new: true }
  ).lean();
  if (!image) {
    return res.status(404).json({ detail: "Generated image not found" });
  }

  return res.json(serializeGeneratedImage(image, { data: null }));
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

  await deleteFile(existing.drive_file_id, req.user, existing.storage_provider).catch((err) =>
    logApiError(`DELETE /images/generated/:id storage ${existing.drive_file_id}`, err)
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
    .select({ drive_file_id: 1, storage_provider: 1 })
    .lean();

  const result = await GeneratedImage.deleteMany({
    owner_id: req.user.id,
    id: { $in: uniqueIds },
  });

  await deleteManyFiles(
    existing.map((g) => ({ id: g.drive_file_id, provider: g.storage_provider })),
    req.user
  );

  return res.json({ deleted: result.deletedCount || 0 });
});

export default router;
