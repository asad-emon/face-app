import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { google } from "googleapis";
import { User } from "../db.js";
import {
  ACCESS_TOKEN_EXPIRE_MINUTES,
  API_BASE_URL,
  CLIENT_AUTH_REDIRECT_URL,
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
  GOOGLE_OAUTH_REDIRECT_URI,
  JWT_ALGORITHM,
  JWT_SECRET,
} from "../config.js";
import { serializeUser } from "../utils/serialize.js";

const router = express.Router();
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

function createAccessToken(email) {
  return jwt.sign({ sub: email }, JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: `${ACCESS_TOKEN_EXPIRE_MINUTES}m`,
  });
}

function getGoogleRedirectUri(req) {
  if (GOOGLE_OAUTH_REDIRECT_URI) {
    return GOOGLE_OAUTH_REDIRECT_URI;
  }
  if (API_BASE_URL) {
    return `${API_BASE_URL.replace(/\/$/, "")}/auth/google/callback`;
  }
  return `${req.protocol}://${req.get("host")}/auth/google/callback`;
}

function createOAuthClient(req) {
  if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new Error(
      "Google OAuth not configured: GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are required"
    );
  }
  return new google.auth.OAuth2(
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
    getGoogleRedirectUri(req)
  );
}

function createOAuthState() {
  return jwt.sign({ purpose: "google_oauth" }, JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: "10m",
  });
}

function verifyOAuthState(state) {
  const payload = jwt.verify(state, JWT_SECRET, {
    algorithms: [JWT_ALGORITHM],
  });
  return payload?.purpose === "google_oauth";
}

function redirectToClient(res, params) {
  const url = new URL(CLIENT_AUTH_REDIRECT_URL);
  const hashParams = new URLSearchParams(params);
  url.hash = hashParams.toString();
  return res.redirect(url.toString());
}

router.post("/token", async (req, res) => {
  const username = req.body.username || req.body.email;
  const password = req.body.password;
  if (!username || !password) {
    return res.status(400).json({ detail: "Missing username or password" });
  }

  const user = await User.findOne({ email: username });
  if (!user) {
    return res
      .status(401)
      .json({ detail: "Incorrect username or password" });
  }
  if (!user.hashed_password) {
    return res
      .status(401)
      .json({ detail: "Use Google sign-in for this account" });
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

router.post("/users", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ detail: "Email and password required" });
  }
  const existing = await User.findOne({ email });
  if (existing) {
    return res.status(400).json({ detail: "Email already registered" });
  }
  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({ email, hashed_password: hashed });
  return res.json(serializeUser(user));
});

router.get("/auth/google/start", (req, res) => {
  try {
    const oauth2Client = createOAuthClient(req);
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: GOOGLE_SCOPES,
      state: createOAuthState(),
    });
    return res.redirect(url);
  } catch (err) {
    return redirectToClient(res, { auth_error: err.message });
  }
});

router.get("/auth/google/callback", async (req, res) => {
  const { code, state, error } = req.query || {};
  if (error) {
    return redirectToClient(res, { auth_error: String(error) });
  }
  if (!code || !state) {
    return redirectToClient(res, { auth_error: "Missing Google OAuth callback parameters" });
  }

  try {
    if (!verifyOAuthState(String(state))) {
      return redirectToClient(res, { auth_error: "Invalid Google OAuth state" });
    }

    const oauth2Client = createOAuthClient(req);
    const { tokens } = await oauth2Client.getToken(String(code));
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const profileResponse = await oauth2.userinfo.get();
    const profile = profileResponse.data || {};
    const email = String(profile.email || "").trim().toLowerCase();
    const googleId = profile.id ? String(profile.id) : "";

    if (!email || !googleId) {
      return redirectToClient(res, { auth_error: "Google account did not return an email" });
    }

    let user = await User.findOne({ $or: [{ email }, { google_id: googleId }] });
    if (!user) {
      user = new User({ email });
    }

    user.email = user.email || email;
    user.google_id = googleId;
    user.google_name = profile.name || "";
    user.google_picture = profile.picture || "";
    if (tokens.refresh_token) {
      user.google_refresh_token = tokens.refresh_token;
    }
    if (!user.google_refresh_token) {
      return redirectToClient(res, {
        auth_error: "Google did not provide a refresh token. Try signing in again.",
      });
    }
    await user.save();

    const accessToken = createAccessToken(user.email);
    return redirectToClient(res, {
      token: accessToken,
      token_type: "bearer",
    });
  } catch (err) {
    return redirectToClient(res, { auth_error: err.message || "Google sign-in failed" });
  }
});

export default router;
