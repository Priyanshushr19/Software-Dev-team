import jwt from "jsonwebtoken";

export const AUTH_COOKIE_NAME = "aidev_session";

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV !== "production") {
    return "aidev-local-dev-secret";
  }
  if (!secret) {
    throw new Error("JWT_SECRET is required for authentication");
  }
  return secret;
}

export function createSessionToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
    },
    getJwtSecret(),
    {
      expiresIn: "7d",
      issuer: "ai-dev-team",
    }
  );
}

export function verifySessionToken(token) {
  return jwt.verify(token, getJwtSecret(), {
    issuer: "ai-dev-team",
  });
}

export function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export function parseCookieHeader(cookieHeader = "") {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, pair) => {
      const separatorIndex = pair.indexOf("=");
      if (separatorIndex === -1) return cookies;
      const key = pair.slice(0, separatorIndex);
      const value = decodeURIComponent(pair.slice(separatorIndex + 1));
      cookies[key] = value;
      return cookies;
    }, {});
}
