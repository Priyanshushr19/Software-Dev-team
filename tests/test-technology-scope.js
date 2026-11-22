/**
 * test-technology-scope.js — Comprehensive Test Suite for Technology Scope Constraints
 * Run: node tests/test-technology-scope.js
 */

import "dotenv/config";
import { initGemini } from "../src/utils/gemini.js";
import { pmAgentNode } from "../src/agents/pmAgent.js";
import {
  architectStep1Node,
  architectStep2Node,
  architectStep3Node,
  architectStep4Node,
  architectStep5Node,
} from "../src/agents/architectAgent.js";
import { blueprintValidatorNode } from "../src/agents/blueprintValidator.js";
import { plannerAgentNode } from "../src/agents/plannerAgent.js";
import { coderAgentNode } from "../src/agents/coderAgent.js";

console.log("\n🧪 TEST SUITE: Technology Scope & Constraint Enforcement\n");

let passed = 0;
let failed = 0;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  try {
    initGemini(process.env.GEMINI_API_KEY);
    console.log(`  ✅ Gemini initialized (${process.env.GEMINI_MODEL || "gemini-2.5-flash"})\n`);
  } catch (error) {
    console.warn(`  ⚠️ Gemini API Key not set: running rule & state unit tests without live LLM where possible`);
  }

  const hasApiKey = Boolean(process.env.GEMINI_API_KEY);

  // ─── TEST 1: PM Agent for "Build a calculator using React, HTML and CSS." ───
  console.log("─── TEST 1: React Calculator Scope ───");
  if (hasApiKey) {
    const pmState1 = {
      userRequirement: "Build a calculator using React, HTML and CSS.",
      pmStatus: "idle",
      pmQuestions: [],
      pmConversation: [],
      tokenUsage: { calls: [], totalInput: 0, totalOutput: 0, estimatedCost: 0 },
      tokenBudget: 2.0,
    };
    const pmRes1 = await pmAgentNode(pmState1);
    assert(pmRes1.projectType === "frontend_only", `projectType is "frontend_only" (got ${pmRes1.projectType})`);
    assert(
      (pmRes1.technologyConstraints?.backend || []).length === 0,
      "backend constraint is empty []"
    );
    assert(
      (pmRes1.technologyConstraints?.database || []).length === 0,
      "database constraint is empty []"
    );
  } else {
    console.log("  ℹ️ Skipped live LLM call (no GEMINI_API_KEY)");
  }

  // ─── TEST 2: PM Agent for "Build a landing page using HTML, CSS and JavaScript." ───
  console.log("\n─── TEST 2: HTML/CSS/JS Landing Page Scope ───");
  if (hasApiKey) {
    const pmState2 = {
      userRequirement: "Build a landing page using HTML, CSS and JavaScript.",
      pmStatus: "idle",
      pmQuestions: [],
      pmConversation: [],
      tokenUsage: { calls: [], totalInput: 0, totalOutput: 0, estimatedCost: 0 },
      tokenBudget: 2.0,
    };
    await sleep(2000);
    const pmRes2 = await pmAgentNode(pmState2);
    assert(pmRes2.projectType === "frontend_only", `projectType is "frontend_only" (got ${pmRes2.projectType})`);
    assert(
      (pmRes2.technologyConstraints?.backend || []).length === 0,
      "backend constraint is empty []"
    );
    assert(
      (pmRes2.technologyConstraints?.database || []).length === 0,
      "database constraint is empty []"
    );
  } else {
    console.log("  ℹ️ Skipped live LLM call (no GEMINI_API_KEY)");
  }

  // ─── TEST 3: PM Agent for "Build an Express REST API." ───
  console.log("\n─── TEST 3: Express REST API Scope ───");
  if (hasApiKey) {
    const pmState3 = {
      userRequirement: "Build an Express REST API.",
      pmStatus: "idle",
      pmQuestions: [],
      pmConversation: [],
      tokenUsage: { calls: [], totalInput: 0, totalOutput: 0, estimatedCost: 0 },
      tokenBudget: 2.0,
    };
    await sleep(2000);
    const pmRes3 = await pmAgentNode(pmState3);
    assert(pmRes3.projectType === "backend_only", `projectType is "backend_only" (got ${pmRes3.projectType})`);
    assert(
      (pmRes3.technologyConstraints?.frontend || []).length === 0,
      "frontend constraint is empty []"
    );
  } else {
    console.log("  ℹ️ Skipped live LLM call (no GEMINI_API_KEY)");
  }

  // ─── TEST 4: PM Agent for "Build a React + Express + PostgreSQL task manager." ───
  console.log("\n─── TEST 4: Full-Stack Scope ───");
  if (hasApiKey) {
    const pmState4 = {
      userRequirement: "Build a React + Express + PostgreSQL task manager.",
      pmStatus: "idle",
      pmQuestions: [],
      pmConversation: [],
      tokenUsage: { calls: [], totalInput: 0, totalOutput: 0, estimatedCost: 0 },
      tokenBudget: 2.0,
    };
    await sleep(2000);
    const pmRes4 = await pmAgentNode(pmState4);
    assert(pmRes4.projectType === "full_stack", `projectType is "full_stack" (got ${pmRes4.projectType})`);
  } else {
    console.log("  ℹ️ Skipped live LLM call (no GEMINI_API_KEY)");
  }

  // ─── TEST 5: Explicit "Do not use any backend" constraint ───
  console.log("\n─── TEST 5: Explicit 'Do not use any backend' ───");
  if (hasApiKey) {
    const pmState5 = {
      userRequirement: "Use React and Tailwind CSS. Do not use any backend.",
      pmStatus: "idle",
      pmQuestions: [],
      pmConversation: [],
      tokenUsage: { calls: [], totalInput: 0, totalOutput: 0, estimatedCost: 0 },
      tokenBudget: 2.0,
    };
    await sleep(2000);
    const pmRes5 = await pmAgentNode(pmState5);
    assert(pmRes5.projectType === "frontend_only", `projectType is "frontend_only" (got ${pmRes5.projectType})`);
    assert((pmRes5.technologyConstraints?.backend || []).length === 0, "No backend in tech constraints");
  } else {
    console.log("  ℹ️ Skipped live LLM call (no GEMINI_API_KEY)");
  }

  // ─── TEST 6: Planner does not generate backend tasks for frontend_only ───
  console.log("\n─── TEST 6: Planner Task Generation for frontend_only ───");
  const plannerState = {
    projectType: "frontend_only",
    technologyConstraints: { frontend: ["React", "HTML", "CSS"], backend: [], database: [], other: [] },
    clarifiedSpec: { appName: "CalculatorApp", projectType: "frontend_only" },
    blueprint: {
      dbSchema: { databaseType: "none", tables: [] },
      apiEndpoints: [],
      frontendPages: [{ name: "CalculatorPage", route: "/" }],
      dependencies: { frontend: { dependencies: { react: "^18.2.0" } } },
    },
    tokenUsage: { calls: [], totalInput: 0, totalOutput: 0, estimatedCost: 0 },
    tokenBudget: 2.0,
  };

  if (hasApiKey) {
    const planRes = await plannerAgentNode(plannerState);
    const allTasks = (planRes.taskQueue?.phases || []).flatMap(p => p.tasks || []);
    const backendFiles = allTasks.flatMap(t => t.filesToCreate || []).filter(f => f.startsWith("backend/"));
    assert(backendFiles.length === 0, `0 backend files created in planner (got ${backendFiles.length})`);
  } else {
    console.log("  ℹ️ Skipped live LLM call (no GEMINI_API_KEY)");
  }

  // ─── TEST 7: Architect Step 2 and 3 skip LLM calls for frontend_only ───
  console.log("\n─── TEST 7 & 9: Architect DB & API LLM Skip for frontend_only ───");
  const archState = {
    projectType: "frontend_only",
    clarifiedSpec: { appName: "Calculator", projectType: "frontend_only", databaseRecommendation: "none" },
    blueprint: { entities: [{ name: "Calculator", tableName: "calculators", apiPath: "/api/calculators" }] },
    tokenUsage: { calls: [], totalInput: 0, totalOutput: 0, estimatedCost: 0 },
  };

  const step2Res = await architectStep2Node(archState);
  assert(step2Res.blueprint?.dbSchema?.databaseType === "none", "Step 2 returns databaseType: 'none'");
  assert((step2Res.tokenUsage?.addedInput || 0) === 0 && (step2Res.tokenUsage?.addedCost || 0) === 0, "Step 2 used 0 LLM tokens (skipped)");

  const step3Res = await architectStep3Node(archState);
  assert(step3Res.blueprint?.apiEndpoints?.length === 0, "Step 3 returns empty apiEndpoints []");
  assert((step3Res.tokenUsage?.addedInput || 0) === 0 && (step3Res.tokenUsage?.addedCost || 0) === 0, "Step 3 used 0 LLM tokens (skipped)");

  // ─── TEST 8: Blueprint Validator catches scope violations ───
  console.log("\n─── TEST 8: Blueprint Validator Scope Check ───");
  const invalidBlueprintState = {
    projectType: "frontend_only",
    blueprint: {
      dbSchema: { databaseType: "PostgreSQL", tables: [{ name: "users" }] },
      apiEndpoints: [{ method: "GET", path: "/api/users" }],
      dependencies: { backend: { dependencies: { express: "^4.18.2" } } },
    },
    blueprintValidation: { validationCycles: 0 },
  };

  const valRes = await blueprintValidatorNode(invalidBlueprintState);
  assert(valRes.blueprintValidation?.isValid === false, "Validator rejects blueprint with DB & API in frontend_only");
  assert(
    valRes.blueprintValidation?.issues?.some(i => i.type === "technology_scope_violation"),
    "Validator returns technology_scope_violation issues"
  );

  console.log(`\n═════════════════════════════════════════════════`);
  console.log(` SUMMARY: ${passed} passed, ${failed} failed`);
  console.log(`═════════════════════════════════════════════════\n`);

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error("❌ Test runner error:", err);
  process.exit(1);
});
