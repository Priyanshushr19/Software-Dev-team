/**
 * test-validator.js — Test Blueprint Validator (no API needed)
 * 
 * Run: node tests/test-validator.js
 * 
 * Tests the validator with INTENTIONALLY BROKEN blueprints.
 * No Gemini API needed — pure logic test.
 * 
 * Verifies:
 * 1. Catches missing tables for entities
 * 2. Catches invalid foreign keys
 * 3. Catches orphan API endpoints (reference non-existent tables)
 * 4. Catches pages calling non-existent APIs
 * 5. Catches auth mismatches
 * 6. Passes a clean blueprint with zero issues
 * 7. Force proceeds after max validation cycles
 */

import {
  blueprintValidatorNode,
  blueprintValidatorRouter,
} from "../src/agents/blueprintValidator.js";

console.log("\n🧪 TEST: Blueprint Validator (No API needed)\n");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { console.log(`  ✅ PASS: ${message}`); passed++; }
  else { console.log(`  ❌ FAIL: ${message}`); failed++; }
}

// ─── TEST 1: Catches missing table ──────────────────────────

async function test1() {
  console.log("  ─── Test 1: Missing table for entity ───\n");

  const state = {
    blueprint: {
      entities: [
        { name: "User", description: "A user" },
        { name: "Task", description: "A task" },
        { name: "Comment", description: "A comment" }, // No table for this!
      ],
      dbSchema: {
        databaseType: "PostgreSQL",
        tables: [
          { name: "users", fields: [{ name: "id" }], foreignKeys: [] },
          { name: "tasks", fields: [{ name: "id" }], foreignKeys: [] },
          // No "comments" table!
        ],
      },
      apiEndpoints: [],
      frontendPages: [],
    },
    blueprintValidation: { isValid: false, issues: [], validationCycles: 0 },
  };

  const result = await blueprintValidatorNode(state);
  const hasIssue = result.blueprintValidation.issues.some(i => 
    i.type === "missing_table" && i.message.includes("Comment")
  );
  assert(hasIssue, "Detected missing table for 'Comment' entity");
}

// ─── TEST 2: Catches invalid foreign key ────────────────────

async function test2() {
  console.log("\n  ─── Test 2: Invalid foreign key ───\n");

  const state = {
    blueprint: {
      entities: [],
      dbSchema: {
        databaseType: "PostgreSQL",
        tables: [
          {
            name: "tasks",
            fields: [{ name: "id" }, { name: "category_id" }],
            foreignKeys: [
              { field: "category_id", references: "ghost_table(id)", onDelete: "CASCADE" },
            ],
          },
        ],
      },
      apiEndpoints: [],
      frontendPages: [],
    },
    blueprintValidation: { isValid: false, issues: [], validationCycles: 0 },
  };

  const result = await blueprintValidatorNode(state);
  const hasIssue = result.blueprintValidation.issues.some(i => 
    i.type === "invalid_foreign_key" && i.message.includes("ghost_table")
  );
  assert(hasIssue, "Detected FK referencing non-existent table 'ghost_table'");
}

// ─── TEST 3: Catches orphan endpoint ────────────────────────

async function test3() {
  console.log("\n  ─── Test 3: Orphan API endpoint ───\n");

  const state = {
    blueprint: {
      entities: [],
      dbSchema: {
        databaseType: "PostgreSQL",
        tables: [
          { name: "users", fields: [{ name: "id" }], foreignKeys: [] },
        ],
      },
      apiEndpoints: [
        { method: "GET", path: "/api/tasks", relatedTable: "tasks", requiresAuth: true },
        // "tasks" table doesn't exist!
      ],
      frontendPages: [],
    },
    blueprintValidation: { isValid: false, issues: [], validationCycles: 0 },
  };

  const result = await blueprintValidatorNode(state);
  const hasIssue = result.blueprintValidation.issues.some(i => 
    i.type === "orphan_endpoint" && i.message.includes("tasks")
  );
  assert(hasIssue, "Detected API endpoint referencing non-existent table 'tasks'");
}

// ─── TEST 4: Passes a clean blueprint ───────────────────────

async function test4() {
  console.log("\n  ─── Test 4: Clean blueprint passes ───\n");

  const state = {
    blueprint: {
      entities: [
        { name: "User", description: "A user" },
        { name: "Task", description: "A task" },
      ],
      dbSchema: {
        databaseType: "PostgreSQL",
        tables: [
          {
            name: "users",
            fields: [{ name: "id" }, { name: "email" }],
            foreignKeys: [],
          },
          {
            name: "tasks",
            fields: [{ name: "id" }, { name: "user_id" }],
            foreignKeys: [{ field: "user_id", references: "users(id)", onDelete: "CASCADE" }],
          },
        ],
      },
      apiEndpoints: [
        { method: "GET", path: "/api/users", relatedTable: "users", requiresAuth: true },
        { method: "GET", path: "/api/tasks", relatedTable: "tasks", requiresAuth: true },
      ],
      frontendPages: [
        {
          name: "Dashboard",
          route: "/dashboard",
          requiresAuth: true,
          components: [
            { name: "TaskList", description: "Shows tasks", apiCalls: ["GET /api/tasks"] },
          ],
        },
      ],
    },
    blueprintValidation: { isValid: false, issues: [], validationCycles: 0 },
  };

  const result = await blueprintValidatorNode(state);
  assert(result.blueprintValidation.isValid === true, "Clean blueprint passes validation");
  assert(
    result.blueprintValidation.issues.length === 0,
    `Zero issues found (got ${result.blueprintValidation.issues.length})`
  );
}

// ─── TEST 5: Mandatory Test 1 — Full-stack Todo App (React + Express + MongoDB) ───

async function test5() {
  console.log("\n  ─── Test 5: Full-stack Todo App (React + Express + MongoDB) ───\n");

  const state = {
    projectType: "full_stack",
    technologyConstraints: {
      frontend: ["React"],
      backend: ["Node.js", "Express"],
      database: ["MongoDB"],
    },
    blueprint: {
      entities: [
        { name: "User", tableName: "users", apiPath: "/api/auth" },
        { name: "TodoItem", tableName: "todo_items", apiPath: "/api/todo-items" },
      ],
      dbSchema: {
        databaseType: "MongoDB",
        tables: [
          { name: "users", fields: [{ name: "id" }, { name: "email" }, { name: "password_hash" }] },
          { name: "todo_items", fields: [{ name: "id" }, { name: "title" }, { name: "user_id" }] },
        ],
      },
      apiEndpoints: [
        { method: "POST", path: "/api/auth/register", relatedTable: "users", requiresAuth: false },
        { method: "POST", path: "/api/auth/login", relatedTable: "users", requiresAuth: false },
        { method: "GET", path: "/api/todo-items", relatedTable: "todo_items", requiresAuth: true },
        { method: "POST", path: "/api/todo-items", relatedTable: "todo_items", requiresAuth: true },
        { method: "PUT", path: "/api/todo-items/:id", relatedTable: "todo_items", requiresAuth: true },
        { method: "DELETE", path: "/api/todo-items/:id", relatedTable: "todo_items", requiresAuth: true },
      ],
      frontendPages: [
        {
          name: "AuthPage",
          route: "/auth",
          requiresAuth: false,
          components: [
            { name: "AuthForm", apiCalls: ["POST /api/auth/register", "POST /api/auth/login"] },
          ],
        },
        {
          name: "TodoDashboard",
          route: "/todos",
          requiresAuth: true,
          components: [
            {
              name: "TodoList",
              apiCalls: [
                "GET /api/todo-items",
                "POST /api/todo-items",
                "PUT /api/todo-items/:id",
                "DELETE /api/todo-items/:id",
              ],
            },
          ],
        },
      ],
    },
    blueprintValidation: { isValid: false, issues: [], validationCycles: 0 },
  };

  const result = await blueprintValidatorNode(state);
  assert(result.blueprintValidation.isValid === true, "Full-stack Todo blueprint is VALID with 0 mismatches");
  assert(result.blueprintValidation.issues.length === 0, "No warnings or errors produced for matching API contract");
  assert(result.currentPhase === "planner", "Phase transitioned to planner");
}

// ─── TEST 6: Mandatory Test 2 — Exact Matching Pairs ───────

async function test6() {
  console.log("\n  ─── Test 6: Matching API pairs verification ───\n");

  const pairs = [
    { method: "POST", path: "/api/auth/register" },
    { method: "POST", path: "/api/auth/login" },
    { method: "GET", path: "/api/todo-items" },
    { method: "POST", path: "/api/todo-items" },
    { method: "PUT", path: "/api/todo-items/:id" },
    { method: "DELETE", path: "/api/todo-items/:id" },
  ];

  const state = {
    projectType: "full_stack",
    blueprint: {
      entities: [
        { name: "User", tableName: "users" },
        { name: "TodoItem", tableName: "todo_items" },
      ],
      dbSchema: {
        databaseType: "PostgreSQL",
        tables: [
          { name: "users", fields: [{ name: "id" }] },
          { name: "todo_items", fields: [{ name: "id" }] },
        ],
      },
      apiEndpoints: pairs.map(p => ({
        method: p.method,
        path: p.path,
        relatedTable: p.path.includes("auth") ? "users" : "todo_items",
        requiresAuth: !p.path.includes("auth"),
      })),
      frontendPages: [
        {
          name: "MainPage",
          route: "/",
          requiresAuth: true,
          components: [
            {
              name: "AllInOne",
              apiCalls: pairs.map(p => `${p.method} ${p.path}`),
            },
          ],
        },
      ],
    },
    blueprintValidation: { isValid: false, issues: [], validationCycles: 0 },
  };

  const result = await blueprintValidatorNode(state);
  assert(result.blueprintValidation.isValid === true, "All 6 standard contract pairs matched perfectly");
  assert(result.blueprintValidation.issues.length === 0, "Zero contract issues reported for pairs");
}

// ─── TEST 7: Mandatory Test 3 — Parameter Mismatch Detection (:idd vs :id) ───

async function test7() {
  console.log("\n  ─── Test 7: Parameter mismatch detection (:idd vs :id) ───\n");

  const state = {
    projectType: "full_stack",
    blueprint: {
      entities: [{ name: "TodoItem", tableName: "todo_items" }],
      dbSchema: {
        databaseType: "PostgreSQL",
        tables: [{ name: "todo_items", fields: [{ name: "id" }] }],
      },
      apiEndpoints: [
        { method: "PUT", path: "/api/todo-items/:id", relatedTable: "todo_items", requiresAuth: true },
      ],
      frontendPages: [
        {
          name: "Dashboard",
          route: "/dashboard",
          requiresAuth: true,
          components: [
            { name: "EditTodo", apiCalls: ["PUT /api/todo-items/:idd"] }, // :idd does NOT match :id!
          ],
        },
      ],
    },
    blueprintValidation: { isValid: false, issues: [], validationCycles: 0 },
  };

  const result = await blueprintValidatorNode(state);
  assert(result.blueprintValidation.isValid === false, "Validator correctly rejected :idd parameter mismatch");
  const mismatchIssue = result.blueprintValidation.issues.find(i => i.type === "missing_api" && i.message.includes(":idd"));
  assert(Boolean(mismatchIssue), "Detected exact mismatch issue for PUT /api/todo-items/:idd");
  assert(mismatchIssue?.severity === "error", "Missing API is treated as a blocking error");
  assert(mismatchIssue?.fixTarget === "architectStep3", "Fix target is architectStep3");
}

// ─── TEST 8: Mandatory Test 4 — Formatting Normalization (Double slashes & trailing slashes) ───

async function test8() {
  console.log("\n  ─── Test 8: Formatting Normalization (// and trailing /) ───\n");

  const state = {
    projectType: "full_stack",
    blueprint: {
      entities: [{ name: "TodoItem", tableName: "todo_items" }],
      dbSchema: {
        databaseType: "PostgreSQL",
        tables: [{ name: "todo_items", fields: [{ name: "id" }] }],
      },
      apiEndpoints: [
        { method: "DELETE", path: "/api/todo-items/:id", relatedTable: "todo_items", requiresAuth: true },
        { method: "POST", path: "/api/todo-items", relatedTable: "todo_items", requiresAuth: true },
      ],
      frontendPages: [
        {
          name: "Dashboard",
          route: "/dashboard",
          requiresAuth: true,
          components: [
            {
              name: "TodoList",
              apiCalls: [
                "DELETE /api/todo-items//:id", // Duplicate slash normalized
                "POST /api/todo-items/",      // Trailing slash normalized
              ],
            },
          ],
        },
      ],
    },
    blueprintValidation: { isValid: false, issues: [], validationCycles: 0 },
  };

  const result = await blueprintValidatorNode(state);
  assert(result.blueprintValidation.isValid === true, "Harmless formatting (// and trailing /) normalized cleanly");
  assert(result.blueprintValidation.issues.length === 0, "Zero issues after formatting normalization");
}

// ─── TEST 9: Mandatory Test 5 — Frontend-only React project ───

async function test9() {
  console.log("\n  ─── Test 9: Frontend-only React project ───\n");

  const state = {
    projectType: "frontend_only",
    technologyConstraints: {
      frontend: ["React"],
      backend: [],
      database: [],
    },
    blueprint: {
      entities: [{ name: "Calculator", tableName: "N/A", apiPath: "N/A" }],
      dbSchema: { databaseType: "none", tables: [] },
      apiEndpoints: [],
      frontendPages: [
        {
          name: "CalculatorPage",
          route: "/",
          requiresAuth: false,
          components: [
            { name: "Calculator", apiCalls: [] },
          ],
        },
      ],
    },
    blueprintValidation: { isValid: false, issues: [], validationCycles: 0 },
  };

  const result = await blueprintValidatorNode(state);
  assert(result.blueprintValidation.isValid === true, "Frontend-only project passes validation without backend APIs");
  assert(result.blueprintValidation.issues.length === 0, "Zero errors or warnings for frontend-only project");
}

// ─── TEST 10: Blocking error after max validation cycles ─────

async function test10() {
  console.log("\n  ─── Test 10: Blocking error after max validation cycles ───\n");

  const state = {
    projectType: "full_stack",
    blueprint: {
      entities: [{ name: "Ghost", description: "No table" }],
      dbSchema: { databaseType: "PostgreSQL", tables: [] },
      apiEndpoints: [],
      frontendPages: [],
    },
    blueprintValidation: { isValid: false, issues: [], validationCycles: 2 }, // Max cycles reached
  };

  const result = await blueprintValidatorNode(state);
  assert(result.blueprintValidation.isValid === false, "Blocking error halts graph (isValid is false)");
  assert(result.blueprintValidation.status === "BLOCKED", "Validation status is BLOCKED");
  assert(result.currentPhase !== "planner", "Did NOT proceed to planner phase with blocking errors");
}

// ─── TEST 11: Router returns correct targets ─────────────────

async function test11() {
  console.log("\n  ─── Test 11: Router returns correct targets ───\n");

  const validState = {
    blueprintValidation: { isValid: true, issues: [] },
  };
  assert(blueprintValidatorRouter(validState) === "__end__", "Valid → __end__");

  const dbErrorState = {
    blueprintValidation: {
      isValid: false,
      issues: [{ severity: "error", fixTarget: "architectStep2", message: "DB issue" }],
    },
  };
  assert(blueprintValidatorRouter(dbErrorState) === "architectStep2", "DB error → architectStep2");

  const apiErrorState = {
    blueprintValidation: {
      isValid: false,
      issues: [{ severity: "error", fixTarget: "architectStep3", message: "API issue" }],
    },
  };
  assert(blueprintValidatorRouter(apiErrorState) === "architectStep3", "API error → architectStep3");

  const pageErrorState = {
    blueprintValidation: {
      isValid: false,
      issues: [{ severity: "warning", fixTarget: "architectStep4", message: "Page issue" }],
    },
  };
  assert(blueprintValidatorRouter(pageErrorState) === "architectStep4", "Page warning → architectStep4");
}

// ─── RUN ALL ─────────────────────────────────────────────────

async function runAll() {
  await test1();
  await test2();
  await test3();
  await test4();
  await test5();
  await test6();
  await test7();
  await test8();
  await test9();
  await test10();
  await test11();

  console.log(`\n  ─── Summary: ${passed} passed, ${failed} failed ───\n`);
  if (failed > 0) process.exit(1);
}

runAll().catch((err) => {
  console.error("  ❌ Test failed:", err.message);
  console.error(err.stack);
  process.exit(1);
});
