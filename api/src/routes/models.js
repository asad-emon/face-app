import express from "express";
import axios from "axios";
import FormData from "form-data";
import { FaceModel, sequelize } from "../db.js";
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

      const model = await sequelize.transaction(async (transaction) => {
        const version = await resolveVersion(
          req.user.id,
          personName,
          requestedVersion,
          transaction
        );

        const existing = await FaceModel.findOne({
          where: {
            owner_id: req.user.id,
            person_name: personName,
            version,
            is_deleted: false,
          },
          transaction,
        });

        if (existing) {
          throw new Error("VERSION_CONFLICT");
        }

        const createdModel = await FaceModel.create(
          {
            name: `${personName} v${version}`,
            person_name: personName,
            version,
            is_active: false,
            data: Buffer.from(response.data),
            owner_id: req.user.id,
          },
          { transaction }
        );

        const activeModel = await FaceModel.findOne({
          where: {
            owner_id: req.user.id,
            person_name: personName,
            is_active: true,
            is_deleted: false,
          },
          transaction,
        });

        if (setActive || !activeModel) {
          await setActiveModel(
            req.user.id,
            personName,
            createdModel.id,
            transaction
          );
        }

        return createdModel;
      });

      return res.json(serializeFaceModel(model));
    } catch (err) {
      if (err.message === "VERSION_CONFLICT") {
        return res.status(409).json({
          detail: `Version already exists for ${personName}. Choose another version.`,
        });
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

  try {
    const model = await sequelize.transaction(async (transaction) => {
      const version = await resolveVersion(
        req.user.id,
        personName,
        requestedVersion,
        transaction
      );

      const existing = await FaceModel.findOne({
        where: {
          owner_id: req.user.id,
          person_name: personName,
          version,
          is_deleted: false,
        },
        transaction,
      });

      if (existing) {
        throw new Error("VERSION_CONFLICT");
      }

      const createdModel = await FaceModel.create(
        {
          name: `${personName} v${version}`,
          person_name: personName,
          version,
          is_active: false,
          data: file.buffer,
          owner_id: req.user.id,
        },
        { transaction }
      );

      const activeModel = await FaceModel.findOne({
        where: {
          owner_id: req.user.id,
          person_name: personName,
          is_active: true,
          is_deleted: false,
        },
        transaction,
      });

      if (setActive || !activeModel) {
        await setActiveModel(req.user.id, personName, createdModel.id, transaction);
      }

      return createdModel;
    });

    return res.json(serializeFaceModel(model));
  } catch (err) {
    if (err.message === "VERSION_CONFLICT") {
      return res.status(409).json({
        detail: `Version already exists for ${personName}. Choose another version.`,
      });
    }
    logApiError("POST /models/upload", err);
    return res.status(500).json({ detail: "Model upload failed" });
  }
});

router.get("/models", requireAuth, async (req, res) => {
  const limit = Number(req.query.limit || 100);
  const models = await FaceModel.findAll({
    where: { owner_id: req.user.id, is_deleted: false },
    order: [
      ["person_name", "ASC"],
      ["version", "DESC"],
      ["id", "DESC"],
    ],
    limit,
  });
  return res.json(models.map(serializeFaceModel));
});

router.put("/models/:id/activate", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ detail: "Invalid model id" });
  }

  const model = await FaceModel.findOne({
    where: { id, owner_id: req.user.id, is_deleted: false },
  });
  if (!model) {
    return res.status(404).json({ detail: "Model not found" });
  }

  await sequelize.transaction(async (transaction) => {
    await setActiveModel(
      req.user.id,
      model.person_name || model.name,
      model.id,
      transaction
    );
  });

  const updated = await FaceModel.findOne({
    where: { id, owner_id: req.user.id, is_deleted: false },
  });

  return res.json(serializeFaceModel(updated));
});

router.delete("/models/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ detail: "Invalid model id" });
  }

  try {
    const result = await sequelize.transaction(async (transaction) => {
      const model = await FaceModel.findOne({
        where: { id, owner_id: req.user.id, is_deleted: false },
        transaction,
      });
      if (!model) {
        return null;
      }

      const personName = model.person_name || model.name;
      const wasActive = Boolean(model.is_active);

      const deleted = await FaceModel.update(
        { is_deleted: true, is_active: false },
        {
          where: { id, owner_id: req.user.id, is_deleted: false },
          transaction,
        }
      );

      if (deleted[0] > 0 && wasActive) {
        await ensureActiveForPerson(req.user.id, personName, transaction);
      }

      return { deleted: deleted[0] };
    });

    if (!result) {
      return res.status(404).json({ detail: "Model not found" });
    }

    return res.json(result);
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
    const deleted = await FaceModel.update(
      { is_deleted: true, is_active: false },
      {
        where: {
          owner_id: req.user.id,
          person_name: personName,
          is_deleted: false,
        },
      }
    );

    if (deleted[0] === 0) {
      return res.status(404).json({ detail: "No models found for person" });
    }

    return res.json({ deleted: deleted[0] });
  } catch (err) {
    logApiError("DELETE /models/person/:personName", err);
    return res.status(500).json({ detail: "Model deletion failed" });
  }
});

export default router;
