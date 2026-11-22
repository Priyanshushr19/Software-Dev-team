/**
 * architectAgent.js — Architect Agent (5 Steps)
 * 
 * NAMING CONVENTION (enforced across all steps):
 * - Entity names: PascalCase → User, TodoItem, Category
 * - Table names: snake_case plural → users, todo_items, categories
 * - API paths: kebab-case plural → /api/users, /api/todo-items
 * - File names: camelCase → userModel.js, todoItemRoutes.js
 * - DB fields: snake_case → created_at, password_hash, user_id
 * - JS variables: camelCase → createdAt, passwordHash, userId
 * 
 * Step 1 generates the naming map. Steps 2-5 receive it and MUST follow it.
 */

import { safeCallGemini, callGemini, makeTokenDelta, emptyTokenDelta } from "../utils/gemini.js";

const NAMING_RULES = `
STRICT NAMING CONVENTION & SCOPE CONSTRAINTS:
- PM specification is the source of truth for project scope and technology selection.
- Table names: snake_case + plural (e.g., "users", "todo_items", "categories")
- DB field names: snake_case (e.g., "created_at", "password_hash", "user_id")
- API paths: kebab-case + plural (e.g., "/api/users", "/api/todo-items")
- relatedTable field: ALWAYS a single table name, NEVER comma-separated
- Foreign key format: "table_name(field)" (e.g., "users(id)")
`;

// ═══════════════════════════════════════════════════════════════
// STEP 1: Identify Entities & Relationships + Naming Map
// ═══════════════════════════════════════════════════════════════

const STEP1_PROMPT = `You are the Architect Agent in an AI software development team.

ROLE: Senior software architect.
GOAL: Identify ALL entities and their relationships, AND generate a standard naming map.

${NAMING_RULES}

RULES:
- Respect projectType from the spec ("frontend_only", "backend_only", "full_stack").
- For frontend_only projects: entities are UI state/components/views, NOT backend database tables. Do NOT create backend model/route files for frontend_only.
- Always include a "User" entity ONLY if auth is required by the spec.
- Generate tableName, apiPath, modelFile, routeFile for EVERY entity (or UI component name for frontend_only).
- tableName must be snake_case plural.
- apiPath must be kebab-case plural with /api/ prefix.
- modelFile and routeFile must be camelCase (no extension).

OUTPUT FORMAT (strict JSON):
{
  "entities": [
    {
      "name": "TodoItem",
      "tableName": "todo_items",
      "apiPath": "/api/todo-items",
      "modelFile": "todoItem",
      "routeFile": "todoItemRoutes",
      "description": "A task or todo entry",
      "relationships": []
    }
  ]
}`;

export async function architectStep1Node(state) {
  console.log("\n🏗️  [Architect Step 1/5] Identifying entities & naming map...\n");

  const projectType = state.projectType || state.clarifiedSpec?.projectType || "full_stack";
  console.log(`   Project type: ${projectType}`);

  const result = await safeCallGemini({
    systemPrompt: STEP1_PROMPT,
    userPrompt: `Project Specification:\n${JSON.stringify(state.clarifiedSpec, null, 2)}`,
    agentName: "architectStep1",
    currentCost: state.tokenUsage?.estimatedCost || 0,
    tokenBudget: state.tokenBudget,
  });

  if (!result.ok) {
    console.error(`   Architect step 1 failed: ${result.error}`);
    return { error: `Architect step 1 failed: ${result.error}`, tokenUsage: emptyTokenDelta("architectStep1") };
  }

  const rawEntities = result.parsed.entities || result.parsed || [];
  const entities = rawEntities.map(e => {
    if (projectType === "frontend_only") {
      return {
        ...e,
        tableName: "N/A",
        apiPath: "N/A",
        modelFile: "N/A",
        routeFile: "N/A",
      };
    }
    return e;
  });

  console.log(`   Found ${entities.length} entities:`);
  entities.forEach(e => console.log(`   • ${e.name} → table: ${e.tableName}, api: ${e.apiPath}`));

  return {
    blueprint: { entities },
    tokenUsage: makeTokenDelta("architectStep1", result.tokens),
  };
}

// ═══════════════════════════════════════════════════════════════
// STEP 2: Design Database Schema
// ═══════════════════════════════════════════════════════════════

const STEP2_PROMPT = `You are the Architect Agent designing the database schema.

${NAMING_RULES}

CRITICAL:
- PM specification is the source of truth for project scope and technology selection.
- Use the EXACT table names from the entity naming map provided. Do NOT rename tables.

OUTPUT FORMAT (strict JSON):
{
  "databaseType": "PostgreSQL" | "MongoDB" | "none",
  "databaseReason": "Why this DB (1 line)",
  "tables": [
    {
      "name": "tasks",
      "tableName": "tasks",
      "description": "Task table",
      "fields": [
        { "name": "id", "type": "UUID", "primaryKey": true },
        { "name": "title", "type": "VARCHAR(255)", "required": true }
      ]
    }
  ]
}

RULES:
- If projectType is "frontend_only" or no database was requested, return databaseType: "none" and tables: [].
- Every table MUST have "id" (UUID with gen_random_uuid()), "created_at", "updated_at".
- Use snake_case for ALL table and field names.
- Be SPECIFIC with types — VARCHAR(255), not just "string".
- If auth: users table needs password_hash (NEVER plain passwords).
- Add indexes on foreign keys.`;

export async function architectStep2Node(state) {
  console.log("\n🏗️  [Architect Step 2/5] Designing database schema...\n");

  const projectType = state.projectType || state.clarifiedSpec?.projectType || "full_stack";
  const dbReq = state.clarifiedSpec?.databaseRecommendation;

  if (projectType === "frontend_only" || dbReq === "none") {
    console.log("   ⚡ Skipping DB schema generation for frontend-only / no-db project (0 LLM tokens used)");
    return {
      blueprint: {
        dbSchema: {
          databaseType: "none",
          databaseReason: "No database required for frontend_only project",
          tables: [],
        },
      },
      tokenUsage: emptyTokenDelta("architectStep2"),
    };
  }

  // Pass the naming map so Step 2 uses correct table names
  const entityNames = (state.blueprint.entities || []).map(e => ({
    name: e.name, tableName: e.tableName
  }));

  const validationIssues = state.blueprintValidation?.issues || [];
  const fixContext = validationIssues.length > 0
    ? `\n\nPREVIOUS VALIDATION ISSUES TO FIX:\n${JSON.stringify(validationIssues, null, 2)}`
    : "";

  const result = await safeCallGemini({
    systemPrompt: STEP2_PROMPT,
    userPrompt: `Entity Naming Map (use these EXACT table names):\n${JSON.stringify(entityNames, null, 2)}\n\nFull Entities:\n${JSON.stringify(state.blueprint.entities, null, 2)}\n\nSpec:\n${JSON.stringify(state.clarifiedSpec, null, 2)}${fixContext}`,
    agentName: "architectStep2",
    currentCost: state.tokenUsage?.estimatedCost || 0,
    tokenBudget: state.tokenBudget,
  });

  if (!result.ok) {
    console.error(`   Architect step 2 failed: ${result.error}`);
    return { error: `Architect step 2 failed: ${result.error}`, tokenUsage: emptyTokenDelta("architectStep2") };
  }

  const schema = result.parsed;
  if (schema.tables && Array.isArray(schema.tables)) {
    schema.tables = schema.tables.map(t => {
      const tblName = t.name || t.tableName || "unnamed";
      return {
        ...t,
        name: tblName,
        tableName: tblName,
      };
    });
  }

  console.log(`   DB: ${schema.databaseType} — ${schema.tables?.length || 0} tables`);
  schema.tables?.forEach(t => console.log(`   • ${t.name} (${t.fields?.length || 0} fields)`));

  return {
    blueprint: { dbSchema: schema },
    tokenUsage: makeTokenDelta("architectStep2", result.tokens),
  };
}

// ═══════════════════════════════════════════════════════════════
// STEP 3: Design API Endpoints
// ═══════════════════════════════════════════════════════════════

const STEP3_PROMPT = `You are the Architect Agent designing REST API endpoints.

${NAMING_RULES}

CRITICAL: 
- PM specification is the source of truth for project scope and technology selection.
- Use the EXACT apiPath from the entity naming map.
- "relatedTable" must be a SINGLE table name, never comma-separated.

OUTPUT FORMAT (strict JSON):
{
  "apiEndpoints": [
    {
      "method": "POST",
      "path": "/api/auth/register",
      "description": "Register new user",
      "relatedTable": "users",
      "requiresAuth": false
    },
    {
      "method": "GET",
      "path": "/api/todo-items",
      "description": "List all todo items",
      "relatedTable": "todo_items",
      "requiresAuth": true
    },
    {
      "method": "POST",
      "path": "/api/todo-items",
      "description": "Create new todo item",
      "relatedTable": "todo_items",
      "requiresAuth": true
    },
    {
      "method": "PUT",
      "path": "/api/todo-items/:id",
      "description": "Update todo item by id",
      "relatedTable": "todo_items",
      "requiresAuth": true
    },
    {
      "method": "DELETE",
      "path": "/api/todo-items/:id",
      "description": "Delete todo item by id",
      "relatedTable": "todo_items",
      "requiresAuth": true
    }
  ]
}

RULES:
- If projectType is "frontend_only", return apiEndpoints: [].
- REST conventions: GET=read, POST=create, PUT/PATCH=update, DELETE=delete.
- Include auth endpoints if auth is required by the spec: POST /api/auth/register, POST /api/auth/login.
- Every entity: GET all, GET by id, POST, PUT/PATCH, DELETE.
- Pagination on GET-all (page, limit query params).
- relatedTable = the PRIMARY table this endpoint queries. ONE table only.`;

export async function architectStep3Node(state) {
  console.log("\n🏗️  [Architect Step 3/5] Designing API endpoints...\n");

  const projectType = state.projectType || state.clarifiedSpec?.projectType || "full_stack";

  if (projectType === "frontend_only") {
    console.log("   ⚡ Skipping API endpoints generation for frontend-only project (0 LLM tokens used)");
    return {
      blueprint: { apiEndpoints: [] },
      tokenUsage: emptyTokenDelta("architectStep3"),
    };
  }

  const entityMap = (state.blueprint.entities || []).map(e => ({
    name: e.name, tableName: e.tableName, apiPath: e.apiPath
  }));

  const validationIssues = state.blueprintValidation?.issues || [];
  const fixContext = validationIssues.length > 0
    ? `\n\nCRITICAL BLUEPRINT VALIDATOR FEEDBACK (Must fix these exact issues):\n${JSON.stringify(validationIssues, null, 2)}`
    : "";

  const result = await safeCallGemini({
    systemPrompt: STEP3_PROMPT,
    userPrompt: `Entity Naming Map:\n${JSON.stringify(entityMap, null, 2)}\n\nDB Schema:\n${JSON.stringify(state.blueprint.dbSchema, null, 2)}\n\nSpec:\n${JSON.stringify(state.clarifiedSpec, null, 2)}${fixContext}`,
    agentName: "architectStep3",
    currentCost: state.tokenUsage?.estimatedCost || 0,
    tokenBudget: state.tokenBudget,
  });

  if (!result.ok) {
    console.error(`   Architect step 3 failed: ${result.error}`);
    return { error: `Architect step 3 failed: ${result.error}`, tokenUsage: emptyTokenDelta("architectStep3") };
  }

  const rawEndpoints = result.parsed.apiEndpoints || result.parsed;
  const endpoints = (Array.isArray(rawEndpoints) ? rawEndpoints : []).map(ep => {
    let p = String(ep.path || "").trim().replace(/\/+/g, "/");
    if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
    return {
      ...ep,
      method: (ep.method || "GET").toUpperCase().trim(),
      path: p,
      relatedTable: ep.relatedTable ? String(ep.relatedTable).trim().toLowerCase() : "",
      requiresAuth: Boolean(ep.requiresAuth),
    };
  });

  console.log(`   Designed ${endpoints.length} API endpoints`);

  return {
    blueprint: { apiEndpoints: endpoints },
    tokenUsage: makeTokenDelta("architectStep3", result.tokens),
  };
}

// ═══════════════════════════════════════════════════════════════
// STEP 4: Design Frontend Pages
// ═══════════════════════════════════════════════════════════════

const STEP4_PROMPT = `You are the Architect Agent designing frontend pages.

PM specification is the source of truth for project scope and technology selection.

OUTPUT FORMAT (strict JSON):
{
  "frontendPages": [
    {
      "name": "DashboardPage",
      "route": "/dashboard",
      "description": "Main page showing content",
      "requiresAuth": false,
      "components": [
        { 
          "name": "TodoList", 
          "description": "Interactive todo component", 
          "apiCalls": ["GET /api/todo-items", "POST /api/todo-items", "PUT /api/todo-items/:id", "DELETE /api/todo-items/:id"] 
        }
      ]
    }
  ]
}

RULES:
- If projectType is "frontend_only", components MUST have apiCalls: [] (no backend API calls).
- If projectType is "backend_only", return frontendPages: [].
- "apiCalls" must reference the EXACT HTTP method and path from the backend API endpoints provided (e.g., "GET /api/todo-items", "POST /api/auth/login", "PUT /api/todo-items/:id"). Do NOT invent new paths or alter parameter names.
- Include auth pages ONLY if auth is required by the spec.
- Include layout/navbar component as needed.`;

export async function architectStep4Node(state) {
  console.log("\n🏗️  [Architect Step 4/5] Designing frontend pages...\n");

  const projectType = state.projectType || state.clarifiedSpec?.projectType || "full_stack";

  if (projectType === "backend_only") {
    console.log("   ⚡ Skipping frontend pages generation for backend-only project (0 LLM tokens used)");
    return {
      blueprint: { frontendPages: [] },
      tokenUsage: emptyTokenDelta("architectStep4"),
    };
  }

  const validationIssues = state.blueprintValidation?.issues || [];
  const fixContext = validationIssues.length > 0
    ? `\n\nCRITICAL BLUEPRINT VALIDATOR FEEDBACK (Must fix these exact issues):\n${JSON.stringify(validationIssues, null, 2)}`
    : "";

  const result = await safeCallGemini({
    systemPrompt: STEP4_PROMPT,
    userPrompt: `API Endpoints:\n${JSON.stringify(state.blueprint.apiEndpoints, null, 2)}\n\nSpec:\n${JSON.stringify(state.clarifiedSpec, null, 2)}${fixContext}`,
    agentName: "architectStep4",
    currentCost: state.tokenUsage?.estimatedCost || 0,
    tokenBudget: state.tokenBudget,
  });

  if (!result.ok) {
    console.error(`   Architect step 4 failed: ${result.error}`);
    return { error: `Architect step 4 failed: ${result.error}`, tokenUsage: emptyTokenDelta("architectStep4") };
  }

  const rawPages = result.parsed.frontendPages || result.parsed;
  const pages = Array.isArray(rawPages) ? rawPages : [];
  console.log(`   Designed ${pages.length} pages`);

  return {
    blueprint: { frontendPages: pages },
    tokenUsage: makeTokenDelta("architectStep4", result.tokens),
  };
}

// ═══════════════════════════════════════════════════════════════
// STEP 5: Folder Structure + Dependencies
// ═══════════════════════════════════════════════════════════════

const STEP5_PROMPT = `You are the Architect Agent generating project structure and dependencies.

PM specification is the source of truth for project scope and technology selection.

STRICT TECHNOLOGY SELECTION CONSTRAINTS:
- You MUST generate folder structure and dependencies matching ONLY the locked technologyConstraints provided by PM.
- If frontend is ["HTML", "CSS", "JavaScript"] (no framework):
  - Do NOT include React, React-DOM, Vue, or Angular dependencies or .jsx files.
  - Dependencies should be empty {} or contain only light tooling (e.g. vite).
- If frontend is ["React"], include react, react-dom, etc.
- If frontend is ["Vue"], include vue, etc.
- If projectType is "frontend_only":
  - backend dependencies MUST be empty object {}.
  - Folder structure MUST contain ONLY frontend files. No backend folder or files.

OUTPUT FORMAT (strict JSON):
{
  "folderStructure": "tree-format string showing every folder and file",
  "dependencies": {
    "backend": {
      "name": "backend",
      "dependencies": {},
      "devDependencies": {}
    },
    "frontend": {
      "name": "frontend",
      "dependencies": {},
      "devDependencies": {}
    }
  }
}

RULES:
- Respect projectType strictly:
  - "frontend_only": backend dependencies MUST BE empty object {}. Folder structure MUST contain ONLY frontend files (src/pages/, src/components/, etc.). No backend folder or files.
  - "backend_only": frontend dependencies MUST BE empty object {}. Folder structure MUST contain ONLY backend files (src/models/, src/routes/, etc.). No frontend folder or files.
  - "full_stack": both backend and frontend dependencies and structure.
- Respect requested technologies in technologyConstraints (e.g., if user specified Tailwind, include tailwindcss; if not, do not force unnecessary libraries).
- EXACT version numbers.`;

export async function architectStep5Node(state) {
  console.log("\n🏗️  [Architect Step 5/5] Generating folder structure & dependencies...\n");

  const { dbSchema, apiEndpoints, frontendPages } = state.blueprint;
  const projectType = state.projectType || state.clarifiedSpec?.projectType || "full_stack";
  const constraints = state.technologyConstraints || state.clarifiedSpec?.technologyConstraints || {};

  const result = await safeCallGemini({
    systemPrompt: STEP5_PROMPT,
    userPrompt: `ProjectType: ${projectType}\nConstraints: ${JSON.stringify(constraints)}\nDB: ${dbSchema?.databaseType} (${dbSchema?.tables?.length || 0} tables)\nAPIs: ${apiEndpoints?.length || 0} endpoints\nPages: ${frontendPages?.length || 0} pages\n\nSpec:\n${JSON.stringify(state.clarifiedSpec, null, 2)}`,
    agentName: "architectStep5",
    currentCost: state.tokenUsage?.estimatedCost || 0,
    tokenBudget: state.tokenBudget,
  });

  if (!result.ok) {
    console.error(`   Architect step 5 failed: ${result.error}`);
    return { error: `Architect step 5 failed: ${result.error}`, tokenUsage: emptyTokenDelta("architectStep5") };
  }

  let output = result.parsed;
  
  // Hard enforcement for frontend_only / backend_only dependencies & framework locks
  const frontendTech = (constraints.frontend || []).map(t => String(t).toLowerCase());
  const isReact = frontendTech.some(t => t.includes("react"));
  const isVue = frontendTech.some(t => t.includes("vue"));

  if (projectType === "frontend_only") {
    if (output.dependencies) {
      output.dependencies.backend = { name: "backend", dependencies: {}, devDependencies: {} };
    }
  } else if (projectType === "backend_only") {
    if (output.dependencies) {
      output.dependencies.frontend = { name: "frontend", dependencies: {}, devDependencies: {} };
    }
  }

  // Remove React dependencies if React was not specified
  if (output.dependencies?.frontend?.dependencies && !isReact) {
    delete output.dependencies.frontend.dependencies["react"];
    delete output.dependencies.frontend.dependencies["react-dom"];
    delete output.dependencies.frontend.dependencies["react-router-dom"];
  }

  console.log(`   Folder structure generated`);
  console.log(`   Backend deps: ${Object.keys(output.dependencies?.backend?.dependencies || {}).length}`);
  console.log(`   Frontend deps: ${Object.keys(output.dependencies?.frontend?.dependencies || {}).length}`);

  return {
    blueprint: {
      folderStructure: output.folderStructure,
      dependencies: output.dependencies,
    },
    tokenUsage: makeTokenDelta("architectStep5", result.tokens),
  };
}
