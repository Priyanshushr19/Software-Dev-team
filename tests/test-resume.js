/**
 * test-resume.js — Comprehensive Persistence, Resume & API Key Rotation Tests
 * Run: node tests/test-resume.js
 * 
 * VERIFIES:
 * TEST A — SERVER RESTART RESUME:
 *   1. Checkpoint survives process / graph instance restart.
 *   2. Same thread_id restores exact state values (clarifiedSpec, blueprint, etc.).
 *   3. Completed nodes (PM, Architect Steps 1 & 2) are NOT re-executed.
 *   4. Execution resumes directly from Architect Step 3.
 * 
 * TEST B — API KEY / QUOTA FAILURE & RECOVERY RESUME:
 *   1. LLM API / Quota failure at Architect Step 3 halts graph safely.
 *   2. Checkpoint preserves clean state up to Step 2.
 *   3. Replacing API key / resolving quota and resuming SAME thread ID continues from Step 3.
 *   4. No loss of spec, entities, tables, or task data.
 * 
 * TEST C — BROWSER / WEBSOCKET RECONNECT:
 *   1. Restoring state from checkpointer gives authoritative state.
 *   2. Reconnected clients receive full checkpoint data without starting over.
 */

import "dotenv/config";
import { StateGraph, START, END } from "@langchain/langgraph";
import { AgentState } from "../src/config/state.js";
import { createCheckpointer } from "../src/config/graph.js";
import { setupSandboxNode } from "../src/nodes/setupSandbox.js";
import { contextBuilderNode } from "../src/nodes/contextBuilder.js";
import { createSandbox, destroySandbox, writeFile, readFile } from "../src/utils/sandboxManager.js";

console.log("\n🧪 TEST: LangGraph Persistence, Server Restart & API Key Recovery\n");

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

// Track node invocations
let executedNodes = [];
let simApiKeyValid = true;

// Mock nodes
const mockPmNode = async (state) => {
  executedNodes.push("pmAgent");
  return {
    pmStatus: "spec_ready",
    clarifiedSpec: { appName: "resume-test-app", authRequired: true },
    completedNodes: ["pmAgent"],
  };
};

const mockArchStep1Node = async (state) => {
  executedNodes.push("architectStep1");
  return {
    blueprint: { entities: [{ name: "User" }, { name: "Task" }] },
    clarifiedSpec: state.clarifiedSpec,
    completedNodes: ["architectStep1"],
  };
};

const mockArchStep2Node = async (state) => {
  executedNodes.push("architectStep2");
  return {
    blueprint: { dbSchema: { databaseType: "PostgreSQL", tables: [{ name: "users" }] } },
    clarifiedSpec: state.clarifiedSpec,
    completedNodes: ["architectStep2"],
  };
};

const mockArchStep3Node = async (state) => {
  executedNodes.push("architectStep3");
  if (!simApiKeyValid) {
    throw new Error("GEMINI_QUOTA_EXHAUSTED: Rate limit or quota exceeded (429 RESOURCE_EXHAUSTED)");
  }
  return {
    blueprint: { apiEndpoints: [{ method: "GET", path: "/api/tasks" }] },
    completedNodes: ["architectStep3"],
  };
};

const mockArchStep4Node = async (state) => {
  executedNodes.push("architectStep4");
  return {
    blueprint: { frontendPages: [{ name: "Dashboard", route: "/dashboard" }] },
    completedNodes: ["architectStep4"],
  };
};

function buildTestGraph() {
  const g = new StateGraph(AgentState);
  g.addNode("pmAgent", mockPmNode);
  g.addNode("architectStep1", mockArchStep1Node);
  g.addNode("architectStep2", mockArchStep2Node);
  g.addNode("architectStep3", mockArchStep3Node);
  g.addNode("architectStep4", mockArchStep4Node);

  g.addEdge(START, "pmAgent");
  g.addEdge("pmAgent", "architectStep1");
  g.addEdge("architectStep1", "architectStep2");
  g.addEdge("architectStep2", "architectStep3");
  g.addEdge("architectStep3", "architectStep4");
  g.addEdge("architectStep4", END);

  return g;
}

async function runTests() {
  // ═══════════════════════════════════════════════════════════════
  // TEST A: SERVER RESTART RESUME
  // ═══════════════════════════════════════════════════════════════
  console.log("  ─── TEST A: Server Restart & Resume (Same Thread ID) ───\n");

  const threadIdA = `project-server-restart-${Date.now()}`;
  const configA = { configurable: { thread_id: threadIdA } };

  executedNodes = [];
  simApiKeyValid = true;

  const checkpointer1 = await createCheckpointer();
  if (checkpointer1.deleteThread) {
    try { await checkpointer1.deleteThread(threadIdA); } catch (_) {}
  }

  // Run 1: Interrupt before architectStep3 (simulating server shutdown before Step 3 runs)
  const graph1 = buildTestGraph().compile({
    checkpointer: checkpointer1,
    interruptBefore: ["architectStep3"],
  });

  await graph1.invoke({ userRequirement: "Build task management app" }, configA);

  assert(executedNodes.length === 3, `Run 1 executed 3 initial nodes (got ${executedNodes.length})`);
  assert(executedNodes.includes("pmAgent"), "PM Agent executed in Run 1");
  assert(executedNodes.includes("architectStep1"), "Architect Step 1 executed in Run 1");
  assert(executedNodes.includes("architectStep2"), "Architect Step 2 executed in Run 1");

  const state1 = await graph1.getState(configA);
  assert(state1.next.length === 1 && state1.next[0] === "architectStep3", "Next node pending is architectStep3");
  assert(state1.values.clarifiedSpec?.appName === "resume-test-app", "Spec preserved in checkpoint");
  assert(state1.values.blueprint?.entities?.length === 2, "Entities preserved in checkpoint");

  if (checkpointer1.end) await checkpointer1.end();

  // Simulating Server Restart: Brand new graph instance created from checkpointer
  console.log("\n  [Simulation] Backend server restarts. Reconnecting to checkpointer with thread ID...");
  executedNodes = [];

  const checkpointer2 = await createCheckpointer();
  const graph2 = buildTestGraph().compile({ checkpointer: checkpointer2 });

  const state2Before = await graph2.getState(configA);
  assert(state2Before.next[0] === "architectStep3", "Restored checkpoint identifies architectStep3 as next node");

  // Resume by invoking with null
  const finalStateA = await graph2.invoke(null, configA);

  console.log(`  Run 2 executed nodes on restart: ${executedNodes.join(" → ")}`);
  assert(executedNodes.length === 2, `Run 2 executed 2 remaining nodes (got ${executedNodes.length})`);
  assert(!executedNodes.includes("pmAgent"), "PM Agent was NOT re-executed after server restart");
  assert(!executedNodes.includes("architectStep1"), "Architect Step 1 was NOT re-executed after server restart");
  assert(!executedNodes.includes("architectStep2"), "Architect Step 2 was NOT re-executed after server restart");
  assert(executedNodes[0] === "architectStep3", "Execution resumed directly from Architect Step 3");
  assert(finalStateA.blueprint?.frontendPages?.length === 1, "Final state retained all completed steps");

  if (checkpointer2.end) await checkpointer2.end();

  // ═══════════════════════════════════════════════════════════════
  // TEST B: API KEY / QUOTA FAILURE & RECOVERY RESUME
  // ═══════════════════════════════════════════════════════════════
  console.log("\n  ─── TEST B: API Key Failure & Key Replacement Resume ───\n");

  const threadIdB = `project-api-failure-${Date.now()}`;
  const configB = { configurable: { thread_id: threadIdB } };

  executedNodes = [];
  simApiKeyValid = true;

  const checkpointerB1 = await createCheckpointer();
  if (checkpointerB1.deleteThread) {
    try { await checkpointerB1.deleteThread(threadIdB); } catch (_) {}
  }

  // Run 1: Starts cleanly with PM & Step 1 & Step 2, but fails at Step 3 due to Quota/API error
  // First interrupt before Step 3 to ensure Step 1 & 2 checkpoint
  const graphB1 = buildTestGraph().compile({
    checkpointer: checkpointerB1,
    interruptBefore: ["architectStep3"],
  });

  await graphB1.invoke({ userRequirement: "Build blog platform" }, configB);
  assert(executedNodes.includes("pmAgent") && executedNodes.includes("architectStep2"), "Step 1 & 2 completed before failure");

  // Now attempt to run Step 3 with EXHAUSTED / INVALID API KEY
  console.log("  [Simulation] API key quota exhausted at Architect Step 3...");
  simApiKeyValid = false;
  executedNodes = [];

  let apiErrorCaught = false;
  try {
    await graphB1.invoke(null, configB);
  } catch (err) {
    apiErrorCaught = true;
    console.log(`  [Caught expected error] ${err.message}`);
  }

  assert(apiErrorCaught, "Graph halted immediately when API key failed at Architect Step 3");
  assert(!executedNodes.includes("architectStep4"), "Architect Step 4 was NOT executed after API failure");

  const stateBError = await graphB1.getState(configB);
  assert(stateBError.values.clarifiedSpec?.appName === "resume-test-app", "State preserved after API failure");
  assert(stateBError.values.blueprint?.entities?.length === 2, "Entities preserved after API failure");

  if (checkpointerB1.end) await checkpointerB1.end();

  // Now simulate replacing API key with a new valid key and resuming
  console.log("\n  [Simulation] New valid GEMINI_API_KEY provided. Resuming project...");
  simApiKeyValid = true;
  executedNodes = [];

  const checkpointerB2 = await createCheckpointer();
  const graphB2 = buildTestGraph().compile({ checkpointer: checkpointerB2 });

  const finalStateB = await graphB2.invoke(null, configB);

  console.log(`  Resumed execution executed nodes: ${executedNodes.join(" → ")}`);
  assert(executedNodes.length === 2, `Resumed run executed remaining nodes: ${executedNodes.join(", ")}`);
  assert(!executedNodes.includes("pmAgent"), "PM Agent was NOT re-executed when resuming after API key change");
  assert(!executedNodes.includes("architectStep1"), "Architect Step 1 was NOT re-executed after API key change");
  assert(!executedNodes.includes("architectStep2"), "Architect Step 2 was NOT re-executed after API key change");
  assert(executedNodes[0] === "architectStep3", "Resumed execution began directly at failed node: Architect Step 3");
  assert(finalStateB.blueprint?.apiEndpoints?.length === 1, "API endpoints populated after resume");
  assert(finalStateB.blueprint?.frontendPages?.length === 1, "Frontend pages populated after resume");

  if (checkpointerB2.end) await checkpointerB2.end();

  // ═══════════════════════════════════════════════════════════════
  // TEST C: BROWSER / WEBSOCKET RECONNECT
  // ═══════════════════════════════════════════════════════════════
  console.log("\n  ─── TEST C: Browser / WebSocket Reconnect State Restoration ───\n");

  const checkpointerC = await createCheckpointer();
  const graphC = buildTestGraph().compile({ checkpointer: checkpointerC });
  const restoredState = await graphC.getState(configB);

  assert(restoredState?.values !== null, "Authoritative state retrieved from checkpointer on reconnect");
  assert(restoredState.values?.clarifiedSpec?.appName === "resume-test-app", "Spec matches restored state across resume and reconnect");
  assert(restoredState.values?.blueprint?.entities?.length === 2, "Entities match restored state");
  assert(restoredState.values?.blueprint?.apiEndpoints?.length === 1, "API endpoints match restored state");

  if (checkpointerC.end) await checkpointerC.end();

  // ═══════════════════════════════════════════════════════════════
  // TEST D: SANDBOX IDENTITY REUSE & FILE PRESERVATION ON RESTART
  // ═══════════════════════════════════════════════════════════════
  console.log("\n  ─── TEST D: Sandbox Identity Reuse & File Preservation Across Restart ───\n");

  const initialSandboxId = await createSandbox(
    "backend/src/models\nfrontend/src/pages",
    {
      backend: { name: "app-backend", dependencies: { mongoose: "^8.0.0" } },
      frontend: { name: "app-frontend", dependencies: { react: "^18.2.0" } },
    },
    { tables: [] },
    "full_stack"
  );

  writeFile(initialSandboxId, "backend/src/models/User.js", "export const User = { name: 'User' };");

  // Simulate server restart where setupSandbox runs with existing sandboxId
  const restartResult = await setupSandboxNode({
    sandboxId: initialSandboxId,
    blueprint: { folderStructure: "", dependencies: {}, dbSchema: null },
  });

  assert(restartResult.sandboxId === initialSandboxId, `Resumed setupSandbox preserved exact sandboxId: ${restartResult.sandboxId}`);
  
  const savedUserCode = readFile(initialSandboxId, "backend/src/models/User.js");
  assert(savedUserCode.includes("export const User"), "Generated files preserved on disk after restart");

  destroySandbox(initialSandboxId);

  // ═══════════════════════════════════════════════════════════════
  // TEST E: REVIEWER REJECTION FEEDBACK INCORPORATION IN CODER CONTEXT
  // ═══════════════════════════════════════════════════════════════
  console.log("\n  ─── TEST E: Reviewer Feedback Propagation to Context Builder ───\n");

  const testStateWithRejection = {
    currentTask: {
      taskId: "setup-1",
      title: "Create Mongoose Models",
      description: "Create User and Todo models",
      filesToCreate: ["backend/src/models/User.js", "backend/src/models/Todo.js"],
      acceptanceCriteria: ["Define User schema", "Define TodoItem schema"],
    },
    reviewResult: {
      verdict: "rejected",
      issues: [
        "User.js and Todo.js contain duplicate model definitions.",
        "Todo.js should not duplicate User.js models.",
        "Potential OverwriteModelError."
      ],
      summary: "Duplicate model definitions detected",
      reviewCycle: 1,
    },
    fileRegistry: [],
    projectPatterns: {},
    clarifiedSpec: { appName: "mern-todo-app" },
  };

  const contextResult = contextBuilderNode(testStateWithRejection);
  assert(contextResult.contextPackage !== null, "Context package generated");
  assert(contextResult.contextPackage?.reviewerFeedback?.verdict === "rejected", "Reviewer rejection verdict included in context package");
  assert(contextResult.contextPackage?.reviewerFeedback?.issues?.length === 3, "All 3 reviewer issues included in context package");
  assert(contextResult.contextPackage?.reviewerFeedback?.issues[0].includes("duplicate model definitions"), "Specific rejection issue preserved for coder");

  console.log(`\n  ─── Summary: ${passed} passed, ${failed} failed ───\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error("  ❌ Test error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
