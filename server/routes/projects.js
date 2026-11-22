import { Router } from "express";
import fs from "fs";
import path from "path";
import { ZipArchive } from "archiver";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  startProject,
  resumeProject,
  getRunStatus,
  getActiveRuns,
  cancelProject,
} from "../services/graphRunner.js";
import {
  findProjectById,
  findProjectsByUserId,
  deleteProjectRecord,
  deriveProjectName,
  readProjects,
} from "../services/projectStore.js";
import { broadcastToProject } from "../ws/handler.js";
import { buildGraph, createCheckpointer } from "../../src/config/graph.js";
import {
  getSandboxInfo,
  getFileList,
  readFile,
  findSandboxPath,
  destroySandbox,
} from "../../src/utils/sandboxManager.js";

const router = Router();

router.use(requireAuth);

/**
 * Helper to ensure the authenticated user owns the requested project.
 * Returns the project record if authorized, or sends 404/403 and returns null.
 */
async function getOwnedProject(req, res) {
  const { id } = req.params;
  const project = await findProjectById(id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return null;
  }
  if (!project.userId || project.userId !== req.authUser.id) {
    res.status(403).json({ error: "Access denied: you do not own this project" });
    return null;
  }
  return project;
}

router.post("/", async (req, res) => {
  try {
    const { requirement, tokenBudget, name, projectType, technologyConstraints } = req.body || {};

    if (!requirement || typeof requirement !== "string" || requirement.trim().length === 0) {
      return res.status(400).json({ error: "requirement is required" });
    }

    const projectId = `project-${Date.now()}`;
    const emit = (event) => broadcastToProject(projectId, event);

    // Derive or sanitize name
    const projectName = name && typeof name === "string" && name.trim() ? name.trim() : deriveProjectName(requirement.trim());
    const validProjectType = projectType === "frontend_only" || projectType === "backend_only" ? projectType : "full_stack";

    const result = await startProject(projectId, requirement.trim(), emit, {
      tokenBudget: Number(tokenBudget) || 2.0,
      userId: req.authUser.id, // Strictly derive from session, never from body
      name: projectName,
      projectType: validProjectType,
      technologyConstraints: technologyConstraints || {},
    });

    res.status(201).json({
      projectId: result.projectId,
      threadId: result.threadId,
      status: "running",
      message: "Project started. Connect to WebSocket for real-time updates.",
      wsUrl: `/ws?projectId=${result.projectId}`,
    });
  } catch (error) {
    console.error("Error starting project:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const userProjects = await findProjectsByUserId(req.authUser.id);
    let enriched = userProjects.map((p) => {
      const runStatus = getRunStatus(p.id);
      return {
        ...p,
        active: !!runStatus,
        status: runStatus ? runStatus.status : p.status,
        waitingForInput: runStatus ? runStatus.waitingForInput : (p.status === "waiting_input"),
      };
    });

    const { search, status, type, sort, page, limit } = req.query;

    // Filter by search term (name, requirement, id)
    if (search && typeof search === "string" && search.trim()) {
      const q = search.trim().toLowerCase();
      enriched = enriched.filter((p) =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.requirement && p.requirement.toLowerCase().includes(q)) ||
        (p.id && p.id.toLowerCase().includes(q))
      );
    }

    // Filter by execution status
    if (status && status !== "all") {
      if (status === "running") {
        enriched = enriched.filter((p) => p.status === "running" || p.status === "waiting_input");
      } else if (status === "completed") {
        enriched = enriched.filter((p) => p.status === "completed" || p.status === "complete");
      } else if (status === "failed") {
        enriched = enriched.filter((p) => p.status === "failed" || p.status === "error");
      } else if (status === "cancelled") {
        enriched = enriched.filter((p) => p.status === "cancelled");
      } else {
        enriched = enriched.filter((p) => p.status === status);
      }
    }

    // Filter by project type
    if (type && type !== "all") {
      enriched = enriched.filter((p) => (p.projectType || "full_stack") === type);
    }

    // Sorting
    if (sort === "oldest") {
      enriched.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    } else if (sort === "newest") {
      enriched.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    } else {
      // Default: recently updated
      enriched.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
    }

    const total = enriched.length;

    // Pagination if page or limit query parameters provided
    if (page !== undefined || limit !== undefined) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
      const totalPages = Math.ceil(total / limitNum) || 1;
      const startIndex = (pageNum - 1) * limitNum;
      const paginated = enriched.slice(startIndex, startIndex + limitNum);

      return res.json({
        projects: paginated,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages,
      });
    }

    // Default response: return all projects with metadata
    res.json({
      projects: enriched,
      total,
      page: 1,
      limit: total,
      totalPages: 1,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const project = await getOwnedProject(req, res);
    if (!project) return;

    const runStatus = getRunStatus(id);

    let state = null;
    try {
      const checkpointer = await createCheckpointer();
      const graph = buildGraph({ checkpointer });
      const config = { configurable: { thread_id: id } };
      const savedState = await graph.getState(config);
      state = savedState?.values || null;
    } catch {
      state = null;
    }

    res.json({
      projectId: id,
      project,
      active: !!runStatus,
      runStatus: runStatus || null,
      state: state ? summarizeState(state) : null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const project = await getOwnedProject(req, res);
    if (!project) return;

    // 1. Cancel if active run
    if (getRunStatus(id)) {
      try {
        cancelProject(id);
      } catch (err) {
        console.warn(`[deleteProject] Error cancelling active run for ${id}:`, err.message);
      }
    }

    // 2. Destroy sandbox containers & folder if sandbox exists and NOT shared
    const sandboxId = project.sandboxId;
    if (sandboxId) {
      try {
        const allProjects = await readProjects();
        const isSharedSandbox = allProjects.some((p) => p.id !== id && p.sandboxId === sandboxId);
        if (!isSharedSandbox) {
          destroySandbox(sandboxId);
        }
      } catch (err) {
        console.warn(`[deleteProject] Error destroying sandbox ${sandboxId}:`, err.message);
      }
    }

    // 3. Delete thread from checkpointer if supported
    try {
      const checkpointer = await createCheckpointer();
      if (typeof checkpointer.deleteThread === "function") {
        await checkpointer.deleteThread(id);
      }
    } catch (err) {
      console.warn(`[deleteProject] Error deleting checkpoint thread ${id}:`, err.message);
    }

    // 4. Delete from project metadata store
    await deleteProjectRecord(id);

    res.json({
      success: true,
      message: "Project deleted successfully",
      projectId: id,
    });
  } catch (error) {
    console.error("Error deleting project:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/:id/zip", async (req, res) => {
  try {
    const { id } = req.params;
    const project = await getOwnedProject(req, res);
    if (!project) return;

    // Find sandboxId from project metadata or checkpointer
    let sandboxId = project.sandboxId;
    if (!sandboxId) {
      try {
        const checkpointer = await createCheckpointer();
        const graph = buildGraph({ checkpointer });
        const savedState = await graph.getState({ configurable: { thread_id: id } });
        sandboxId = savedState?.values?.sandboxId;
      } catch (_) {}
    }

    if (!sandboxId) {
      return res.status(404).json({ error: "Project files are not available for download" });
    }

    const sandboxPath = findSandboxPath(sandboxId);
    if (!sandboxPath || !fs.existsSync(sandboxPath)) {
      return res.status(404).json({ error: "Project workspace directory not found" });
    }

    const rawName = project.name || deriveProjectName(project.requirement) || "project";
    const slug = rawName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project";
    const zipFilename = `${slug}.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipFilename}"`);
    res.setHeader("Cache-Control", "no-cache");

    const archive = new ZipArchive({
      zlib: { level: 9 },
    });

    archive.on("error", (err) => {
      console.error(`[ZIP error for ${id}]:`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to generate ZIP archive" });
      }
    });

    archive.pipe(res);

    const rootDir = path.resolve(sandboxPath);

    function addDirectory(currentDir) {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        let realPath;
        try {
          realPath = fs.realpathSync(fullPath);
        } catch {
          continue;
        }
        if (!realPath.startsWith(rootDir)) {
          continue; // Path traversal prevention
        }

        if (entry.isDirectory()) {
          const dirName = entry.name.toLowerCase();
          if (
            dirName === "node_modules" ||
            dirName === ".git" ||
            dirName === ".cache" ||
            dirName === ".vite" ||
            dirName === "dist" ||
            dirName === "build" ||
            dirName === ".system_generated" ||
            dirName === ".turbo" ||
            dirName === "coverage"
          ) {
            continue;
          }
          addDirectory(fullPath);
        } else if (entry.isFile()) {
          const fileName = entry.name.toLowerCase();

          // Exclude sensitive and temp files
          if (
            fileName.startsWith(".env") ||
            fileName.endsWith(".log") ||
            fileName.endsWith(".tmp") ||
            fileName === ".ds_store" ||
            fileName === "thumbs.db" ||
            fileName.endsWith(".key") ||
            fileName.endsWith(".pem") ||
            fileName === "id_rsa"
          ) {
            // Provide sanitized .env.example template if .env exists
            if (fileName === ".env") {
              try {
                const rawEnv = fs.readFileSync(fullPath, "utf-8");
                const sanitizedLines = rawEnv
                  .split("\n")
                  .map((line) => {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith("#")) return line;
                    const eqIdx = line.indexOf("=");
                    if (eqIdx === -1) return line;
                    const key = line.slice(0, eqIdx).trim();
                    let placeholder = "your_value_here";
                    if (key.includes("SECRET") || key.includes("KEY")) placeholder = "your_secret_here";
                    else if (key.includes("URL") || key.includes("URI")) {
                      placeholder = key.includes("DB") || key.includes("DATABASE")
                        ? "postgresql://user:password@localhost:5432/appdb"
                        : "http://localhost:5000";
                    } else if (key.includes("PORT")) placeholder = "5000";
                    return `${key}=${placeholder}`;
                  })
                  .join("\n");

                const relDirPath = path.relative(rootDir, currentDir).replace(/\\/g, "/");
                const exampleRelPath = relDirPath
                  ? `${relDirPath}/.env.example`
                  : ".env.example";
                archive.append(sanitizedLines, { name: exampleRelPath });
              } catch (_) {}
            }
            continue;
          }

          const relPath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
          archive.file(fullPath, { name: relPath });
        }
      }
    }

    addDirectory(rootDir);
    await archive.finalize();
  } catch (error) {
    console.error("Error generating zip:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

router.post("/api-key", async (req, res) => {
  try {
    const { apiKey } = req.body || {};
    if (!apiKey) {
      return res.status(400).json({ error: "apiKey is required" });
    }
    const { initGemini } = await import("../../src/utils/gemini.js");
    initGemini(apiKey);
    res.json({ success: true, message: "Gemini API key updated successfully" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/:id/resume", async (req, res) => {
  try {
    const { id } = req.params;
    const project = await getOwnedProject(req, res);
    if (!project) return;

    const { apiKey } = req.body || {};

    if (apiKey) {
      const { initGemini } = await import("../../src/utils/gemini.js");
      initGemini(apiKey);
    }

    if (getRunStatus(id)) {
      return res.status(409).json({ error: "Project is already running" });
    }

    const emit = (event) => broadcastToProject(id, event);
    const result = await resumeProject(id, emit);

    res.json({
      projectId: result.projectId,
      status: "resumed",
      wsUrl: `/ws?projectId=${result.projectId}`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/:id/cancel", async (req, res) => {
  const { id } = req.params;
  const project = await getOwnedProject(req, res);
  if (!project) return;

  const cancelled = cancelProject(id);
  res.json({
    cancelled,
    message: cancelled ? "Project cancelled" : "No active run found",
  });
});

router.get("/:id/sandbox", async (req, res) => {
  try {
    const { id } = req.params;
    const project = await getOwnedProject(req, res);
    if (!project) return;

    let sandboxId = project.sandboxId;
    if (!sandboxId) {
      const checkpointer = await createCheckpointer();
      const graph = buildGraph({ checkpointer });
      const config = { configurable: { thread_id: id } };
      const savedState = await graph.getState(config);
      sandboxId = savedState?.values?.sandboxId;
    }

    if (!sandboxId) {
      return res.status(404).json({ error: "No sandbox found for this project" });
    }

    const info = getSandboxInfo(sandboxId);
    let files = [];
    try {
      files = getFileList(sandboxId);
    } catch {
      files = [];
    }

    res.json({
      sandboxId,
      info,
      fileCount: files.length,
      files: files.slice(0, 500),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/:id/files/*", async (req, res) => {
  try {
    const { id } = req.params;
    const project = await getOwnedProject(req, res);
    if (!project) return;

    const filePath = req.params[0] || "";

    // Path traversal prevention
    if (filePath.includes("..") || path.isAbsolute(filePath)) {
      return res.status(400).json({ error: "Invalid file path: path traversal detected" });
    }

    let sandboxId = project.sandboxId;
    if (!sandboxId) {
      const checkpointer = await createCheckpointer();
      const graph = buildGraph({ checkpointer });
      const config = { configurable: { thread_id: id } };
      const savedState = await graph.getState(config);
      sandboxId = savedState?.values?.sandboxId;
    }

    if (!sandboxId) {
      return res.status(404).json({ error: "No sandbox found for this project" });
    }

    try {
      const content = readFile(sandboxId, filePath);
      if (content === null) {
        return res.status(404).json({ error: "File not found" });
      }
      res.json({ path: filePath, content });
    } catch (readErr) {
      if (readErr.message && readErr.message.includes("Path traversal")) {
        return res.status(400).json({ error: "Invalid file path: path traversal detected" });
      }
      return res.status(404).json({ error: readErr.message || "File not found" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function summarizeState(state) {
  return {
    userRequirement: state.userRequirement,
    currentPhase: state.currentPhase,
    pmStatus: state.pmStatus,
    hasSpec: !!state.clarifiedSpec,
    clarifiedSpec: state.clarifiedSpec || null,
    hasBlueprint: !!state.blueprint?.entities?.length,
    blueprint: state.blueprint || null,
    blueprintValid: state.blueprintValidation?.isValid,
    taskQueue: state.taskQueue || null,
    taskPhases: state.taskQueue?.phases?.length || 0,
    totalTasks: state.taskQueue?.phases?.reduce((sum, phase) => sum + (phase.tasks?.length || 0), 0) || 0,
    currentPhaseIndex: state.currentPhaseIndex,
    currentTaskIndex: state.currentTaskIndex,
    currentTask: state.currentTask || null,
    taskStatuses: state.taskStatuses || {},
    completedNodes: state.completedNodes || [],
    sandboxId: state.sandboxId || null,
    sandboxHealthy: state.sandboxHealthy || false,
    fileRegistryCount: state.fileRegistry?.length || 0,
    fileRegistry: state.fileRegistry || [],
    tokenUsage: state.tokenUsage,
    error: state.error,
  };
}

export default router;
