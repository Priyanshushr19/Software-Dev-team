/**
 * test-user-technology-lock.js — Test suite verifying strict user technology locking across pipeline
 * Run: node tests/test-user-technology-lock.js
 */

import "dotenv/config";
import { architectStep2Node, architectStep3Node, architectStep5Node } from "../src/agents/architectAgent.js";
import { blueprintValidatorNode } from "../src/agents/blueprintValidator.js";

console.log("\n🧪 TEST SUITE: Technology Lock & Propagation Across Pipeline\n");

let passed = 0;
let failed = 0;

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
  // ─── CASE 1: React-only Frontend ───
  console.log("─── CASE 1: React-only Frontend ('Build a calculator using React.') ───");
  const case1State = {
    projectType: "frontend_only",
    technologyConstraints: { frontend: ["React"], backend: [], database: [], other: [] },
    clarifiedSpec: {
      appName: "react-calc",
      projectType: "frontend_only",
      technologyConstraints: { frontend: ["React"], backend: [], database: [], other: [] },
    },
    blueprint: { entities: [{ name: "Calculator", tableName: "calculators", apiPath: "/api/calculators" }] },
    tokenUsage: { calls: [], totalInput: 0, totalOutput: 0, estimatedCost: 0 },
  };

  const c1Step2 = await architectStep2Node(case1State);
  assert(c1Step2.blueprint.dbSchema.databaseType === "none", "Case 1: Step 2 DB skipped ('none')");

  const c1Step3 = await architectStep3Node(case1State);
  assert(c1Step3.blueprint.apiEndpoints.length === 0, "Case 1: Step 3 APIs skipped ([])");

  // ─── CASE 2: HTML/CSS/JS Frontend ───
  console.log("\n─── CASE 2: HTML/CSS/JS Frontend ('Build a calculator using HTML, CSS and JavaScript.') ───");
  const case2State = {
    projectType: "frontend_only",
    technologyConstraints: { frontend: ["HTML", "CSS", "JavaScript"], backend: [], database: [], other: [] },
    clarifiedSpec: {
      appName: "js-calc",
      projectType: "frontend_only",
      technologyConstraints: { frontend: ["HTML", "CSS", "JavaScript"], backend: [], database: [], other: [] },
    },
    blueprint: {
      dbSchema: { databaseType: "none", tables: [] },
      apiEndpoints: [],
      dependencies: {
        backend: { dependencies: {} },
        frontend: { dependencies: { "react": "^18.2.0" } }, // Invalid React dependency inserted
      },
    },
    blueprintValidation: { validationCycles: 0 },
  };

  const c2Val = await blueprintValidatorNode(case2State);
  assert(c2Val.blueprintValidation.isValid === false, "Case 2: Validator catches illegal React injection in HTML/CSS/JS project");
  assert(
    c2Val.blueprintValidation.issues.some(i => i.message.includes("HTML/CSS/JS but blueprint introduced React")),
    "Case 2: Specific scope violation message emitted"
  );

  // ─── CASE 3: Vue + Tailwind Frontend ───
  console.log("\n─── CASE 3: Vue + Tailwind Frontend ('Build a frontend using Vue and Tailwind.') ───");
  const case3State = {
    projectType: "frontend_only",
    technologyConstraints: { frontend: ["Vue", "Tailwind CSS"], backend: [], database: [], other: [] },
    clarifiedSpec: {
      appName: "vue-app",
      projectType: "frontend_only",
      technologyConstraints: { frontend: ["Vue", "Tailwind CSS"], backend: [], database: [], other: [] },
    },
    blueprint: {
      dbSchema: { databaseType: "none", tables: [] },
      apiEndpoints: [],
      dependencies: {
        backend: { dependencies: {} },
        frontend: { dependencies: { "react": "^18.2.0" } },
      },
    },
    blueprintValidation: { validationCycles: 0 },
  };

  const c3Val = await blueprintValidatorNode(case3State);
  assert(c3Val.blueprintValidation.isValid === false, "Case 3: Validator catches illegal React injection in Vue project");

  // ─── CASE 4: React + Express + MongoDB Full-Stack ───
  console.log("\n─── CASE 4: React + Express + MongoDB Full-Stack ───");
  const case4State = {
    projectType: "full_stack",
    technologyConstraints: { frontend: ["React"], backend: ["Express"], database: ["MongoDB"], other: [] },
    clarifiedSpec: {
      appName: "fullstack-taskmanager",
      projectType: "full_stack",
      technologyConstraints: { frontend: ["React"], backend: ["Express"], database: ["MongoDB"], other: [] },
    },
    blueprint: {
      entities: [{ name: "Task", tableName: "tasks", apiPath: "/api/tasks" }],
      dbSchema: { databaseType: "MongoDB", tables: [{ name: "tasks", fields: [{ name: "_id", type: "ObjectId" }] }] },
      apiEndpoints: [{ method: "GET", path: "/api/tasks", relatedTable: "tasks" }],
      dependencies: {
        backend: { dependencies: { express: "^4.18.2", mongoose: "^8.0.0" } },
        frontend: { dependencies: { react: "^18.2.0" } },
      },
    },
    blueprintValidation: { validationCycles: 0 },
  };

  const c4Val = await blueprintValidatorNode(case4State);
  assert(c4Val.blueprintValidation.isValid === true, "Case 4: Full-stack blueprint with requested React+Express+MongoDB passes validation");

  console.log(`\n═════════════════════════════════════════════════`);
  console.log(` SUMMARY: ${passed} passed, ${failed} failed`);
  console.log(`═════════════════════════════════════════════════\n`);

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error("❌ Test runner error:", err);
  process.exit(1);
});
