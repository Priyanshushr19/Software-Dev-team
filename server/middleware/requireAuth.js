import { AUTH_COOKIE_NAME, parseCookieHeader, verifySessionToken } from "../auth/session.js";
import { findUserById, sanitizeUser } from "../services/authStore.js";

async function resolveUserFromToken(token) {
  if (!token) return null;

  try {
    const payload = verifySessionToken(token);
    const user = await findUserById(payload.sub);
    return user ? sanitizeUser(user) : null;
  } catch {
    return null;
  }
}

export async function attachAuthUser(req, res, next) {
  const token =
    req.cookies?.[AUTH_COOKIE_NAME] ||
    parseCookieHeader(req.headers.cookie || "")[AUTH_COOKIE_NAME];

  req.authUser = await resolveUserFromToken(token);
  next();
}

export async function requireAuth(req, res, next) {
  await attachAuthUser(req, res, async () => {
    if (!req.authUser) {
      return res.status(401).json({ error: "Authentication required" });
    }
    next();
  });
}

export async function authenticateWebSocketRequest(req) {
  const token = parseCookieHeader(req.headers.cookie || "")[AUTH_COOKIE_NAME];
  return resolveUserFromToken(token);
}
