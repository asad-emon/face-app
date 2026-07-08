import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { parseBoolean } from "../utils/parsing.js";
import { serializeUserSettings } from "../utils/serialize.js";
import { getUserSettings } from "../services/settingsService.js";
import { logApiError } from "../utils/logging.js";

const router = express.Router();

router.get("/settings", requireAuth, async (req, res) => {
  try {
    const settings = await getUserSettings(req.user.id);
    return res.json(serializeUserSettings(settings));
  } catch (err) {
    logApiError("GET /settings", err);
    return res.status(500).json({ detail: "Failed to load settings" });
  }
});

router.patch("/settings", requireAuth, async (req, res) => {
  try {
    const settings = await getUserSettings(req.user.id);
    if (req.body?.save_input_files !== undefined) {
      settings.save_input_files = parseBoolean(
        req.body.save_input_files,
        settings.save_input_files
      );
    }
    if (req.body?.expression_restore_enabled !== undefined) {
      settings.expression_restore_enabled = parseBoolean(
        req.body.expression_restore_enabled,
        settings.expression_restore_enabled
      );
    }
    await settings.save();
    return res.json(serializeUserSettings(settings));
  } catch (err) {
    logApiError("PATCH /settings", err);
    return res.status(500).json({ detail: "Failed to update settings" });
  }
});

export default router;
