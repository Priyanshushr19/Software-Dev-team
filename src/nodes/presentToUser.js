/**
 * presentToUser.js — Final project presentation
 */

import { getFileList, getSandboxPath } from "../utils/sandboxManager.js";
import { printTokenSummary } from "../utils/tokenTracker.js";

export function presentToUserNode(state) {
  const projectType = state.projectType || state.clarifiedSpec?.projectType || "full_stack";
  const isHealthy = state.deploymentHealthy === true && (state.deploymentVerification ? state.deploymentVerification.deploymentHealthy === true : true);

  console.log("\n" + (isHealthy ? "🎉".repeat(25) : "⚠️".repeat(25)));
  if (isHealthy) {
    console.log("\n  🚀 PROJECT COMPLETE!\n");
  } else {
    console.log("\n  ⚠️ DEPLOYMENT FAILED / NEEDS ATTENTION\n");
  }
  console.log("═".repeat(60));

  // Project info
  console.log(`  App: ${state.clarifiedSpec?.appName || "Unknown"}`);
  console.log(`  Description: ${state.clarifiedSpec?.description || ""}`);
  console.log(`  Scope: ${projectType}`);

  // Task summary
  const statuses = state.taskStatuses || {};
  const done = Object.values(statuses).filter(s => s === "done").length;
  const total = Object.keys(statuses).length;
  console.log(`\n  📋 Tasks completed: ${done}/${total}`);

  // Verification Breakdown
  if (state.deploymentVerification) {
    const v = state.deploymentVerification;
    console.log(`\n  🔍 Deployment Verification Breakdown:`);
    if (projectType !== "backend_only") {
      console.log(`     • Frontend (${v.frontend?.url || "N/A"}): ${v.frontend?.pass ? "✅ PASS" : "❌ FAIL"} (${v.frontend?.reachable ? `HTTP ${v.frontend?.statusCode}` : "Unreachable"})`);
    } else {
      console.log(`     • Frontend: NOT REQUIRED`);
    }

    if (projectType !== "frontend_only") {
      console.log(`     • Backend (${v.backend?.url || "N/A"}): ${v.backend?.pass ? "✅ PASS" : "❌ FAIL"} (${v.backend?.reachable ? `HTTP ${v.backend?.statusCode}` : "Unreachable"})`);
      console.log(`     • Database: ${v.database?.pass ? "✅ PASS" : "❌ FAIL"}`);
    } else {
      console.log(`     • Backend: NOT REQUIRED`);
      console.log(`     • Database: NOT REQUIRED`);
    }
  } else if (!isHealthy) {
    console.log(`\n  ❌ Deployment health verification did not pass.`);
  }

  // Files created
  if (state.sandboxId) {
    try {
      const files = getFileList(state.sandboxId);
      const codeFiles = files.filter(f =>
        !f.includes("node_modules") && !f.includes(".git") && !f.includes("package-lock")
      );
      console.log(`\n  📂 Files created: ${codeFiles.length}`);
      codeFiles.forEach(f => console.log(`     ${f}`));

      const sandboxPath = getSandboxPath(state.sandboxId);
      console.log(`\n  📍 Project location: ${sandboxPath}`);
    } catch (e) { /* sandbox might be unavailable */ }
  }

  // Token usage
  printTokenSummary(state.tokenUsage);

  // How to run
  console.log("═".repeat(60));
  if (isHealthy && state.deploymentUrl) {
    console.log(`  🌐 VERIFIED LOCAL DEPLOYMENT URL: ${state.deploymentUrl}\n`);
    console.log("  The application was verified live and is currently accessible at the URL above.\n");
  }

  console.log("  🏃 HOW TO RUN OR RESTART YOUR APP:\n");

  if (state.sandboxId) {
    const sandboxPath = getSandboxPath(state.sandboxId);
    console.log(`  cd ${sandboxPath}`);
    console.log("  docker-compose up -d");
    console.log("");
    if (isHealthy) {
      if (projectType !== "backend_only") {
        console.log(`  Frontend: ${state.deploymentUrl || "http://localhost:15173"}`);
      }
      if (projectType !== "frontend_only") {
        console.log("  Backend API: http://localhost:15000");
      }
    } else {
      console.log("  ⚠️ Services could not be fully verified. Check docker-compose logs:");
      console.log("  docker-compose logs");
    }
    console.log("");
    console.log("  To stop: docker-compose down");
  }

  console.log("═".repeat(60));
  if (isHealthy) {
    console.log("  ✅ Ready for your review!\n");
  } else {
    console.log("  ⚠️ Deployment failed or needs manual attention. Check logs above.\n");
  }

  return {
    completedNodes: ["presentToUser"],
    currentPhase: "done",
    userSatisfied: isHealthy,
  };
}
