import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.basename(process.cwd()) === "server" 
  ? path.join(process.cwd(), "data") 
  : path.join(process.cwd(), "server", "data");
const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");

async function ensureProjectsFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(PROJECTS_FILE);
  } catch {
    await fs.writeFile(PROJECTS_FILE, "[]\n", "utf-8");
  }
}

export async function readProjects() {
  await ensureProjectsFile();
  try {
    const raw = await fs.readFile(PROJECTS_FILE, "utf-8");
    const projects = JSON.parse(raw);
    return Array.isArray(projects) ? projects : [];
  } catch (err) {
    console.error("Error reading projects:", err);
    return [];
  }
}

export async function writeProjects(projects) {
  await ensureProjectsFile();
  await fs.writeFile(PROJECTS_FILE, `${JSON.stringify(projects, null, 2)}\n`, "utf-8");
}

export function deriveProjectName(requirement, fallbackName = null) {
  if (fallbackName && typeof fallbackName === "string" && fallbackName.trim().length > 0) {
    return fallbackName.trim();
  }
  if (!requirement || typeof requirement !== "string") {
    return "Untitled Project";
  }
  const clean = requirement.trim().replace(/^build\s+(a|an)?\s*/i, "").replace(/^create\s+(a|an)?\s*/i, "");
  const firstSentence = clean.split(/[.\n]/)[0].trim();
  if (firstSentence.length <= 40) {
    return firstSentence.charAt(0).toUpperCase() + firstSentence.slice(1);
  }
  const words = firstSentence.split(/\s+/).slice(0, 5).join(" ");
  return (words.charAt(0).toUpperCase() + words.slice(1)).replace(/[,;:]$/, "");
}

export async function findProjectById(id) {
  if (!id) return null;
  const projects = await readProjects();
  return projects.find((p) => p.id === id) || null;
}

export async function findProjectsByUserId(userId) {
  if (!userId) return [];
  const projects = await readProjects();
  return projects
    .filter((p) => p.userId && p.userId === userId)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

export async function createProjectRecord({
  id,
  userId,
  requirement,
  name,
  tokenBudget = 2.0,
  projectType = "full_stack",
  technologyConstraints = {},
  sandboxId = null,
}) {
  const projects = await readProjects();
  const now = new Date().toISOString();

  const record = {
    id,
    userId,
    name: name || deriveProjectName(requirement),
    requirement: requirement || "",
    tokenBudget: Number(tokenBudget) || 2.0,
    status: "running",
    currentPhase: "pm",
    currentTask: null,
    sandboxId,
    projectType,
    technologyConstraints: technologyConstraints || {},
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    error: null,
  };

  projects.push(record);
  await writeProjects(projects);
  return record;
}

export async function updateProjectRecord(id, updates = {}) {
  const projects = await readProjects();
  const index = projects.findIndex((p) => p.id === id);
  if (index === -1) return null;

  const current = projects[index];
  const updated = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  // If status changed to completed, set completedAt
  if (updates.status === "completed" && !current.completedAt) {
    updated.completedAt = new Date().toISOString();
  }

  projects[index] = updated;
  await writeProjects(projects);
  return updated;
}

export async function deleteProjectRecord(id) {
  const projects = await readProjects();
  const filtered = projects.filter((p) => p.id !== id);
  const existed = filtered.length !== projects.length;
  if (existed) {
    await writeProjects(filtered);
  }
  return existed;
}
