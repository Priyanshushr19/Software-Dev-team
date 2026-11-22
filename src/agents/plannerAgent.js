/**
 * plannerAgent.js — Planner Agent
 * 
 * Now includes Phase 6: deployment (Dockerfiles + docker-compose)
 * so the generated project can run with: docker-compose up
 */

import { safeCallGemini, callGemini, makeTokenDelta, emptyTokenDelta } from "../utils/gemini.js";

const PLANNER_PROMPT = `You are the Planner Agent in an AI software development team.

ROLE: Senior tech lead who creates the build plan.

GOAL: Break the architecture blueprint into ordered coding tasks based on the PM specification.

SCOPE CONSTRAINTS:
- PM specification is the source of truth for project scope and technology selection.
- PM technologyConstraints are LOCKED and MANDATORY.
- Generate tasks using ONLY the locked technology stack:
  - If frontend is ["HTML", "CSS", "JavaScript"] (no framework): generate tasks for .html, .css, .js files. DO NOT generate .jsx or React files.
  - If frontend is ["Vue"]: generate tasks for .vue files.
  - If frontend is ["React"]: generate tasks for .jsx / React files.
- If projectType is "frontend_only":
  - Generate ONLY frontend-related tasks (UI components, pages, client-side state/logic, styling, integration, deployment).
  - DO NOT generate backend tasks, models, middleware, express routes, database connection, JWT auth, API servers, or any files under backend/.
- If projectType is "backend_only":
  - Generate ONLY backend-related tasks. DO NOT generate frontend pages or components.
- If projectType is "full_stack":
  - Generate full-stack phases (setup, models, middleware, backend, frontend, integration, deployment).

OUTPUT FORMAT (strict JSON):
{
  "phases": [
    {
      "phaseNumber": 1,
      "phaseName": "setup",
      "description": "What this phase accomplishes",
      "tasks": [
        {
          "taskId": "setup-1",
          "title": "Short task title",
          "description": "What exactly to build",
          "filesToCreate": ["frontend/src/components/Calculator.jsx"],
          "filesNeeded": [],
          "acceptanceCriteria": ["Calculator component renders and computes math operations"],
          "canParallelize": false,
          "estimatedTokens": 500
        }
      ]
    }
  ],
  "totalTasks": 5,
  "estimatedTotalTokens": 5000
}

RULES:
- Each task creates 1-3 files max.
- "filesNeeded" = files this task imports from (must exist from prior tasks).
- "filesToCreate" = files this task writes.
- Give each task a unique taskId: "phaseName-N".
- For frontend_only, keep task count focused (3-8 tasks).
- PATH MANDATE: All backend files MUST be placed inside backend/src/ (e.g. "backend/src/models/Task.js", "backend/src/routes/taskRoutes.js"). NEVER use "backend/models/..." or "backend/routes/...".
- PATH MANDATE: All frontend code files MUST be placed inside frontend/src/ (e.g. "frontend/src/components/TodoList.jsx", "frontend/src/pages/TodoDashboard.jsx").

IMPORTANT — THESE FILES ALREADY EXIST (scaffolded automatically, do NOT create them):
- backend/src/config/db.js, backend/src/middleware/auth.js, backend/src/index.js
- frontend/index.html, frontend/src/main.jsx, frontend/src/App.jsx
- frontend/src/index.css, frontend/tailwind.config.js, frontend/postcss.config.js, frontend/vite.config.js
- frontend/src/utils/api.js
- .gitignore, all .env files

Phase 6 (integration): Do NOT create backend/src/index.js or frontend/src/App.jsx — they are AUTO-ASSEMBLED.
Phase 7 (deployment): Include ONLY a README.md task. Docker files are auto-generated.`;

export async function plannerAgentNode(state) {
  console.log("\n📋 [Planner Agent] Creating build plan...\n");

  if (state.blueprintValidation && state.blueprintValidation.isValid === false) {
    const errorMsg = `Cannot create build plan: Blueprint validation is in failed/blocked state (${state.blueprintValidation.issues?.length || 0} unresolved issues).`;
    console.error(`   🛑 ${errorMsg}`);
    return {
      error: errorMsg,
      tokenUsage: emptyTokenDelta("plannerAgent"),
    };
  }

  const blueprint = state.blueprint || {};
  const clarifiedSpec = state.clarifiedSpec || state.spec || {};
  const appName = clarifiedSpec?.appName || "app";
  const projectType = state.projectType || clarifiedSpec?.projectType || "full_stack";
  const constraints = state.technologyConstraints || clarifiedSpec?.technologyConstraints || {};

  console.log(`   Project type: ${projectType}`);

  const blueprintSummary = {
    projectType,
    technologyConstraints: constraints,
    databaseType: blueprint.dbSchema?.databaseType,
    entities: blueprint.entities?.map(e => ({
      name: e?.name || "",
      tableName: e?.tableName || "",
      apiPath: e?.apiPath || "",
      modelFile: e?.modelFile || "",
      routeFile: e?.routeFile || "",
    })),
    tables: blueprint.dbSchema?.tables?.map(t => ({
      name: t?.name || "",
      fieldCount: t?.fields?.length || 0,
      foreignKeys: t?.foreignKeys?.map(fk => fk?.references).filter(Boolean),
    })),
    apiEndpoints: blueprint.apiEndpoints?.map(e => ({
      method: e?.method || "",
      path: e?.path || "",
      relatedTable: e?.relatedTable || "",
      requiresAuth: e?.requiresAuth || false,
    })),
    frontendPages: blueprint.frontendPages?.map(p => ({
      name: p?.name || "",
      route: p?.route || "",
      componentCount: p?.components?.length || 0,
    })),
    folderStructure: blueprint.folderStructure || "",
    backendDeps: Object.keys(blueprint.dependencies?.backend?.dependencies || {}),
    frontendDeps: Object.keys(blueprint.dependencies?.frontend?.dependencies || {}),
  };

  const result = await safeCallGemini({
    systemPrompt: PLANNER_PROMPT,
    userPrompt: `App: ${appName}\nProjectType: ${projectType}\n\nBlueprint:\n${JSON.stringify(blueprintSummary, null, 2)}\n\nSpec:\n${JSON.stringify(clarifiedSpec, null, 2)}`,
    agentName: "plannerAgent",
    currentCost: state.tokenUsage?.estimatedCost || 0,
    tokenBudget: state.tokenBudget,
  });

  if (!result.ok) {
    console.error(`   [plannerAgent] LLM failed: ${result.error}`);
    return { error: `plannerAgent failed: ${result.error}`, tokenUsage: emptyTokenDelta("plannerAgent") };
  }

  let plan = result.parsed;

  // Guardrail post-filter for frontend_only projects
  if (projectType === "frontend_only" && plan.phases) {
    plan.phases = plan.phases.filter(phase => {
      const name = phase.phaseName?.toLowerCase();
      return !["models", "middleware", "backend", "database"].includes(name);
    }).map(phase => {
      if (phase.tasks) {
        phase.tasks = phase.tasks.filter(task => {
          const files = task.filesToCreate || [];
          return !files.some(f => f.startsWith("backend/"));
        });
      }
      return phase;
    }).filter(phase => phase.tasks && phase.tasks.length > 0);

    let total = 0;
    plan.phases.forEach((p, idx) => {
      p.phaseNumber = idx + 1;
      total += p.tasks.length;
    });
    plan.totalTasks = total;
  }

  console.log(`   📦 Total phases: ${plan.phases?.length || 0}`);
  console.log(`   📝 Total tasks: ${plan.totalTasks || "?"}`);
  console.log("");

  if (plan.phases) {
    for (const phase of plan.phases) {
      const parallelCount = phase.tasks?.filter(t => t.canParallelize).length || 0;
      console.log(`   Phase ${phase.phaseNumber}: ${phase.phaseName} — ${phase.tasks?.length || 0} tasks (${parallelCount} parallelizable)`);
      phase.tasks?.forEach(t => {
        console.log(`     ${t.canParallelize ? "∥" : "→"} ${t.taskId}: ${t.title}`);
      });
    }
  }

  return {
    taskQueue: plan,
    currentPhaseIndex: 0,
    currentTaskIndex: 0,
    tokenUsage: makeTokenDelta("plannerAgent", result.tokens),
    currentPhase: "planner",
    completedNodes: ["plannerAgent"],
  };
}
