/**
 * test-planner-integration.js — Planner Integration & Node Routing Test
 * Run: node tests/test-planner-integration.js
 */

import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { AgentState } from "../src/config/state.js";
import { plannerAgentNode } from "../src/agents/plannerAgent.js";
import { selectNextTaskNode, selectNextTaskRouter } from "../src/nodes/selectNextTask.js";

console.log("\n🧪 TEST: Planner Agent & Sandbox Node Routing Integration\n");

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

let executedNodes = [];

// Mock setupSandbox that returns clean planner phase state
const mockSetupSandboxNode = async (state) => {
  executedNodes.push("setupSandbox");
  return {
    sandboxId: "sandbox-integration-123",
    currentPhase: "planner",
    fileRegistry: [{ path: "backend/src/config/db.js" }],
    completedNodes: ["setupSandbox"],
  };
};

const mockSandboxHealthCheckNode = async (state) => {
  executedNodes.push("sandboxHealthCheck");
  return {
    sandboxHealthy: true,
    completedNodes: ["sandboxHealthCheck"],
  };
};

const mockPlannerNode = async (state) => {
  executedNodes.push("plannerAgent");
  return {
    taskQueue: {
      phases: [
        {
          phaseNumber: 1,
          phaseName: "setup",
          tasks: [
            {
              taskId: "setup-1",
              title: "App config",
              filesToCreate: ["backend/src/config/app.js"],
              canParallelize: false,
            },
          ],
        },
      ],
      totalTasks: 1,
    },
    currentPhaseIndex: 0,
    currentTaskIndex: 0,
    currentPhase: "planner",
    completedNodes: ["plannerAgent"],
  };
};

const mockSelectNextTaskNode = async (state) => {
  executedNodes.push("selectNextTask");
  const res = selectNextTaskNode(state);
  return res;
};

async function runTest() {
  const graph = new StateGraph(AgentState);

  graph.addNode("plannerAgent", mockPlannerNode);
  graph.addNode("setupSandbox", mockSetupSandboxNode);
  graph.addNode("sandboxHealthCheck", mockSandboxHealthCheckNode);
  graph.addNode("selectNextTask", mockSelectNextTaskNode);

  graph.addEdge(START, "plannerAgent");
  graph.addEdge("plannerAgent", "setupSandbox");
  graph.addEdge("setupSandbox", "sandboxHealthCheck");
  graph.addConditionalEdges("sandboxHealthCheck", (state) => "selectNextTask", { selectNextTask: "selectNextTask" });
  graph.addConditionalEdges("selectNextTask", selectNextTaskRouter, {
    contextBuilder: END,
    phaseVerification: END,
    presentToUser: END,
  });

  const compiled = graph.compile({ checkpointer: new MemorySaver() });
  console.log("  ✅ Integration graph compiled\n");

  const initialState = {
    userRequirement: "Build task management app",
    clarifiedSpec: { appName: "task-app" },
    blueprint: { entities: [{ name: "Task" }] },
    tokenBudget: 2.0,
  };

  const finalState = await compiled.invoke(initialState, {
    configurable: { thread_id: "test-planner-integration-thread" },
  });

  console.log(`  Executed nodes: ${executedNodes.join(" → ")}\n`);

  assert(executedNodes.length === 4, `4 nodes executed in sequence (got ${executedNodes.length})`);
  assert(executedNodes[0] === "plannerAgent", "Step 1: plannerAgent");
  assert(executedNodes[1] === "setupSandbox", "Step 2: setupSandbox");
  assert(executedNodes[2] === "sandboxHealthCheck", "Step 3: sandboxHealthCheck");
  assert(executedNodes[3] === "selectNextTask", "Step 4: selectNextTask");

  assert(finalState.taskQueue?.phases?.length === 1, "taskQueue populated and preserved");
  assert(finalState.sandboxId === "sandbox-integration-123", "sandboxId populated");
  assert(finalState.sandboxHealthy === true, "sandboxHealthy is true");
  assert(finalState.currentTask?.taskId === "setup-1", "selectNextTask selected setup-1 task");
  assert(finalState.currentPhase === "dev_loop", `Phase transitioned from planner to dev_loop (got "${finalState.currentPhase}")`);

  console.log(`\n  ─── Summary: ${passed} passed, ${failed} failed ───\n`);
  if (failed > 0) process.exit(1);
}

runTest().catch((err) => {
  console.error("  ❌ Test error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
