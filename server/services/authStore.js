import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const DATA_DIR = path.basename(process.cwd()) === "server" 
  ? path.join(process.cwd(), "data") 
  : path.join(process.cwd(), "server", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

async function ensureUsersFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(USERS_FILE);
  } catch {
    await fs.writeFile(USERS_FILE, "[]\n", "utf-8");
  }
}

async function readUsers() {
  await ensureUsersFile();
  const raw = await fs.readFile(USERS_FILE, "utf-8");
  const users = JSON.parse(raw);
  return Array.isArray(users) ? users : [];
}

async function writeUsers(users) {
  await ensureUsersFile();
  await fs.writeFile(USERS_FILE, `${JSON.stringify(users, null, 2)}\n`, "utf-8");
}

export function sanitizeUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    provider: user.provider,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
  };
}

export async function findUserByEmail(email) {
  const users = await readUsers();
  return users.find((user) => user.email.toLowerCase() === email.toLowerCase()) || null;
}

export async function findUserById(id) {
  const users = await readUsers();
  return users.find((user) => user.id === id) || null;
}

export async function createLocalUser({ email, name, passwordHash }) {
  const users = await readUsers();

  const user = {
    id: crypto.randomUUID(),
    email: email.toLowerCase(),
    name,
    provider: "local",
    passwordHash,
    googleSub: null,
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };

  users.push(user);
  await writeUsers(users);
  return user;
}

export async function upsertGoogleUser({ email, name, googleSub }) {
  const users = await readUsers();
  const normalizedEmail = email.toLowerCase();
  const now = new Date().toISOString();

  let existing = users.find(
    (user) => user.googleSub === googleSub || user.email.toLowerCase() === normalizedEmail
  );

  if (existing) {
    existing.email = normalizedEmail;
    existing.name = name || existing.name || normalizedEmail.split("@")[0];
    existing.provider = existing.provider === "local" ? "local+google" : "google";
    existing.googleSub = googleSub;
    existing.lastLoginAt = now;
    await writeUsers(users);
    return existing;
  }

  const user = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    name: name || normalizedEmail.split("@")[0],
    provider: "google",
    passwordHash: null,
    googleSub,
    createdAt: now,
    lastLoginAt: now,
  };

  users.push(user);
  await writeUsers(users);
  return user;
}

export async function updateLastLogin(userId) {
  const users = await readUsers();
  const user = users.find((entry) => entry.id === userId);

  if (!user) return null;

  user.lastLoginAt = new Date().toISOString();
  await writeUsers(users);
  return user;
}
