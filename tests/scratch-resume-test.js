import "dotenv/config";
import { StateGraph, START, END } from "@langchain/langgraph";
import { AgentState } from "../src/config/state.js";
import { createCheckpointer } from "../src/config/graph.js";

let nodeCalls = [];

const mockPm = async (state) => {
  console.log("  -> Executing PM");
  nodeCalls.push("pm");
  return { pmStatus: "spec_ready", clarifiedSpec: { appName: "TestApp" } };
};

const mockArch1 = async (state) => {
  console.log("  -> Executing Arch 1");
  nodeCalls.push("arch1");
  return { blueprint: { entities: [{ name: "User" }] } };
};

const mockArch2 = async (state) => {
  console.log("  -> Executing Arch 2");
  nodeCalls.push("arch2");
  return { blueprint: { dbSchema: { tables: ["users"] } } };
};

const mockArch3 = async (state) => {
  console.log("  -> Executing Arch 3");
  nodeCalls.push("arch3");
  return { blueprint: { apiEndpoints: ["/api/users"] } };
};

const mockArch4 = async (state) => {
  console.log("  -> Executing Arch 4");
  nodeCalls.push("arch4");
  return { blueprint: { frontendPages: ["/home"] } };
};

function buildTestGraph() {
  const g = new StateGraph(AgentState);
  g.addNode("pm", mockPm);
  g.addNode("arch1", mockArch1);
  g.addNode("arch2", mockArch2);
  g.addNode("arch3", mockArch3);
  g.addNode("arch4", mockArch4);

  g.addEdge(START, "pm");
  g.addEdge("pm", "arch1");
  g.addEdge("arch1", "arch2");
  g.addEdge("arch2", "arch3");
  g.addEdge("arch3", "arch4");
  g.addEdge("arch4", END);
  return g;
}

async function test() {
  const threadId = `project-test-${Date.now()}`;
  const config = { configurable: { thread_id: threadId } };

  console.log("=== RUN 1 (Interrupt before arch3) ===");
  const checkpointer1 = await createCheckpointer();
  const graph1 = buildTestGraph().compile({ checkpointer: checkpointer1, interruptBefore: ["arch3"] });

  await graph1.invoke({ userRequirement: "Build something" }, config);
  console.log("Run 1 executed nodes:", nodeCalls);

  const savedState1 = await graph1.getState(config);
  console.log("Saved state next nodes after Run 1:", savedState1.next);
  console.log("Saved state blueprint entities:", savedState1.values.blueprint?.entities);

  if (checkpointer1.end) await checkpointer1.end();

  console.log("\n=== DESTROY GRAPH & SIMULATE RESTART ===");
  nodeCalls = []; // Reset call tracker

  console.log("\n=== RUN 2 (Resume from arch3) ===");
  const checkpointer2 = await createCheckpointer();
  const graph2 = buildTestGraph().compile({ checkpointer: checkpointer2 });

  // Let's check saved state in graph2
  const savedState2 = await graph2.getState(config);
  console.log("State restored in Graph 2. Next nodes:", savedState2.next);
  console.log("State values present in Graph 2. Entities:", savedState2.values.blueprint?.entities);

  // Resume by passing null
  await graph2.invoke(null, config);
  console.log("Run 2 executed nodes:", nodeCalls);

  if (checkpointer2.end) await checkpointer2.end();
}

test().catch(console.error);
