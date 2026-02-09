import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import axios from "axios";
import FormData from "form-data";
import { initDb, User, FaceModel, InputImage, GeneratedImage } from "./db.js";

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
  "http://localhost:3000",
  "https://face-app-93d8.onrender.com",
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
    return res.status(401).json({ detail: "Could not validate credentials" });
  }
}

function serializeUser(user) {
  return { id: user.id, email: user.email };
}

function serializeFaceModel(model) {
  return { id: model.id, name: model.name, owner_id: model.owner_id };
}

function serializeInputImage(image) {
  return { id: image.id, filename: image.filename, owner_id: image.owner_id };
}

function serializeGeneratedImage(image) {
  return {
    id: image.id,
    owner_id: image.owner_id,
    input_image_id: image.input_image_id,
    face_model_id: image.face_model_id,
  };
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
    const name = (req.body.name || "").trim();
    const files = req.files || [];

    if (!name) {
      return res.status(400).json({ detail: "Model name is required" });
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

      const model = await FaceModel.create({
        name,
        data: Buffer.from(response.data),
        owner_id: req.user.id,
      });

      return res.json(serializeFaceModel(model));
    } catch (err) {
      const detail = err.response?.data?.detail || err.message;
      return res.status(502).json({ detail: `Embedding service failed: ${detail}` });
    }
  }
);

app.get("/models", requireAuth, async (req, res) => {
  const limit = Number(req.query.limit || 100);
  const models = await FaceModel.findAll({
    where: { owner_id: req.user.id },
    limit,
  });
  return res.json(models.map(serializeFaceModel));
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

app.post("/swap", requireAuth, async (req, res) => {
  const modelId = Number(req.query.model_id || req.body.model_id);
  const imageId = Number(req.query.image_id || req.body.image_id);

  if (!modelId || !imageId) {
    return res
      .status(400)
      .json({ detail: "model_id and image_id are required" });
  }

  const model = await FaceModel.findOne({
    where: { id: modelId, owner_id: req.user.id },
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
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

start();
