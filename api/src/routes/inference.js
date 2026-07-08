import express from "express";
import axios from "axios";
import { INFERENCE_BASE_URL } from "../config.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

const STATUS_TIMEOUT_MS = 8000;

// Lightweight readiness probe. Returns whether the inference service is
// reachable and whether its models are already loaded (warm) or still cold.
router.get("/inference/status", requireAuth, async (req, res) => {
  if (!INFERENCE_BASE_URL) {
    return res.json({ status: "unconfigured", models_loaded: false });
  }
  try {
    const response = await axios.get(`${INFERENCE_BASE_URL}/health`, {
      timeout: STATUS_TIMEOUT_MS,
    });
    const modelsLoaded = Boolean(response.data?.models_loaded);
    return res.json({ status: "online", models_loaded: modelsLoaded });
  } catch (err) {
    // Unreachable within the probe window — likely asleep/cold-starting.
    return res.json({ status: "offline", models_loaded: false });
  }
});

// Fire a request at the inference service to boot a sleeping Hugging Face Space,
// then return immediately. The client polls /inference/status until it is online.
router.post("/inference/wake", requireAuth, async (req, res) => {
  if (!INFERENCE_BASE_URL) {
    return res.status(400).json({ detail: "INFERENCE_BASE_URL is not configured" });
  }
  // Fire-and-forget: the boot can take a while; we don't block the response on it.
  axios
    .get(`${INFERENCE_BASE_URL}/health`, { timeout: 120000 })
    .catch(() => {
      /* boot request errors are expected while the Space is starting */
    });
  return res.status(202).json({ status: "waking" });
});

export default router;
