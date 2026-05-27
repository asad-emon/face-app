import express from "express";
import axios from "axios";

const router = express.Router();

const CIVITAI_BASE_URL = "https://civitai.com/api/v1";
const CIVITAI_HOST_RE = /(^|\.)civitai\.com$/i;

function getCivitaiHeaders(req) {
  const rawAuth = String(req.headers.authorization || "").trim();
  const token = rawAuth.replace(/^(Bearer\s+)+/i, "").trim();
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

function getCivitaiErrorData(err, fallbackDetail) {
  const data = err.response?.data;
  const upstreamMessage = String(data?.detail || data?.message || data?.error || "");

  if (upstreamMessage.includes("Cannot read properties of undefined") && upstreamMessage.includes("id")) {
    return {
      status: 401,
      data: {
        detail: "Civitai rejected the API token. Save a valid raw Civitai API key, or clear the token for public content.",
      },
    };
  }

  return {
    status: err.response?.status || 500,
    data: data || { detail: fallbackDetail },
  };
}

async function proxyCivitaiGet(path, req, res, fallbackDetail) {
  try {
    const response = await axios.get(`${CIVITAI_BASE_URL}${path}`, {
      params: req.query,
      headers: getCivitaiHeaders(req),
    });
    return res.status(response.status).json(response.data);
  } catch (err) {
    const { status, data } = getCivitaiErrorData(err, fallbackDetail);
    return res.status(status).json(data);
  }
}

function isAllowedCivitaiImageUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && CIVITAI_HOST_RE.test(url.hostname);
  } catch (_err) {
    return false;
  }
}

router.get("/civitai/models", async (req, res) => {
  return proxyCivitaiGet(
    "/models",
    req,
    res,
    "Failed to fetch Civitai models."
  );
});

router.get("/civitai/images", async (req, res) => {
  return proxyCivitaiGet(
    "/images",
    req,
    res,
    "Failed to fetch Civitai images."
  );
});

router.get("/civitai/image", async (req, res) => {
  const imageUrl = String(req.query.url || "");
  if (!isAllowedCivitaiImageUrl(imageUrl)) {
    return res.status(400).json({ detail: "Invalid Civitai image URL." });
  }

  try {
    const response = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      headers: getCivitaiHeaders(req),
    });
    const contentType = response.headers["content-type"] || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(response.status).send(Buffer.from(response.data));
  } catch (err) {
    const { status, data } = getCivitaiErrorData(
      err,
      "Failed to fetch Civitai image."
    );
    return res.status(status).json(data);
  }
});

export default router;
