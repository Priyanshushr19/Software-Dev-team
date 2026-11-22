/**
 * test-pm-clarification.js — Test PM Clarification Flow (Vague vs Detailed)
 * Run: node tests/test-pm-clarification.js
 */

import "dotenv/config";
import { initGemini } from "../src/utils/gemini.js";
import { pmAgentNode } from "../src/agents/pmAgent.js";
import { humanInputNode } from "../src/nodes/humanInput.js";

console.log("\n🧪 TEST: PM Agent Clarification & Routing Logic\n");

async function runTest() {
  try {
    initGemini(process.env.GEMINI_API_KEY);
    console.log(`  ✅ Gemini initialized (${process.env.GEMINI_MODEL || "gemini-2.5-flash"})\n`);
  } catch (error) {
    console.error(`  ❌ ${error.message}`);
    process.exit(1);
  }

  let passed = 0, failed = 0;
  function assert(cond, msg) {
    if (cond) {
      console.log(`  ✅ PASS: ${msg}`);
      passed++;
    } else {
      console.log(`  ❌ FAIL: ${msg}`);
      failed++;
    }
  }

  // ─── TEST 1: Vague requirement → needs_clarification → questions ───
  console.log("  ─── Test 1: Vague requirement → questions ───\n");

  const state1 = {
    userRequirement: "Build a task management app",
    pmStatus: "idle",
    pmQuestions: [],
    pmConversation: [],
    tokenUsage: { calls: [], totalInput: 0, totalOutput: 0, estimatedCost: 0 },
    tokenBudget: 2.0,
  };

  const result1 = await pmAgentNode(state1);

  assert(result1.pmStatus === "needs_clarification", `PM status is needs_clarification (got "${result1.pmStatus}")`);
  assert(Array.isArray(result1.pmQuestions) && result1.pmQuestions.length >= 3, `Generated ${result1.pmQuestions?.length || 0} questions (>= 3)`);

  // Simulate humanInput providing answers
  console.log("\n  ─── Simulating user answers to PM questions ───\n");

  const state2 = {
    userRequirement: "Build a task management app",
    pmStatus: "idle",
    pmQuestions: result1.pmQuestions,
    pmConversation: [
      { role: "pm", questions: result1.pmQuestions },
      { role: "user", answers: "Single user personal app. Support categories, priority levels, due dates. Need email login auth. Simple dashboard page." },
    ],
    tokenUsage: { calls: [], totalInput: 0, totalOutput: 0, estimatedCost: 0 },
    tokenBudget: 2.0,
  };

  const result2 = await pmAgentNode(state2);

  assert(result2.pmStatus === "spec_ready", `After answers, PM status is spec_ready (got "${result2.pmStatus}")`);
  assert(result2.clarifiedSpec !== null && typeof result2.clarifiedSpec === "object", "Generated valid clarifiedSpec");
  assert(result2.currentPhase === "architect", `Routes to architect phase (got "${result2.currentPhase}")`);

  // ─── TEST 2: Detailed requirement → spec_ready ───
  console.log("\n  ─── Test 2: Detailed requirement → spec_ready directly ───\n");

  const stateDetailed = {
    userRequirement: "Build a single-user personal task management web app using React and Express. Tasks must have a title, description, priority (low/medium/high), status (pending/completed), due date, and category. The app needs a dashboard page showing task lists with filtering by category and priority, a category management page, and user authentication with register/login/logout.",
    pmStatus: "idle",
    pmQuestions: [],
    pmConversation: [],
    tokenUsage: { calls: [], totalInput: 0, totalOutput: 0, estimatedCost: 0 },
    tokenBudget: 2.0,
  };

  const resultDetailed = await pmAgentNode(stateDetailed);

  assert(resultDetailed.pmStatus === "spec_ready", `Detailed requirement produces spec_ready directly (got "${resultDetailed.pmStatus}")`);
  assert(resultDetailed.clarifiedSpec !== null, "Generated valid spec directly");
  assert(resultDetailed.currentPhase === "architect", `Routes directly to architect phase (got "${resultDetailed.currentPhase}")`);

  console.log(`\n  ─── Summary: ${passed} passed, ${failed} failed ───\n`);
  if (failed > 0) process.exit(1);
}

runTest().catch((err) => {
  console.error("  ❌ Test error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
