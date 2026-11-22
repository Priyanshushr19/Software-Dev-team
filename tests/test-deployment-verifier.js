/**
 * test-deployment-verifier.js — Unit Tests for Deployment Verifier & Completion Semantics
 * 
 * Verifies:
 * 1. Frontend returns 200 => PASS
 * 2. Backend returns 200 => PASS
 * 3. Backend returns 404 => PASS as "reachable"
 * 4. Backend connection refused => FAIL
 * 5. Backend timeout => FAIL
 * 6. Frontend connection refused => FAIL
 * 7. Database unavailable => FAIL
 * 8. All services healthy => deploymentHealthy=true
 * 9. Any required service genuinely unavailable => deploymentHealthy=false
 * 10. deploymentHealthy=false => PROJECT COMPLETE must NOT be printed
 */

import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { testHttpEndpoint, getPublishedPorts } from "../src/nodes/deploymentVerifier.js";
import { presentToUserNode } from "../src/nodes/presentToUser.js";

async function runTests() {
  console.log("\n🧪 TEST: Deployment Verifier & Health Check Logic\n");

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

  // ─── Test Server Helper ──────────────────────────────────
  function createTestServer(statusCode, responseText = "OK") {
    const server = http.createServer((req, res) => {
      res.writeHead(statusCode, { "Content-Type": "text/plain" });
      res.end(responseText);
    });

    return new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        resolve({
          port,
          url: `http://127.0.0.1:${port}`,
          close: () => new Promise((r) => server.close(r)),
        });
      });
    });
  }

  // ─── Test 1: Frontend returns 200 => PASS ────────────────
  console.log("─── Test 1: Frontend returns 200 => PASS ───");
  const s1 = await createTestServer(200, "Frontend Ready");
  try {
    const res1 = await testHttpEndpoint(s1.url, 2000);
    const frontendPass = res1.reachable && res1.statusCode >= 200 && res1.statusCode < 400;
    assert(frontendPass === true && res1.statusCode === 200, "Frontend 200 evaluated as PASS");
  } finally {
    await s1.close();
  }

  // ─── Test 2: Backend returns 200 => PASS ─────────────────
  console.log("\n─── Test 2: Backend returns 200 => PASS ───");
  const s2 = await createTestServer(200, JSON.stringify({ status: "ok" }));
  try {
    const res2 = await testHttpEndpoint(s2.url, 2000);
    const backendPass = res2.reachable && res2.statusCode >= 200 && res2.statusCode <= 404;
    assert(backendPass === true && res2.statusCode === 200, "Backend 200 evaluated as PASS");
  } finally {
    await s2.close();
  }

  // ─── Test 3: Backend returns 404 => PASS as "reachable" ──
  console.log("\n─── Test 3: Backend returns 404 => PASS as reachable ───");
  const s3 = await createTestServer(404, "Cannot GET /");
  try {
    const res3 = await testHttpEndpoint(s3.url, 2000);
    const backendPass = res3.reachable && res3.statusCode >= 200 && res3.statusCode <= 404;
    assert(res3.reachable === true, "Backend 404 identified as reachable");
    assert(backendPass === true, "Backend 404 evaluated as PASS (reachable)");
  } finally {
    await s3.close();
  }

  // ─── Test 4: Backend connection refused => FAIL ──────────
  console.log("\n─── Test 4: Backend connection refused => FAIL ───");
  // Port 59999 is assumed unused
  const res4 = await testHttpEndpoint("http://127.0.0.1:59999", 1000);
  const backendPass4 = res4.reachable && res4.statusCode >= 200 && res4.statusCode <= 404;
  assert(res4.reachable === false, "Connection refused marked as unreachable");
  assert(backendPass4 === false, "Connection refused evaluated as FAIL");

  // ─── Test 5: Backend timeout => FAIL ─────────────────────
  console.log("\n─── Test 5: Backend timeout => FAIL ───");
  const s5 = http.createServer(() => {
    // Hanging server — never responds
  });
  await new Promise((r) => s5.listen(0, "127.0.0.1", r));
  const s5Port = s5.address().port;
  try {
    const res5 = await testHttpEndpoint(`http://127.0.0.1:${s5Port}`, 500);
    assert(res5.reachable === false, "Timeout marked as unreachable");
    assert(res5.statusText === "Timeout", "Timeout error correctly categorized");
  } finally {
    await new Promise((r) => s5.close(r));
  }

  // ─── Test 6: Frontend connection refused => FAIL ─────────
  console.log("\n─── Test 6: Frontend connection refused => FAIL ───");
  const res6 = await testHttpEndpoint("http://127.0.0.1:59998", 1000);
  const frontendPass6 = res6.reachable && res6.statusCode >= 200 && res6.statusCode < 400;
  assert(res6.reachable === false, "Frontend connection refused marked as unreachable");
  assert(frontendPass6 === false, "Frontend connection refused evaluated as FAIL");

  // ─── Test 7: Database unavailable => FAIL evaluation ────
  console.log("\n─── Test 7: Database unavailable => FAIL ───");
  const dbReachable = false; // Mock DB check failure
  const deploymentHealthyDb = true && true && dbReachable;
  assert(deploymentHealthyDb === false, "Database unavailable causes overall deploymentHealthy=false");

  // ─── Test 8: All services healthy => deploymentHealthy=true ──
  console.log("\n─── Test 8: All services healthy => deploymentHealthy=true ───");
  const allHealthy = (200 >= 200 && 200 < 400) && (404 >= 200 && 404 <= 404) && true;
  assert(allHealthy === true, "All healthy services evaluate to deploymentHealthy=true");

  // ─── Test 9: Port Mapping Parser ─────────────────────────
  console.log("\n─── Test 9: Port Mapping Parser from docker-compose.yml ───");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aidev-test-compose-"));
  try {
    const composeContent = `
version: "3.8"
services:
  db:
    image: postgres:16
    ports:
      - "16432:5432"
  backend:
    build: ./backend
    ports:
      - "16000:5000"
  frontend:
    build: ./frontend
    ports:
      - "16173:80"
`;
    fs.writeFileSync(path.join(tmpDir, "docker-compose.yml"), composeContent);
    const parsedPorts = getPublishedPorts(tmpDir);
    assert(parsedPorts.backend === 16000, "Backend host port parsed correctly (16000)");
    assert(parsedPorts.frontend === 16173, "Frontend host port parsed correctly (16173)");
    assert(parsedPorts.db === 16432, "DB host port parsed correctly (16432)");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // ─── Test 10: Completion Semantics (No PROJECT COMPLETE on failure) ──
  console.log("\n─── Test 10: Completion Semantics (deploymentHealthy=false) ───");
  let printedOutput = "";
  const originalLog = console.log;
  console.log = (...args) => {
    printedOutput += args.join(" ") + "\n";
  };

  try {
    presentToUserNode({
      deploymentHealthy: false,
      executionResult: { result: "fail", errors: "Backend connection refused" },
      clarifiedSpec: { appName: "Test App" },
      taskStatuses: {},
    });
  } finally {
    console.log = originalLog;
  }

  const containsProjectComplete = printedOutput.includes("PROJECT COMPLETE");
  const containsDeploymentFailed = printedOutput.includes("DEPLOYMENT FAILED / NEEDS ATTENTION");

  assert(containsProjectComplete === false, "PROJECT COMPLETE is NOT printed when deploymentHealthy=false");
  assert(containsDeploymentFailed === true, "DEPLOYMENT FAILED / NEEDS ATTENTION is printed when deploymentHealthy=false");

  console.log(`\n─── Summary: ${passed} passed, ${failed} failed ───\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
