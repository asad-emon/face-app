import express from "express";
import axios from "axios";

const router = express.Router();

const CIVITAI_BASE_URL = "https://civitai.com/api/v1";

router.get("/civitai/models", async (req, res) => {
  try {
    const response = await axios.get(`${CIVITAI_BASE_URL}/models`, {
      params: req.query,
      headers: req.headers.authorization
        ? { Authorization: req.headers.authorization }
        : undefined,
    });
    return res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    const data =
      err.response?.data || { detail: "Failed to fetch Civitai models." };
    return res.status(status).json(data);
  }
});

export default router;
