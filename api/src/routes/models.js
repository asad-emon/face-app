import express from "express";
import axios from "axios";
import FormData from "form-data";
import { FaceModel } from "../db.js";
import { INFERENCE_BASE_URL } from "../config.js";
import upload from "../middleware/upload.js";
import { requireAuth } from "../middleware/auth.js";
import { logApiError } from "../utils/logging.js";
import { parseRequestedVersion, parseSetActive } from "../utils/parsing.js";
import { serializeFaceModel } from "../utils/serialize.js";
import {
  ensureActiveForPerson,
  resolveVersion,
  setActiveModel,
} from "../services/modelService.js";
import {
  uploadBuffer,
  deleteFile,
  deleteManyFiles,
} from "../services/driveStorage.js";

const router = express.Router();

router.post(
  "/models/generate",
  requireAuth,
  upload.array("file"),
  async (req, res) => {
    const personName = (req.body.person_name || req.body.name || "").trim();
    const requestedVersion = parseRequestedVersion(req.body.version);
    const setActive = parseSetActive(req.body.set_active);
    const files = req.files || [];

    if (!personName) {
      return res.status(400).json({ detail: "Person name is required" });
    }
    if (Number.isNaN(requestedVersion)) {
      return res.status(400).json({ detail: "version must be a positive integer" });
    }
    if (files.length === 0) {
      return res.status(400).json({ detail: "No files uploaded" });
    }
    if (!INFERENCE_BASE_URL) {
      return res
        .status(500)
        .json({ detail: "INFERENCE_BASE_URL is not configured" });
    }

    let driveResult = null;
    try {
      const form = new FormData();
      files.forEach((file) => {
        form.append("file", file.buffer, {
          filename: file.originalname || "image.png",
          contentType: file.mimetype || "application/octet-stream",
        });
      });

      const response = await axios.post(`${INFERENCE_BASE_URL}/embedding`, form, {
        headers: form.getHeaders(),
        responseType: "arraybuffer",
        timeout: 120000,
      });

      const version = await resolveVersion(
        req.user.id,
        personName,
        requestedVersion
      );

      const existing = await FaceModel.findOne({
        owner_id: req.user.id,
        person_name: personName,
        version,
        is_deleted: false,
      }).lean();

      if (existing) {
        return res.status(409).json({
          detail: `Version already exists for ${personName}. Choose another version.`,
        });
      }

      const modelBuffer = Buffer.from(response.data);
      driveResult = await uploadBuffer({
        buffer: modelBuffer,
        filename: `${personName}-v${version}.safetensors`,
        mimeType: "application/octet-stream",
      });

      const createdModel = await FaceModel.create({
        name: `${personName} v${version}`,
        person_name: personName,
        version,
        is_active: false,
        drive_file_id: driveResult.drive_file_id,
        mime_type: driveResult.mime_type,
        size: driveResult.size,
        owner_id: req.user.id,
      });

      const activeModel = await FaceModel.findOne({
        owner_id: req.user.id,
        person_name: personName,
        is_active: true,
        is_deleted: false,
      }).lean();

      if (setActive || !activeModel) {
        await setActiveModel(req.user.id, personName, createdModel.id);
      }

      const refreshed = await FaceModel.findOne({
        id: createdModel.id,
      }).lean();

      return res.json(serializeFaceModel(refreshed || createdModel));
    } catch (err) {
      if (driveResult?.drive_file_id) {
        await deleteFile(driveResult.drive_file_id).catch(() => {});
      }
      logApiError("POST /models/generate", err);
      const detail = err.response?.data?.detail || err.message;
      return res.status(502).json({ detail: `Embedding service failed: ${detail}` });
    }
  }
);

router.post("/models/upload", requireAuth, upload.single("file"), async (req, res) => {
  const personName = (req.body.person_name || req.body.name || "").trim();
  const requestedVersion = parseRequestedVersion(req.body.version);
  const setActive = parseSetActive(req.body.set_active);
  const file = req.file;

  if (!personName) {
    return res.status(400).json({ detail: "Person name is required" });
  }
  if (Number.isNaN(requestedVersion)) {
    return res.status(400).json({ detail: "version must be a positive integer" });
  }
  if (!file) {
    return res.status(400).json({ detail: "No file uploaded" });
  }
  const filename = (file.originalname || "").toLowerCase();
  if (!filename.endsWith(".safetensor") && !filename.endsWith(".safetensors")) {
    return res.status(400).json({
      detail: "Invalid file type. Expected .safetensor or .safetensors",
    });
  }

  let driveResult = null;
  try {
    const version = await resolveVersion(
      req.user.id,
      personName,
      requestedVersion
    );

    const existing = await FaceModel.findOne({
      owner_id: req.user.id,
      person_name: personName,
      version,
      is_deleted: false,
    }).lean();

    if (existing) {
      return res.status(409).json({
        detail: `Version already exists for ${personName}. Choose another version.`,
      });
    }

    driveResult = await uploadBuffer({
      buffer: file.buffer,
      filename: `${personName}-v${version}.safetensors`,
      mimeType: file.mimetype || "application/octet-stream",
    });

    const createdModel = await FaceModel.create({
      name: `${personName} v${version}`,
      person_name: personName,
      version,
      is_active: false,
      drive_file_id: driveResult.drive_file_id,
      mime_type: driveResult.mime_type,
      size: driveResult.size,
      owner_id: req.user.id,
    });

    const activeModel = await FaceModel.findOne({
      owner_id: req.user.id,
      person_name: personName,
      is_active: true,
      is_deleted: false,
    }).lean();

    if (setActive || !activeModel) {
      await setActiveModel(req.user.id, personName, createdModel.id);
    }

    const refreshed = await FaceModel.findOne({
      id: createdModel.id,
    }).lean();

    return res.json(serializeFaceModel(refreshed || createdModel));
  } catch (err) {
    if (driveResult?.drive_file_id) {
      await deleteFile(driveResult.drive_file_id).catch(() => {});
    }
    logApiError("POST /models/upload", err);
    return res.status(500).json({ detail: "Model upload failed" });
  }
});

router.get("/models", requireAuth, async (req, res) => {
  const limit = Number(req.query.limit || 100);
  const models = await FaceModel.find({
    owner_id: req.user.id,
    is_deleted: false,
  })
    .sort({ person_name: 1, version: -1, id: -1 })
    .limit(limit)
    .lean();
  return res.json(models.map(serializeFaceModel));
});

router.put("/models/:id/activate", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ detail: "Invalid model id" });
  }

  const model = await FaceModel.findOne({
    id,
    owner_id: req.user.id,
    is_deleted: false,
  }).lean();
  if (!model) {
    return res.status(404).json({ detail: "Model not found" });
  }

  await setActiveModel(
    req.user.id,
    model.person_name || model.name,
    model.id
  );

  const updated = await FaceModel.findOne({
    id,
    owner_id: req.user.id,
    is_deleted: false,
  }).lean();

  return res.json(serializeFaceModel(updated));
});

router.delete("/models/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ detail: "Invalid model id" });
  }

  try {
    const model = await FaceModel.findOne({
      id,
      owner_id: req.user.id,
      is_deleted: false,
    }).lean();
    if (!model) {
      return res.status(404).json({ detail: "Model not found" });
    }

    const personName = model.person_name || model.name;
    const wasActive = Boolean(model.is_active);

    const updateResult = await FaceModel.updateOne(
      { id, owner_id: req.user.id, is_deleted: false },
      { $set: { is_deleted: true, is_active: false } }
    );

    const deletedCount = updateResult.modifiedCount || 0;

    if (deletedCount > 0 && wasActive) {
      await ensureActiveForPerson(req.user.id, personName);
    }

    if (deletedCount > 0) {
      await deleteFile(model.drive_file_id).catch((err) =>
        logApiError(`DELETE /models/:id drive ${model.drive_file_id}`, err)
      );
    }

    return res.json({ deleted: deletedCount });
  } catch (err) {
    logApiError("DELETE /models/:id", err);
    return res.status(500).json({ detail: "Model deletion failed" });
  }
});

router.delete("/models/person/:personName", requireAuth, async (req, res) => {
  const personName = decodeURIComponent(req.params.personName || "").trim();
  if (!personName) {
    return res.status(400).json({ detail: "personName is required" });
  }

  try {
    const toDelete = await FaceModel.find({
      owner_id: req.user.id,
      person_name: personName,
      is_deleted: false,
    })
      .select({ drive_file_id: 1 })
      .lean();

    const updateResult = await FaceModel.updateMany(
      {
        owner_id: req.user.id,
        person_name: personName,
        is_deleted: false,
      },
      { $set: { is_deleted: true, is_active: false } }
    );

    const deletedCount = updateResult.modifiedCount || 0;
    if (deletedCount === 0) {
      return res.status(404).json({ detail: "No models found for person" });
    }

    await deleteManyFiles(toDelete.map((m) => m.drive_file_id));

    return res.json({ deleted: deletedCount });
  } catch (err) {
    logApiError("DELETE /models/person/:personName", err);
    return res.status(500).json({ detail: "Model deletion failed" });
  }
});

export default router;
