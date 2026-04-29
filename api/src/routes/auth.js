import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../db.js";
import {
  ACCESS_TOKEN_EXPIRE_MINUTES,
  JWT_ALGORITHM,
  JWT_SECRET,
} from "../config.js";
import { serializeUser } from "../utils/serialize.js";

const router = express.Router();

function createAccessToken(email) {
  return jwt.sign({ sub: email }, JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: `${ACCESS_TOKEN_EXPIRE_MINUTES}m`,
  });
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

export default router;
