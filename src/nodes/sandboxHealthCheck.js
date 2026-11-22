/**
 * sandboxHealthCheck.js — Verifies all containers are healthy
 */

import { healthCheck, getSandboxInfo } from "../utils/sandboxManager.js";

export async function sandboxHealthCheckNode(state) {
  console.log("\n🏥 [Sandbox Health Check] Verifying workspace...\n");

  const { sandboxId } = state;

  if (!sandboxId) {
    console.log("   ❌ No sandbox ID");
    return { sandboxHealthy: false, error: "No sandbox ID" };
  }

  const info = getSandboxInfo(sandboxId);
  const result = await healthCheck(sandboxId);

  if (result.healthy) {
    console.log("   ✅ All health checks passed!");
    console.log(`   📂 Path: ${result.sandboxPath}`);
    if (info) {
      console.log(`   🗄️  DB: ${info.dbType} (${info.dbContainer || "none"})`);
      console.log(`   🖥️  Backend: ${info.backendContainer || "none"}`);
      console.log(`   🎨 Frontend: ${info.frontendContainer || "none"}`);
    }
    return { sandboxHealthy: true, completedNodes: ["sandboxHealthCheck"] };
  }

  console.log("   ❌ Health check failures:");
  result.failures.forEach(f => console.log(`   • ${f}`));

  return {
    sandboxHealthy: false,
    error: `Sandbox unhealthy: ${result.failures.join("; ")}`,
    completedNodes: ["sandboxHealthCheck"],
  };
}

export function sandboxHealthRouter(state) {
  console.log(`[ROUTE] from: sandboxHealthCheck to: selectNextTask (healthy: ${state.sandboxHealthy})`);
  return "__end__";
}
