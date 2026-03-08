import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import axios from "axios";
import FormData from "form-data";
import { Op } from "sequelize";
import {
  initDb,
  sequelize,
  User,
  FaceModel,
  InputImage,
  GeneratedImage,
} from "./db.js";

dotenv.config();

const PORT = Number(process.env.PORT || 8080);
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const JWT_ALGORITHM = process.env.JWT_ALGORITHM || "HS256";
const ACCESS_TOKEN_EXPIRE_MINUTES = Number(
  process.env.ACCESS_TOKEN_EXPIRE_MINUTES || 300
);
const INFERENCE_BASE_URL = process.env.INFERENCE_BASE_URL || "";

const app = express();

const origins = [
  process.env.CLIENT_ORIGIN,
];

app.use(
  cors({
    origin: origins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function logApiError(context, err) {
  const detail = err?.response?.data?.detail || err?.response?.data || err?.message || err;
  console.error(`[ERROR] ${context}:`, detail);
  if (err?.stack) {
    console.error(err.stack);
  }
}

function createAccessToken(email) {
  return jwt.sign({ sub: email }, JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: `${ACCESS_TOKEN_EXPIRE_MINUTES}m`,
  });
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ detail: "Could not validate credentials" });
    }
    const payload = jwt.verify(token, JWT_SECRET, {
      algorithms: [JWT_ALGORITHM],
    });
    const email = payload.sub;
    if (!email) {
      return res.status(401).json({ detail: "Could not validate credentials" });
    }
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(401).json({ detail: "Could not validate credentials" });
    }
    req.user = user;
    return next();
  } catch (err) {
    logApiError("requireAuth", err);
    return res.status(401).json({ detail: "Could not validate credentials" });
  }
}

function serializeUser(user) {
  return { id: user.id, email: user.email };
}

function serializeFaceModel(model) {
  const personName = model.person_name || model.name;
  return {
    id: model.id,
    name: model.name,
    person_name: personName,
    version: model.version || 1,
    is_active: Boolean(model.is_active),
    is_deleted: Boolean(model.is_deleted),
    owner_id: model.owner_id,
  };
}

function serializeInputImage(image) {
  return { id: image.id, filename: image.filename, owner_id: image.owner_id };
}

function serializeGeneratedImage(image) {
  return {
    id: image.id,
    owner_id: image.owner_id,
    data: image.data ? Buffer.from(image.data).toString('base64') : null,
    input_image_id: image.input_image_id,
    face_model_id: image.face_model_id,
  };
}

function parseRequestedVersion(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return null;
  }
  const version = Number(rawValue);
  if (!Number.isInteger(version) || version <= 0) {
    return NaN;
  }
  return version;
}

function parseSetActive(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return true;
  }
  if (typeof rawValue === "boolean") {
    return rawValue;
  }
  const value = String(rawValue).toLowerCase();
  if (value === "true" || value === "1" || value === "yes") {
    return true;
  }
  if (value === "false" || value === "0" || value === "no") {
    return false;
  }
  return true;
}

function parseBoolean(rawValue, defaultValue = false) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return defaultValue;
  }
  if (typeof rawValue === "boolean") {
    return rawValue;
  }
  const value = String(rawValue).toLowerCase();
  if (value === "true" || value === "1" || value === "yes" || value === "on") {
    return true;
  }
  if (value === "false" || value === "0" || value === "no" || value === "off") {
    return false;
  }
  return defaultValue;
}

async function resolveVersion(ownerId, personName, requestedVersion, transaction) {
  if (requestedVersion !== null) {
    return requestedVersion;
  }

  const latestModel = await FaceModel.findOne({
    where: {
      owner_id: ownerId,
      person_name: personName,
      is_deleted: false,
    },
    order: [["version", "DESC"]],
    transaction,
  });
  const latestVersion = latestModel?.version || 0;
  return latestVersion + 1;
}

async function setActiveModel(ownerId, personName, modelId, transaction) {
  await FaceModel.update(
    { is_active: false },
    {
      where: {
        owner_id: ownerId,
        person_name: personName,
        is_deleted: false,
      },
      transaction,
    }
  );

  await FaceModel.update(
    { is_active: true },
    {
      where: {
        id: modelId,
        owner_id: ownerId,
        is_deleted: false,
      },
      transaction,
    }
  );
}

async function ensureActiveForPerson(ownerId, personName, transaction) {
  const activeModel = await FaceModel.findOne({
    where: {
      owner_id: ownerId,
      person_name: personName,
      is_active: true,
      is_deleted: false,
    },
    transaction,
  });
  if (activeModel) {
    return;
  }

  const fallbackModel = await FaceModel.findOne({
    where: {
      owner_id: ownerId,
      person_name: personName,
      is_deleted: false,
    },
    order: [["version", "DESC"], ["id", "DESC"]],
    transaction,
  });
  if (!fallbackModel) {
    return;
  }

  await FaceModel.update(
    { is_active: true },
    {
      where: {
        id: fallbackModel.id,
        owner_id: ownerId,
      },
      transaction,
    }
  );
}

app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/token", async (req, res) => {
  const username = req.body.username || req.body.email;
  const password = req.body.password;
  if (!username || !password) {
    return res.status(400).json({ detail: "Missing username or password" });
  }

  const user = await User.findOne({ where: { email: username } });
  if (!user) {
    return res
      .status(401)
      .json({ detail: "Incorrect username or password" });
  }

  const valid = await bcrypt.compare(password, user.hashed_password);
  if (!valid) {
    return res
      .status(401)
      .json({ detail: "Incorrect username or password" });
  }

  const accessToken = createAccessToken(user.email);
  return res.json({ access_token: accessToken, token_type: "bearer" });
});

app.post("/users", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ detail: "Email and password required" });
  }
  const existing = await User.findOne({ where: { email } });
  if (existing) {
    return res.status(400).json({ detail: "Email already registered" });
  }
  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({ email, hashed_password: hashed });
  return res.json(serializeUser(user));
});

app.post(
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

      const response = await axios.post(
        `${INFERENCE_BASE_URL}/embedding`,
        form,
        {
          headers: form.getHeaders(),
          responseType: "arraybuffer",
          timeout: 120000,
        }
      );

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

app.post("/models/upload", requireAuth, upload.single("file"), async (req, res) => {
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
    return res.status(400).json({ detail: "Invalid file type. Expected .safetensor or .safetensors" });
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

app.get("/models", requireAuth, async (req, res) => {
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

app.put("/models/:id/activate", requireAuth, async (req, res) => {
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

app.delete("/models/:id", requireAuth, async (req, res) => {
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

app.delete("/models/person/:personName", requireAuth, async (req, res) => {
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

app.post("/images", requireAuth, upload.single("file"), async (req, res) => {
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

app.get("/images/generated", requireAuth, async (req, res) => {
  const skip = Number(req.query.skip || 0);
  const limit = Number(req.query.limit || 100);
  const images = await GeneratedImage.findAll({
    where: { owner_id: req.user.id },
    offset: skip,
    limit,
  });
  return res.json(images.map(serializeGeneratedImage));
});

app.delete("/images/generated/:id", requireAuth, async (req, res) => {
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

app.delete("/images/generated", requireAuth, async (req, res) => {
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

app.post("/swap", requireAuth, async (req, res) => {
  const modelId = Number(req.query.model_id || req.body.model_id);
  const imageId = Number(req.query.image_id || req.body.image_id);
  const enableRestore = parseBoolean(
    req.query.enable_restore ?? req.body.enable_restore,
    false
  );

  if (!modelId || !imageId) {
    return res
      .status(400)
      .json({ detail: "model_id and image_id are required" });
  }

  const model = await FaceModel.findOne({
    where: { id: modelId, owner_id: req.user.id, is_deleted: false },
  });
  const image = await InputImage.findOne({
    where: { id: imageId, owner_id: req.user.id },
  });

  if (!model || !image) {
    return res.status(404).json({ detail: "Model or image not found" });
  }

  if (!INFERENCE_BASE_URL) {
    return res
      .status(500)
      .json({ detail: "INFERENCE_BASE_URL is not configured" });
  }

  try {
    const form = new FormData();
    form.append("model_id", String(modelId));
    form.append("enable_restore", enableRestore ? "1" : "0");
    form.append("model_file", model.data, {
      filename: "model.safetensors",
      contentType: "application/octet-stream",
    });
    form.append("target_image", image.data, {
      filename: image.filename || "target.png",
      contentType: "image/png",
    });

    const response = await axios.post(
      `${INFERENCE_BASE_URL}/swap-remote`,
      form,
      {
        headers: form.getHeaders(),
        responseType: "arraybuffer",
        timeout: 120000,
      }
    );

    const outputBytes = Buffer.from(response.data);

    await GeneratedImage.create({
      data: outputBytes,
      owner_id: req.user.id,
      input_image_id: imageId,
      face_model_id: modelId,
    });

    return res.json({
      result: `data:image/jpeg;base64,${outputBytes.toString("base64")}`,
    });
  } catch (err) {
    logApiError("POST /swap", err);
    const detail = err.response?.data?.detail || err.message;
    return res.status(502).json({ detail: `Swap service failed: ${detail}` });
  }
});

async function start() {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`API server listening on ${PORT}`);
    });
  } catch (err) {
    logApiError("start", err);
    process.exit(1);
  }
}

start();
