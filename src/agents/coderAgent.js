/**
 * coderAgent.js — Coder Agent (v3: One File Per Call)
 * 
 * KEY CHANGES:
 * 1. ONE FILE PER LLM CALL — prevents truncation, each response is small
 * 2. Knows what files exist on disk — won't overwrite scaffold
 * 3. Validates output path matches requested path
 * 4. On retry: reads current file from disk, includes executor errors
 * 5. Shorter system prompt — rules split into backend vs frontend
 * 6. Protect scaffold files from being overwritten
 */

import { safeCallGemini, makeTokenDelta, emptyTokenDelta } from "../utils/gemini.js";
import { writeFile, readFile, getFileList } from "../utils/sandboxManager.js";

// ═══════════════════════════════════════════════════════════
// SYSTEM PROMPTS — split by file type so each is smaller
// ═══════════════════════════════════════════════════════════

const BACKEND_PROMPT = `You are a senior backend developer. Write ONE file.

OUTPUT FORMAT (strict JSON — single file only):
{
  "path": "backend/src/models/todoItem.js",
  "content": "// Full file content here",
  "notes": "Brief explanation"
}

RULES:
- ES module syntax ONLY (import/export, never require)
- Express: use Router(), router.get/post/put/delete
- DB: ALWAYS parameterized queries ($1, $2). NEVER string concatenation.
- Models: return clean data (not raw {rows}). Mark async functions.
- Response format EVERYWHERE: { success: true/false, data: ... } or { success: false, message: "..." }
  200: { success: true, data: result }
  201: { success: true, data: newItem }
  400: { success: false, message: "Invalid input" }
  401: { success: false, message: "Unauthorized" }
  404: { success: false, message: "Not found" }
  500: { success: false, message: error.message }
- Auth: JWT Bearer token. req.headers.authorization?.split(' ')[1]. req.user = decoded.
- Env vars: process.env.DATABASE_URL, process.env.JWT_SECRET, process.env.PORT
- .js extension in ALL imports (required for ES modules)
- Write COMPLETE files. No TODO, no placeholders.
- Keep code concise: 60-120 lines target. No excessive comments.`;

const FRONTEND_PROMPT = `You are a senior frontend developer. Write ONE file.

OUTPUT FORMAT (strict JSON — single file only):
{
  "path": "frontend/src/pages/DashboardPage.jsx",
  "content": "// Full file content here",
  "notes": "Brief explanation"
}

RULES:
- PM specification is the source of truth for project scope and technology selection.
- Strictly follow ALLOWED TECHNOLOGIES. Do NOT introduce unrequested frameworks/backends/databases.
- If ALLOWED TECHNOLOGIES specifies HTML, CSS, JavaScript (no framework):
  - Write plain HTML, CSS, or vanilla JavaScript. Do NOT write React JSX or import React hooks.
- If ALLOWED TECHNOLOGIES specifies Vue:
  - Write Vue component code.
- If ALLOWED TECHNOLOGIES specifies React:
  - Use React functional components with hooks (useState, useEffect, useContext).
- If projectType is "frontend_only", handle all application logic and state LOCALLY (client state, localStorage). DO NOT call non-existent backend API endpoints.
- ALWAYS include loading state and error state where applicable.

DESIGN SYSTEM — DARK MODE (follow strictly):
- Background: bg-gray-950 or #0c0c10. Cards: bg-gray-900/80 border border-gray-800/60 rounded-2xl p-6
- Text: text-white (titles), text-gray-300 (body), text-gray-500 (meta)
- Accent: emerald / cyan. Buttons: bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-4 py-2.5
- Icons: Use Unicode symbols (+ × ← →), NO emoji
- Write COMPLETE files. No TODO. Keep concise: 60-120 lines.`;

// Files created by sandbox scaffold — never overwrite these
const SCAFFOLD_FILES = new Set([
  "backend/src/index.js",
  "backend/src/config/db.js",
  "backend/src/middleware/auth.js",
  "frontend/index.html",
  "frontend/src/main.jsx",
  "frontend/src/App.jsx",
  "frontend/src/index.css",
  "frontend/src/utils/api.js",
  "frontend/tailwind.config.js",
  "frontend/postcss.config.js",
  "frontend/vite.config.js",
]);

export async function coderAgentNode(state) {
  console.log("\n[Coder Agent] Writing code...\n");

  const { currentTask, contextPackage, sandboxId } = state;
  const projectType = state.projectType || state.clarifiedSpec?.projectType || "full_stack";
  const constraints = state.technologyConstraints || state.clarifiedSpec?.technologyConstraints || {};

  if (!currentTask || !contextPackage) {
    console.log("   No task or context");
    return { coderOutput: null };
  }

  const filesToCreate = contextPackage.task.filesToCreate || [];
  const reviewerFeedback = contextPackage.reviewerFeedback || (state.reviewResult?.verdict === "rejected" ? state.reviewResult : null);
  const isRetry = Boolean(
    (reviewerFeedback && reviewerFeedback.issues?.length > 0) ||
    (state.reviewResult?.verdict === "rejected" && state.reviewResult?.issues?.length > 0)
  );
  
  // Get existing files on disk for awareness
  let existingFiles = [];
  try { existingFiles = getFileList(sandboxId); } catch (e) {}

  // Build shared context (same for all files in this task)
  let sharedContext = `PROJECT TYPE: ${projectType}\n`;
  sharedContext += `ALLOWED TECHNOLOGIES: ${JSON.stringify(constraints)}\n`;
  sharedContext += `RULE: PM specification is the source of truth for project scope and technology selection. Do NOT introduce unrequested frameworks/backends.\n\n`;

  // Naming map
  if (contextPackage.namingMap?.length) {
    sharedContext += `NAMING MAP:\n`;
    contextPackage.namingMap.forEach(n => {
      sharedContext += `  ${n.entity} → table: ${n.tableName}, api: ${n.apiPath}, model: ${n.modelFile}, route: ${n.routeFile}\n`;
    });
    sharedContext += "\n";
  }

  // Dependencies
  const deps = contextPackage.dependencyInterfaces || {};
  if (Object.keys(deps).length > 0) {
    sharedContext += `EXISTING FILES YOU CAN IMPORT FROM:\n`;
    for (const [depPath, info] of Object.entries(deps)) {
      sharedContext += `  ${depPath}: ${info.importStatement || ""}\n`;
      if (info.interface) sharedContext += `    → ${info.interface}\n`;
    }
    sharedContext += "\n";
  }

  // DB schema
  if (contextPackage.dbSchema) {
    sharedContext += `DATABASE: ${contextPackage.dbSchema.databaseType}\nTABLES: ${JSON.stringify(contextPackage.dbSchema.tables, null, 2)}\n\n`;
  }

  // API endpoints (for frontend)
  if (contextPackage.apiEndpoints) {
    sharedContext += `API ENDPOINTS:\n${JSON.stringify(contextPackage.apiEndpoints, null, 2)}\n\n`;
  }

  // Scaffold awareness — tell coder what already exists
  const scaffoldOnDisk = existingFiles.filter(f => SCAFFOLD_FILES.has(f));
  if (scaffoldOnDisk.length > 0) {
    sharedContext += `ALREADY EXISTS (do NOT recreate, just import from them):\n`;
    scaffoldOnDisk.forEach(f => { sharedContext += `  - ${f}\n`; });
    sharedContext += "\n";
  }

  // Template
  if (contextPackage.templateFile) {
    sharedContext += `STYLE TEMPLATE (match this pattern):\n--- ${contextPackage.templateFile.path} ---\n${contextPackage.templateFile.content}\n\n`;
  }

  // Retry / Reviewer feedback context
  let retryContext = "";
  if (isRetry && reviewerFeedback) {
    retryContext += `\n=================================================================\n`;
    retryContext += `⚠️ CRITICAL: REVIEWER FEEDBACK — PREVIOUS ATTEMPT REJECTED (Cycle ${reviewerFeedback.reviewCycle || 1})\n`;
    retryContext += `SUMMARY: ${reviewerFeedback.summary || "Issues detected during code review"}\n`;
    retryContext += `MANDATORY ISSUES TO FIX (You MUST address every single issue):\n`;
    (reviewerFeedback.issues || []).forEach((issue, idx) => {
      retryContext += `  ${idx + 1}. ${issue}\n`;
    });
    retryContext += `\nCORRECTION INSTRUCTIONS:\n`;
    retryContext += `  - Perform a surgical correction resolving the exact issues listed above.\n`;
    retryContext += `  - Do NOT duplicate models, schemas, or exports across files (e.g. if Todo.js references User, import User instead of redefining it).\n`;
    retryContext += `  - Ensure clean, modular architecture.\n`;
    if (state.executionResult?.errors) {
      retryContext += `\nEXECUTOR ERRORS:\n${state.executionResult.errors.slice(0, 500)}\n`;
    }
    retryContext += `=================================================================\n\n`;
  }

  // ═══════════════════════════════════════════════════════
  // ONE FILE PER LLM CALL
  // ═══════════════════════════════════════════════════════

  const allWrittenFiles = [];
  let totalTokens = { input: 0, output: 0, cost: 0 };

  for (const filePath of filesToCreate) {
    console.log(`   Generating: ${filePath}`);

    const isBackend = filePath.includes("backend");
    const systemPrompt = isBackend ? BACKEND_PROMPT : FRONTEND_PROMPT;

    // Build per-file prompt
    let filePrompt = `FILE TO WRITE: ${filePath}\n`;
    filePrompt += `TASK: ${currentTask.title}\n`;
    filePrompt += `DESCRIPTION: ${currentTask.description || ""}\n\n`;

    if (contextPackage.task.acceptanceCriteria?.length) {
      filePrompt += `ACCEPTANCE CRITERIA:\n${contextPackage.task.acceptanceCriteria.map(c => `  - ${c}`).join("\n")}\n\n`;
    }

    filePrompt += sharedContext;

    // Show peer model files to prevent duplicate models
    if (filePath.includes("models/")) {
      const peerModels = existingFiles.filter(f => f.includes("models/") && f !== filePath);
      if (peerModels.length > 0) {
        filePrompt += `\nOTHER EXISTING MODELS IN PROJECT (Do NOT duplicate these model definitions):\n`;
        for (const pm of peerModels) {
          try {
            const pmContent = readFile(sandboxId, pm);
            if (pmContent) {
              filePrompt += `--- ${pm} ---\n${pmContent.slice(0, 1000)}\n`;
            }
          } catch (e) {}
        }
        filePrompt += "\n";
      }
    }

    // Include existing content if file exists on disk
    let currentContent = null;
    try {
      currentContent = readFile(sandboxId, filePath);
    } catch (e) {}

    if (currentContent) {
      filePrompt += `\nCURRENT FILE ON DISK (Fix and refine this file — do NOT rewrite from scratch if only fixing issues):\n--- ${filePath} ---\n${currentContent}\n`;
    }

    // On retry: include prominent reviewer rejection feedback
    if (isRetry && retryContext) {
      filePrompt += retryContext;
    }

    filePrompt += `\nAPP: ${contextPackage.appName}\nOUTPUT: Return JSON with path, content, notes. The "path" MUST be exactly "${filePath}".\n`;

    const result = await safeCallGemini({
      systemPrompt,
      userPrompt: filePrompt,
      agentName: "coderAgent",
      currentCost: state.tokenUsage?.estimatedCost + totalTokens.cost || 0,
      tokenBudget: state.tokenBudget,
    });

    if (!result.ok) {
      console.error(`   FAILED: ${filePath} — ${result.error}`);
      allWrittenFiles.push({ path: filePath, lines: 0, error: result.error });
      continue;
    }

    // Parse — handle both single file and files array format
    let fileData = result.parsed;
    if (fileData.files && Array.isArray(fileData.files)) {
      fileData = fileData.files[0] || {};
    }

    const outputPath = fileData.path || filePath;
    const content = fileData.content || "";

    if (!content) {
      console.error(`   EMPTY: ${filePath} — LLM returned no content`);
      allWrittenFiles.push({ path: filePath, lines: 0, error: "Empty content" });
      continue;
    }

    // Path validation: warn if LLM returned different path
    let writePath = filePath; // Always write to the REQUESTED path
    if (outputPath !== filePath) {
      console.warn(`   PATH MISMATCH: requested "${filePath}" but LLM returned "${outputPath}". Using requested path.`);
    }

    // Write protection: don't overwrite scaffold on first attempt (retry is OK)
    if (SCAFFOLD_FILES.has(writePath) && !isRetry) {
      console.log(`   PROTECTED: ${writePath} (scaffold file, skipping)`);
      continue;
    }

    // Write to disk
    try {
      writeFile(sandboxId, writePath, content);
      const lines = content.split("\n").length;
      console.log(`   OK: ${writePath} (${lines} lines)`);
      allWrittenFiles.push({ path: writePath, lines });
    } catch (err) {
      console.error(`   WRITE FAILED: ${writePath} — ${err.message}`);
      allWrittenFiles.push({ path: writePath, lines: 0, error: err.message });
    }

    // Accumulate tokens
    totalTokens.input += result.tokens.input;
    totalTokens.output += result.tokens.output;
    totalTokens.cost += result.tokens.cost;
  }

  // ═══════════════════════════════════════════════════════

  const successCount = allWrittenFiles.filter(f => !f.error).length;
  const failCount = allWrittenFiles.filter(f => f.error).length;
  console.log(`\n   Done: ${successCount} written, ${failCount} failed`);

  // If ALL files failed, mark as error for reviewer to reject
  const allFailed = successCount === 0 && filesToCreate.length > 0;

  return {
    completedNodes: ["coderAgent"],
    coderOutput: {
      files: allWrittenFiles,
      notes: allFailed ? "All files failed to generate" : `${successCount} files written`,
      error: allFailed,
    },
    tokenUsage: makeTokenDelta("coderAgent", totalTokens),
  };
}
