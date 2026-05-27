import express from "express";
import axios from "axios";

const router = express.Router();

const CIVITAI_BASE_URL = "https://civitai.com/api/v1";
const CIVITAI_HOST_RE = /(^|\.)civitai\.com$/i;

function getCivitaiHeaders(req) {
  return req.headers.authorization
    ? { Authorization: req.headers.authorization }
    : undefined;
}

async function proxyCivitaiGet(path, req, res, fallbackDetail) {
  try {
    const response = await axios.get(`${CIVITAI_BASE_URL}${path}`, {
      params: req.query,
      headers: getCivitaiHeaders(req),
    });
    return res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    const data = err.response?.data || { detail: fallbackDetail };
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
    const status = err.response?.status || 500;
    return res
      .status(status)
      .json({ detail: "Failed to fetch Civitai image." });
  }
});

export default router;
