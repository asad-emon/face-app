import jwt from "jsonwebtoken";
import { User } from "../db.js";
import { INFERENCE_CALLBACK_TOKEN, JWT_ALGORITHM, JWT_SECRET } from "../config.js";
import { logApiError } from "../utils/logging.js";

export async function requireAuth(req, res, next) {
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
    const user = await User.findOne({ email });
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

export function requireInferenceAuth(req, res, next) {
  if (!INFERENCE_CALLBACK_TOKEN) {
    return next();
  }
  const token = req.headers["x-inference-token"];
  if (token !== INFERENCE_CALLBACK_TOKEN) {
    return res.status(401).json({ detail: "Unauthorized" });
  }
  return next();
}
