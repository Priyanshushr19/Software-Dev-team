import { Router } from "express";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import {
  createSessionToken,
  clearAuthCookie,
  setAuthCookie,
} from "../auth/session.js";
import {
  createLocalUser,
  findUserByEmail,
  sanitizeUser,
  upsertGoogleUser,
  updateLastLogin,
} from "../services/authStore.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

function getGoogleClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return null;
  }
  return new OAuth2Client(clientId);
}

router.get("/config", (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({
    user: req.authUser,
  });
});

router.post("/register", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const name = String(req.body?.name || "").trim();

    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email, and password are required" });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await createLocalUser({ email, name, passwordHash });
    const token = createSessionToken(user);
    setAuthCookie(res, token);

    res.status(201).json({
      user: sanitizeUser(user),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const user = await findUserByEmail(email);
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const freshUser = await updateLastLogin(user.id);
    const token = createSessionToken(freshUser || user);
    setAuthCookie(res, token);

    res.json({
      user: sanitizeUser(freshUser || user),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/google", async (req, res) => {
  try {
    const credential = String(req.body?.credential || "");
    if (!credential) {
      return res.status(400).json({ error: "Google credential is required" });
    }

    const client = getGoogleClient();
    if (!client) {
      return res.status(503).json({ error: "Google sign-in is not configured on the server" });
    }

    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    if (!payload?.email || !payload?.sub) {
      return res.status(401).json({ error: "Invalid Google account payload" });
    }

    const user = await upsertGoogleUser({
      email: payload.email,
      name: payload.name || payload.email.split("@")[0],
      googleSub: payload.sub,
    });

    const token = createSessionToken(user);
    setAuthCookie(res, token);

    res.json({
      user: sanitizeUser(user),
    });
  } catch (error) {
    res.status(401).json({ error: error.message || "Google sign-in failed" });
  }
});

router.post("/logout", (req, res) => {
  clearAuthCookie(res);
  res.json({ success: true });
});

export default router;
