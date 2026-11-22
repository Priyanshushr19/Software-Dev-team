/**
 * blueprintValidator.js — Blueprint Cross-Validator ⭐ NEW V2
 * 
 * FIRST PRINCIPLES:
 * In the V1 design, the Architect's output went directly to the Planner.
 * Problem: if the Architect designed an API endpoint for a table that 
 * doesn't exist, the Coder would write broken code 10 steps later.
 * 
 * The Blueprint Validator sits BETWEEN Architect and Planner.
 * Its ONLY job: find contradictions in the blueprint BEFORE 
 * any code is written. Catch problems early = save tokens later.
 * 
 * WHAT IT CHECKS:
 * 1. Every API endpoint references a table that exists in the schema
 * 2. Every frontend page calls APIs that actually exist
 * 3. Every foreign key references an existing table and field
 * 4. Every entity from the spec has at least one DB table
 * 5. Auth/role requirements are consistent (API says "admin only" → page respects that)
 * 6. No orphan tables (table exists but no API uses it)
 * 
 * WHY NOT USE LLM FOR THIS?
 * Validation is deterministic logic — comparing strings, checking existence.
 * Using an LLM here would be wasteful and unreliable. 
 * Pure code = 100% accurate, zero tokens, instant execution.
 * 
 * ROUTING:
 * - Valid → goes to Planner
 * - DB issues → routes back to architectStep2
 * - API issues → routes back to architectStep3
 * - Page issues → routes back to architectStep4
 * - Max 2 validation loops, then force proceed with warnings
 */

const MAX_VALIDATION_CYCLES = 2;

/**
 * Normalize an API path:
 * - Trims whitespace
 * - Collapses duplicate slashes (/api//todos -> /api/todos)
 * - Strips trailing slash unless root / (/api/todos/ -> /api/todos)
 */
export function normalizeApiPath(rawPath) {
  if (!rawPath || typeof rawPath !== "string") return "";
  let p = rawPath.trim();
  p = p.replace(/\/+/g, "/");
  if (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  return p;
}

/**
 * Parse an API call reference (string or object) into structured { method, path, raw }:
 * Handles:
 * - "POST /api/auth/register"
 * - "GET /api/todo-items/:id"
 * - "/api/todo-items"
 * - { method: "POST", path: "/api/auth/register" }
 * - { method: "GET", endpoint: "/api/todo-items" }
 * - { url: "/api/todo-items" }
 */
export function parseApiReference(apiRef) {
  if (!apiRef) return null;
  
  if (typeof apiRef === "object") {
    const rawPath = apiRef.path || apiRef.endpoint || apiRef.url || "";
    let rawMethod = apiRef.method ? String(apiRef.method).toUpperCase().trim() : null;
    
    // In case the path inside object itself contains method prefix e.g. "POST /api/auth/register"
    const match = String(rawPath).trim().match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(.+)$/i);
    let finalPath = rawPath;
    if (match) {
      if (!rawMethod) rawMethod = match[1].toUpperCase();
      finalPath = match[2];
    }
    
    return {
      method: rawMethod || null,
      path: normalizeApiPath(finalPath),
      raw: JSON.stringify(apiRef),
    };
  }

  const str = String(apiRef).trim();
  const match = str.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(.+)$/i);
  if (match) {
    return {
      method: match[1].toUpperCase(),
      path: normalizeApiPath(match[2]),
      raw: str,
    };
  }

  return {
    method: null,
    path: normalizeApiPath(str),
    raw: str,
  };
}

/**
 * Blueprint Validator node function
 */
export async function blueprintValidatorNode(state) {
  console.log("\n🔍 [Blueprint Validator] Cross-validating architecture...\n");

  const { dbSchema, apiEndpoints, frontendPages, entities, dependencies } = state.blueprint || {};
  const projectType = state.projectType || state.clarifiedSpec?.projectType || "full_stack";
  const currentCycles = state.blueprintValidation?.validationCycles || 0;

  const issues = [];

  // ─── CHECK 0: Technology Scope Compliance ─────────────────
  const constraints = state.technologyConstraints || state.clarifiedSpec?.technologyConstraints || {};
  const frontendTech = (constraints.frontend || []).map(t => String(t || "").toLowerCase());

  const isReact = frontendTech.some(t => t.includes("react"));
  const isVue = frontendTech.some(t => t.includes("vue"));
  const isHtmlCssJs = frontendTech.some(t => t.includes("html") || t.includes("javascript") || t.includes("css")) && !isReact && !isVue;

  if (isHtmlCssJs && dependencies?.frontend?.dependencies) {
    const depsKeys = Object.keys(dependencies.frontend.dependencies);
    if (depsKeys.includes("react") || depsKeys.includes("react-dom")) {
      issues.push({
        type: "technology_scope_violation",
        severity: "error",
        fixTarget: "architectStep5",
        message: `Frontend stack locked to HTML/CSS/JS but blueprint introduced React dependencies (${depsKeys.filter(k => k.includes("react")).join(", ")}).`,
      });
    }
  }

  if (isVue && dependencies?.frontend?.dependencies) {
    const depsKeys = Object.keys(dependencies.frontend.dependencies);
    if (depsKeys.includes("react") || depsKeys.includes("react-dom")) {
      issues.push({
        type: "technology_scope_violation",
        severity: "error",
        fixTarget: "architectStep5",
        message: `Frontend stack locked to Vue but blueprint introduced React dependencies.`,
      });
    }
  }

  if (projectType === "frontend_only") {
    if (dbSchema?.tables?.length > 0) {
      issues.push({
        type: "technology_scope_violation",
        severity: "error",
        fixTarget: "architectStep2",
        message: `Frontend-only project cannot include database schema/tables (${dbSchema.tables.length} tables found).`,
      });
    }
    if (apiEndpoints?.length > 0) {
      issues.push({
        type: "technology_scope_violation",
        severity: "error",
        fixTarget: "architectStep3",
        message: `Frontend-only project cannot include backend API endpoints (${apiEndpoints.length} endpoints found).`,
      });
    }
    if (dependencies?.backend?.dependencies && Object.keys(dependencies.backend.dependencies).length > 0) {
      issues.push({
        type: "technology_scope_violation",
        severity: "error",
        fixTarget: "architectStep5",
        message: `Frontend-only project cannot include backend dependencies.`,
      });
    }
  } else if (projectType === "backend_only") {
    if (frontendPages?.length > 0) {
      issues.push({
        type: "technology_scope_violation",
        severity: "error",
        fixTarget: "architectStep4",
        message: `Backend-only project cannot include frontend pages (${frontendPages.length} pages found).`,
      });
    }
  }

  // ─── CHECK 1: Every entity has a DB table (skip for frontend_only) ───

  if (projectType !== "frontend_only" && entities && dbSchema?.tables) {
    const tableNames = new Set();
    for (const t of dbSchema.tables || []) {
      const tName = t?.name || t?.tableName;
      if (!t || !tName) continue;
      const name = String(tName).toLowerCase();
      tableNames.add(name);                          // "todo_items"
      tableNames.add(name.replace(/s$/, ""));        // "todo_item"
      tableNames.add(name.replace(/_/g, ""));        // "todoitems"
      tableNames.add(name.replace(/_/g, "").replace(/s$/, "")); // "todoitem"
    }

    for (const entity of entities || []) {
      if (!entity || !entity.name) continue;
      // Convert PascalCase to snake_case: "TodoItem" → "todo_item"
      const snakeName = String(entity.name)
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .toLowerCase();
      const plainName = String(entity.name).toLowerCase(); // "todoitem"

      const hasTable = tableNames.has(plainName) ||
                       tableNames.has(plainName + "s") ||
                       tableNames.has(snakeName) ||
                       tableNames.has(snakeName + "s") ||
                       tableNames.has(snakeName.replace(/y$/, "ie") + "s");
      if (!hasTable) {
        issues.push({
          type: "missing_table",
          severity: "error",
          fixTarget: "architectStep2",
          message: `Entity "${entity.name}" has no matching DB table. Tables: [${(dbSchema.tables || []).map(t => t?.name || t?.tableName || 'unnamed').join(", ")}]`,
        });
      }
    }
  }

  // ─── CHECK 2: Foreign keys reference existing tables ───────

  if (projectType !== "frontend_only" && dbSchema?.tables) {
    const tableNameSet = new Set((dbSchema.tables || []).filter(t => t?.name || t?.tableName).map(t => String(t.name || t.tableName).toLowerCase()));

    for (const table of dbSchema.tables || []) {
      const tName = table?.name || table?.tableName;
      if (!table || !tName) continue;
      if (table.foreignKeys) {
        for (const fk of table.foreignKeys || []) {
          if (!fk || !fk.references) continue;
          // Extract table name from "other_table(field)" format
          const refMatch = String(fk.references).match(/^(\w+)\(/);
          if (refMatch) {
            const refTable = String(refMatch[1]).toLowerCase();
            if (!tableNameSet.has(refTable)) {
              issues.push({
                type: "invalid_foreign_key",
                severity: "error",
                fixTarget: "architectStep2",
                message: `Table "${tName}" has FK referencing "${fk.references}" but table "${refTable}" does not exist.`,
              });
            }
          }
        }
      }
    }
  }

  // ─── CHECK 3: API endpoints reference existing tables ──────

  if (projectType !== "frontend_only" && apiEndpoints && dbSchema?.tables) {
    const tableNameSet = new Set((dbSchema.tables || []).filter(t => t?.name || t?.tableName).map(t => String(t.name || t.tableName).toLowerCase()));

    for (const endpoint of apiEndpoints || []) {
      if (!endpoint) continue;
      if (endpoint.relatedTable) {
        const tables = String(endpoint.relatedTable).split(",").map(t => t.trim().toLowerCase());
        for (const tableName of tables) {
          if (tableName && tableName !== "n/a" && tableName !== "none" && !tableNameSet.has(tableName)) {
            issues.push({
              type: "orphan_endpoint",
              severity: "error",
              fixTarget: "architectStep3",
              message: `API "${endpoint.method || 'GET'} ${endpoint.path}" references table "${tableName}" which doesn't exist.`,
            });
          }
        }
      }
    }
  }

  // ─── CHECK 4: Frontend pages reference existing APIs (Deterministic Contract Match) ───

  if (projectType !== "frontend_only" && frontendPages && apiEndpoints) {
    const backendExactMap = new Map(); // key: `${method} ${normalizedPath}`, val: endpoint
    const backendPathMap = new Map();  // key: `${normalizedPath}`, val: endpoints[]

    for (const ep of apiEndpoints || []) {
      if (!ep || !ep.path) continue;
      const m = (ep.method || "GET").toUpperCase().trim();
      const p = normalizeApiPath(ep.path);
      const key = `${m} ${p}`;
      backendExactMap.set(key, ep);

      if (!backendPathMap.has(p)) {
        backendPathMap.set(p, []);
      }
      backendPathMap.get(p).push(ep);
    }

    for (const page of frontendPages || []) {
      if (!page) continue;
      for (const comp of page.components || []) {
        if (!comp || !comp.apiCalls) continue;
        for (const apiCall of comp.apiCalls || []) {
          if (!apiCall) continue;
          const parsed = parseApiReference(apiCall);
          if (!parsed || !parsed.path) continue;

          const { method, path } = parsed;

          if (method) {
            const exactKey = `${method} ${path}`;
            if (!backendExactMap.has(exactKey)) {
              if (backendPathMap.has(path)) {
                const supportedMethods = backendPathMap.get(path).map(e => (e.method || "GET").toUpperCase());
                issues.push({
                  type: "api_contract_mismatch",
                  severity: "error",
                  fixTarget: "architectStep3",
                  message: `Page "${page.name || 'unnamed'}" → Component "${comp.name || 'unnamed'}" calls "${method} ${path}" but backend endpoint for "${path}" only supports [${supportedMethods.join(", ")}].`,
                });
              } else {
                issues.push({
                  type: "missing_api",
                  severity: "error",
                  fixTarget: "architectStep3",
                  message: `Page "${page.name || 'unnamed'}" → Component "${comp.name || 'unnamed'}" calls "${method} ${path}" but no matching API endpoint exists in backend blueprint.`,
                });
              }
            }
          } else {
            // Path-only check when frontend did not specify HTTP method
            if (!backendPathMap.has(path)) {
              issues.push({
                type: "missing_api",
                severity: "error",
                fixTarget: "architectStep3",
                message: `Page "${page.name || 'unnamed'}" → Component "${comp.name || 'unnamed'}" calls "${path}" but no matching API endpoint exists in backend blueprint.`,
              });
            }
          }
        }
      }
    }
  }

  // ─── CHECK 5: Auth consistency ─────────────────────────────

  if (projectType !== "frontend_only" && apiEndpoints && frontendPages) {
    const authEndpointKeys = new Set();
    for (const ep of apiEndpoints || []) {
      if (ep && ep.requiresAuth && ep.path) {
        const m = (ep.method || "GET").toUpperCase().trim();
        const p = normalizeApiPath(ep.path);
        authEndpointKeys.add(`${m} ${p}`);
        authEndpointKeys.add(p);
      }
    }

    for (const page of frontendPages || []) {
      if (!page) continue;
      for (const comp of page.components || []) {
        if (!comp || !comp.apiCalls) continue;
        const callsAuthApi = (comp.apiCalls || []).some(c => {
          const parsed = parseApiReference(c);
          if (!parsed || !parsed.path) return false;
          if (parsed.method && authEndpointKeys.has(`${parsed.method} ${parsed.path}`)) return true;
          return authEndpointKeys.has(parsed.path);
        });

        if (callsAuthApi && !page.requiresAuth) {
          issues.push({
            type: "auth_mismatch",
            severity: "warning",
            fixTarget: "architectStep4",
            message: `Page "${page.name || 'unnamed'}" calls auth-required API but page.requiresAuth is false.`,
          });
        }
      }
    }
  }

  // ─── CHECK 6: No orphan tables ─────────────────────────────

  if (projectType !== "frontend_only" && dbSchema?.tables && apiEndpoints) {
    const referencedTables = new Set();
    for (const ep of apiEndpoints || []) {
      if (ep && ep.relatedTable) {
        String(ep.relatedTable).split(",").forEach(t => {
          const tbl = t.trim().toLowerCase();
          if (tbl && tbl !== "n/a" && tbl !== "none") {
            referencedTables.add(tbl);
          }
        });
      }
    }

    for (const table of dbSchema.tables || []) {
      const tName = table?.name || table?.tableName;
      if (!table || !tName) continue;
      // Skip junction/join tables and common system tables
      const name = String(tName).toLowerCase();
      const isJunction = name.includes("_") && !["created_at", "updated_at"].some(f => name.includes(f));
      
      if (!referencedTables.has(name) && !isJunction) {
        issues.push({
          type: "orphan_table",
          severity: "warning",
          fixTarget: "architectStep3",
          message: `Table "${tName}" exists but no API endpoint references it. Either add endpoints or remove the table.`,
        });
      }
    }
  }

  // ─── DECIDE: Valid or route back ───────────────────────────

  const errors = issues.filter(i => i.severity === "error");
  const warnings = issues.filter(i => i.severity === "warning");

  if (issues.length === 0) {
    console.log("   ✅ Blueprint is VALID — all cross-checks passed!");
    return {
      blueprintValidation: {
        isValid: true,
        status: "PASSED",
        issues: [],
        validationFeedback: [],
        validationCycles: currentCycles + 1,
      },
      currentPhase: "planner",
    };
  }

  // If we've exceeded max validation cycles
  if (currentCycles >= MAX_VALIDATION_CYCLES) {
    if (errors.length === 0) {
      console.log(`   ⚠️ Max validation cycles (${MAX_VALIDATION_CYCLES}) reached with 0 errors. Proceeding with warnings.`);
      warnings.forEach(w => console.log(`   ⚠️ ${w.message}`));
      return {
        blueprintValidation: {
          isValid: true,
          status: "PASSED_WITH_WARNINGS",
          issues: issues,
          validationFeedback: issues,
          validationCycles: currentCycles + 1,
        },
        currentPhase: "planner",
      };
    } else {
      console.log(`   🛑 Max validation cycles (${MAX_VALIDATION_CYCLES}) reached with ${errors.length} blocking errors. Validation BLOCKED.`);
      issues.forEach(i => console.log(`   ${i.severity === "error" ? "❌" : "⚠️"} ${i.message}`));
      return {
        blueprintValidation: {
          isValid: false,
          status: "BLOCKED",
          issues: issues,
          validationFeedback: issues,
          validationCycles: currentCycles + 1,
        },
      };
    }
  }

  // Route back to the right architect step
  console.log(`   ❌ Found ${errors.length} errors, ${warnings.length} warnings (cycle ${currentCycles + 1}/${MAX_VALIDATION_CYCLES})`);
  issues.forEach(i => console.log(`   ${i.severity === "error" ? "❌" : "⚠️"} ${i.message}`));

  return {
    blueprintValidation: {
      isValid: false,
      status: "FAILED",
      issues: issues,
      validationFeedback: issues,
      validationCycles: currentCycles + 1,
    },
  };
}

/**
 * Determine which architect step to route back to based on issues.
 * Used as a conditional edge function.
 */
export function blueprintValidatorRouter(state) {
  const validation = state.blueprintValidation;

  if (validation?.isValid) {
    return "__end__"; // Phase 2 ends here. Phase 3 will route to planner.
  }

  // If blocked after max cycles, return __end__ to halt
  if ((validation?.validationCycles || 0) > MAX_VALIDATION_CYCLES && !validation?.isValid) {
    console.warn("   🛑 Blueprint validation blocked after max cycles. Routing to __end__ with failure state.");
    return "__end__";
  }

  // Find the highest-priority fix target from errors first
  const errors = validation?.issues?.filter(i => i.severity === "error") || [];
  
  if (errors.length > 0) {
    const target = errors[0].fixTarget;
    console.log(`   🔄 Routing back to ${target} for fixes...\n`);
    return target;
  }

  // Only warnings — route to the most common fix target
  const targets = (validation?.issues || []).map(i => i.fixTarget).filter(Boolean);
  const targetCounts = {};
  targets.forEach(t => { targetCounts[t] = (targetCounts[t] || 0) + 1; });
  const topTarget = Object.entries(targetCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

  if (topTarget) {
    console.log(`   🔄 Routing back to ${topTarget} for fixes...\n`);
    return topTarget;
  }

  return "__end__";
}
