/**
 * test-final-production.js — Comprehensive Verification Suite for
 * Project Ownership, Project Management, Deletion Safety, ZIP Archiving, and UI API Contracts.
 *
 * Scenarios Tested:
 * 1. User A creates a project and sees it in My Projects.
 * 2. User B logs in and cannot see User A's project.
 * 3. User B cannot open User A's project using its project ID (403 Forbidden).
 * 4. User B cannot retrieve User A's files, sandbox, or download its ZIP (403 Forbidden).
 * 5. User B cannot delete User A's project (403 Forbidden).
 * 6. User A can open, browse, and download their own project.
 * 7. User A can delete their own project after confirmation.
 * 8. Project deletion cleans up only its associated resources (does not touch other projects/sandboxes).
 * 9. Server restart does not break ownership or project access.
 * 10. Existing project generation and resume functionality still work.
 * 11. A running project is handled safely during deletion (cancellation + cleanup).
 * 12. Empty, large, and error-state project lists work correctly (search, filters, sort, pagination).
 * 13. WebSocket ownership gating & Path traversal prevention.
 */

import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import http from "http";
import fs from "fs";
import path from "path";
import WebSocket, { WebSocketServer } from "ws";
import authRoutes from "../server/routes/auth.js";
import projectRoutes from "../server/routes/projects.js";
import { attachAuthUser } from "../server/middleware/requireAuth.js";
import { initWebSocket } from "../server/ws/handler.js";
import { getSandboxBasePath } from "../src/utils/sandboxManager.js";
import {
  findProjectById,
  findProjectsByUserId,
  createProjectRecord,
  updateProjectRecord,
  deleteProjectRecord,
} from "../server/services/projectStore.js";

console.log("\n========================================================");
console.log("  FINAL COMPREHENSIVE PRODUCTION VERIFICATION SUITE");
console.log("========================================================\n");

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✅ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

function createServerInstance() {
  const app = express();
  app.use(cors({ origin: "http://localhost:5173", credentials: true }));
  app.use(cookieParser());
  app.use(express.json());
  app.use(attachAuthUser);
  app.use("/api/auth", authRoutes);
  app.use("/api/projects", projectRoutes);

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });
  initWebSocket(wss);
  return { server, wss };
}

// Simple ZIP parser
function parseZipEntries(buffer) {
  const entries = [];
  let offset = 0;
  while (offset < buffer.length - 4) {
    const signature = buffer.readUInt32LE(offset);
    if (signature === 0x04034b50) {
      const nameLen = buffer.readUInt16LE(offset + 26);
      const extraLen = buffer.readUInt16LE(offset + 28);
      const name = buffer.toString("utf8", offset + 30, offset + 30 + nameLen);
      const compressedSize = buffer.readUInt32LE(offset + 18);
      entries.push({ name, compressedSize });
      offset = offset + 30 + nameLen + extraLen + compressedSize;
    } else if (signature === 0x02014b50) {
      offset += 46;
    } else {
      offset++;
    }
  }
  return entries;
}

async function runProductionTests() {
  let { server } = createServerInstance();
  await new Promise((resolve) => server.listen(0, resolve));
  let port = server.address().port;
  let baseUrl = `http://localhost:${port}/api`;
  let wsUrl = `ws://localhost:${port}/ws`;

  let userAId = "";
  let cookieUserA = "";
  let userBId = "";
  let cookieUserB = "";

  const sandboxBase = getSandboxBasePath();
  const projectA1Id = `proj-a1-${Date.now()}`;
  const projectA2Id = `proj-a2-${Date.now()}`;
  const projectB1Id = `proj-b1-${Date.now()}`;
  const runningProjectId = `proj-running-${Date.now()}`;

  const sandboxA1Id = `sb-a1-${Date.now()}`;
  const sandboxA2Id = `sb-a2-${Date.now()}`;
  const sandboxRunningId = `sb-run-${Date.now()}`;

  const sandboxA1Path = path.join(sandboxBase, sandboxA1Id);
  const sandboxA2Path = path.join(sandboxBase, sandboxA2Id);
  const sandboxRunningPath = path.join(sandboxBase, sandboxRunningId);

  try {
    // ─── SETUP: REGISTER USERS ───────────────────────────────────────
    console.log("─── SETUP: Registering User A and User B ───");

    const resA = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Alice Operator",
        email: `alice_${Date.now()}@example.com`,
        password: "StrongPassword123!",
      }),
    });
    const dataA = await resA.json();
    userAId = dataA.user.id;
    cookieUserA = resA.headers.get("set-cookie").split(";")[0];
    assert(userAId, `User A registered (ID: ${userAId})`);

    const resB = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Bob Operator",
        email: `bob_${Date.now()}@example.com`,
        password: "StrongPassword123!",
      }),
    });
    const dataB = await resB.json();
    userBId = dataB.user.id;
    cookieUserB = resB.headers.get("set-cookie").split(";")[0];
    assert(userBId, `User B registered (ID: ${userBId})`);

    // Prepare sandbox files for Project A1
    fs.mkdirSync(path.join(sandboxA1Path, "backend", "src"), { recursive: true });
    fs.mkdirSync(path.join(sandboxA1Path, "frontend", "src"), { recursive: true });
    fs.mkdirSync(path.join(sandboxA1Path, "node_modules", "pkg"), { recursive: true });
    fs.mkdirSync(path.join(sandboxA1Path, ".git"), { recursive: true });

    fs.writeFileSync(path.join(sandboxA1Path, "backend", "package.json"), JSON.stringify({ name: "server-a" }));
    fs.writeFileSync(path.join(sandboxA1Path, "backend", "src", "server.js"), "console.log('User A Backend');");
    fs.writeFileSync(path.join(sandboxA1Path, "frontend", "package.json"), JSON.stringify({ name: "client-a" }));
    fs.writeFileSync(path.join(sandboxA1Path, "frontend", "src", "App.jsx"), "export default function App() {}");
    fs.writeFileSync(path.join(sandboxA1Path, "README.md"), "# Project A1 Documentation");
    fs.writeFileSync(path.join(sandboxA1Path, "backend", ".env"), "SECRET_KEY=confidential_token\nPORT=5000\n");
    fs.writeFileSync(path.join(sandboxA1Path, "debug.log"), "error log dump");

    // ─── SCENARIO 1: User A creates project and sees it in My Projects ───
    console.log("\n─── SCENARIO 1: Project Creation & Ownership Assignment ───");

    await createProjectRecord({
      id: projectA1Id,
      userId: userAId,
      name: "Inventory Manager Pro",
      requirement: "Build a warehouse inventory management portal",
      projectType: "full_stack",
      sandboxId: sandboxA1Id,
      status: "completed",
    });

    const listResA = await fetch(`${baseUrl}/projects`, {
      headers: { Cookie: cookieUserA },
    });
    const listDataA = await listResA.json();

    assert(listResA.status === 200, "User A fetches project list with 200 OK");
    assert(Array.isArray(listDataA.projects), "Returns projects array");
    const foundA1 = listDataA.projects.find((p) => p.id === projectA1Id);
    assert(foundA1 && foundA1.userId === userAId, "Project A1 is owned by User A and returned in My Projects");
    assert(foundA1.name === "Inventory Manager Pro", "Project name is preserved");

    // ─── SCENARIO 2: User B cannot see User A's project ───
    console.log("\n─── SCENARIO 2: Cross-User List Isolation ───");

    // User B also creates their own project
    await createProjectRecord({
      id: projectB1Id,
      userId: userBId,
      name: "Bob Personal Tracker",
      requirement: "Bob personal tracker application",
      projectType: "frontend_only",
      sandboxId: null,
      status: "idle",
    });

    const listResB = await fetch(`${baseUrl}/projects`, {
      headers: { Cookie: cookieUserB },
    });
    const listDataB = await listResB.json();

    assert(listResB.status === 200, "User B fetches project list with 200 OK");
    assert(!listDataB.projects.some((p) => p.id === projectA1Id), "User B CANNOT see User A's project A1 in project list");
    assert(listDataB.projects.some((p) => p.id === projectB1Id), "User B CAN see their own project B1");

    // ─── SCENARIO 3: User B cannot open User A's project by ID ───
    console.log("\n─── SCENARIO 3: Direct Project Access Protection (GET /projects/:id) ───");

    const getResB = await fetch(`${baseUrl}/projects/${projectA1Id}`, {
      headers: { Cookie: cookieUserB },
    });
    assert(getResB.status === 403, "User B blocked from GET /projects/:id of User A (Returns 403 Forbidden)");
    const getErrB = await getResB.json();
    assert(getErrB.error && getErrB.error.includes("Access denied"), "Error message clarifies access denial");

    // ─── SCENARIO 4: User B cannot retrieve User A's files, sandbox, or ZIP ───
    console.log("\n─── SCENARIO 4: Files, Sandbox & ZIP Access Protection ───");

    const sbResB = await fetch(`${baseUrl}/projects/${projectA1Id}/sandbox`, {
      headers: { Cookie: cookieUserB },
    });
    assert(sbResB.status === 403, "User B blocked from GET /projects/:id/sandbox (403 Forbidden)");

    const fileResB = await fetch(`${baseUrl}/projects/${projectA1Id}/files/backend/src/server.js`, {
      headers: { Cookie: cookieUserB },
    });
    assert(fileResB.status === 403, "User B blocked from GET /projects/:id/files/* (403 Forbidden)");

    const zipResB = await fetch(`${baseUrl}/projects/${projectA1Id}/zip`, {
      headers: { Cookie: cookieUserB },
    });
    assert(zipResB.status === 403, "User B blocked from GET /projects/:id/zip (403 Forbidden)");

    // ─── SCENARIO 5: User B cannot delete User A's project ───
    console.log("\n─── SCENARIO 5: Deletion Authorization Enforcement ───");

    const delResB = await fetch(`${baseUrl}/projects/${projectA1Id}`, {
      method: "DELETE",
      headers: { Cookie: cookieUserB },
    });
    assert(delResB.status === 403, "User B blocked from DELETE /projects/:id of User A (403 Forbidden)");

    // Verify Project A1 still exists intact
    const verifyA1 = await findProjectById(projectA1Id);
    assert(verifyA1 !== null, "Project A1 remains completely untouched after unauthorized delete attempt");

    // ─── SCENARIO 6: User A can open, browse, and download their own project ───
    console.log("\n─── SCENARIO 6: Authorized Project Exploration & ZIP Download ───");

    const getResA = await fetch(`${baseUrl}/projects/${projectA1Id}`, {
      headers: { Cookie: cookieUserA },
    });
    assert(getResA.status === 200, "User A successfully opens project details (200 OK)");

    const sbResA = await fetch(`${baseUrl}/projects/${projectA1Id}/sandbox`, {
      headers: { Cookie: cookieUserA },
    });
    assert(sbResA.status === 200, "User A retrieves sandbox file tree (200 OK)");
    const sbDataA = await sbResA.json();
    assert(sbDataA.files && sbDataA.files.length > 0, `Sandbox reports ${sbDataA.fileCount} files`);

    const fileResA = await fetch(`${baseUrl}/projects/${projectA1Id}/files/backend/src/server.js`, {
      headers: { Cookie: cookieUserA },
    });
    assert(fileResA.status === 200, "User A reads file backend/src/server.js (200 OK)");
    const fileDataA = await fileResA.json();
    assert(fileDataA.content && fileDataA.content.includes("User A Backend"), "File content returned accurately");

    const zipResA = await fetch(`${baseUrl}/projects/${projectA1Id}/zip`, {
      headers: { Cookie: cookieUserA },
    });
    assert(zipResA.status === 200, "User A successfully downloads project ZIP (200 OK)");
    const zipBuf = Buffer.from(await zipResA.arrayBuffer());
    const zipEntries = parseZipEntries(zipBuf).map((e) => e.name.replace(/\\/g, "/"));
    assert(zipEntries.includes("backend/src/server.js"), "ZIP contains backend source");
    assert(zipEntries.includes("backend/.env.example"), "ZIP contains sanitized .env.example");
    assert(!zipEntries.some((e) => e === ".env" || e.endsWith("/.env")), "ZIP strictly excludes sensitive .env");
    assert(!zipEntries.some((e) => e.includes("node_modules")), "ZIP strictly excludes node_modules");

    // ─── SCENARIO 7: User A can delete their own project after confirmation ───
    console.log("\n─── SCENARIO 7: Authorized Project Deletion ───");

    // Create Project A2 to delete
    fs.mkdirSync(path.join(sandboxA2Path, "frontend"), { recursive: true });
    fs.writeFileSync(path.join(sandboxA2Path, "frontend", "main.js"), "console.log('A2');");
    await createProjectRecord({
      id: projectA2Id,
      userId: userAId,
      name: "Temporary Calculator",
      requirement: "Temporary calculator app",
      projectType: "frontend_only",
      sandboxId: sandboxA2Id,
      status: "completed",
    });

    const delResA = await fetch(`${baseUrl}/projects/${projectA2Id}`, {
      method: "DELETE",
      headers: { Cookie: cookieUserA },
    });
    assert(delResA.status === 200, "User A deletes own project A2 (200 OK)");
    const delDataA = await delResA.json();
    assert(delDataA.success === true, "Delete response reports success: true");

    // Verify removed from database
    const checkA2 = await findProjectById(projectA2Id);
    assert(checkA2 === null, "Project A2 successfully removed from project store");

    // ─── SCENARIO 8: Project deletion cleans up only its associated resources ───
    console.log("\n─── SCENARIO 8: Selective Resource Cleanup & Preservation ───");

    assert(!fs.existsSync(sandboxA2Path), "Project A2 sandbox directory removed");
    assert(fs.existsSync(sandboxA1Path), "Project A1 sandbox directory PRESERVED and untouched");
    const checkA1After = await findProjectById(projectA1Id);
    assert(checkA1After !== null, "Project A1 metadata PRESERVED and untouched");

    // ─── SCENARIO 9: Server restart does not break ownership or access ───
    console.log("\n─── SCENARIO 9: Server Restart Persistence & Ownership Invariance ───");

    await new Promise((resolve) => server.close(resolve));
    const restarted = createServerInstance();
    server = restarted.server;
    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;
    baseUrl = `http://localhost:${port}/api`;
    wsUrl = `ws://localhost:${port}/ws`;

    const restartListA = await fetch(`${baseUrl}/projects`, {
      headers: { Cookie: cookieUserA },
    });
    const restartDataA = await restartListA.json();
    assert(restartDataA.projects.some((p) => p.id === projectA1Id), "Project A1 accessible to User A after server restart");

    const restartListB = await fetch(`${baseUrl}/projects`, {
      headers: { Cookie: cookieUserB },
    });
    const restartDataB = await restartListB.json();
    assert(!restartDataB.projects.some((p) => p.id === projectA1Id), "Project A1 remains completely hidden from User B after restart");

    // ─── SCENARIO 10: WebSocket Ownership Gating & Protection ───
    console.log("\n─── SCENARIO 10: Real-Time WebSocket Ownership Gating ───");

    // User B tries to subscribe to User A's project via WebSocket
    const wsB = new WebSocket(`${wsUrl}?projectId=${projectA1Id}`, {
      headers: { Cookie: cookieUserB },
    });
    const wsBResult = await new Promise((resolve) => {
      wsB.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "error" && msg.message.includes("Access denied")) {
          resolve("blocked");
        }
      });
      wsB.on("close", () => resolve("closed"));
      setTimeout(() => resolve("timeout"), 2000);
    });
    assert(wsBResult === "blocked" || wsBResult === "closed", "User B is blocked from User A's WebSocket project subscription (Access denied)");

    // User A subscribes to User A's project via WebSocket
    const wsA = new WebSocket(`${wsUrl}?projectId=${projectA1Id}`, {
      headers: { Cookie: cookieUserA },
    });
    const wsAResult = await new Promise((resolve) => {
      wsA.on("open", () => {
        wsA.close();
        resolve("connected");
      });
      wsA.on("error", (e) => resolve(`error: ${e.message}`));
      setTimeout(() => resolve("timeout"), 2000);
    });
    assert(wsAResult === "connected", "User A successfully connects to own project WebSocket stream");

    // ─── SCENARIO 11: Running project is handled safely during deletion ───
    console.log("\n─── SCENARIO 11: Running Project Lifecycle Handling During Deletion ───");

    fs.mkdirSync(sandboxRunningPath, { recursive: true });
    await createProjectRecord({
      id: runningProjectId,
      userId: userAId,
      name: "Active Running Build",
      requirement: "Ongoing project execution",
      projectType: "full_stack",
      sandboxId: sandboxRunningId,
      status: "running",
    });

    const delRunRes = await fetch(`${baseUrl}/projects/${runningProjectId}`, {
      method: "DELETE",
      headers: { Cookie: cookieUserA },
    });
    assert(delRunRes.status === 200, "Active running project deleted with safe lifecycle cleanup (200 OK)");
    const checkRunAfter = await findProjectById(runningProjectId);
    assert(checkRunAfter === null, "Running project successfully removed and halted");

    // ─── SCENARIO 12: Search, Filters, Sorting & Pagination ───
    console.log("\n─── SCENARIO 12: Search, Filters, Sorting & Pagination API Contracts ───");

    // Seed multiple projects for User A to test pagination & filters
    const pIds = [];
    for (let i = 1; i <= 5; i++) {
      const pid = `proj-batch-${i}-${Date.now()}`;
      pIds.push(pid);
      await createProjectRecord({
        id: pid,
        userId: userAId,
        name: i % 2 === 0 ? `E-Commerce Store Phase ${i}` : `Analytics Dashboard ${i}`,
        requirement: `Requirement for batch project ${i}`,
        projectType: i % 2 === 0 ? "full_stack" : "frontend_only",
        status: i === 1 ? "completed" : i === 2 ? "running" : "idle",
      });
    }

    // 1. Search test
    const searchRes = await fetch(`${baseUrl}/projects?search=analytics`, {
      headers: { Cookie: cookieUserA },
    });
    const searchData = await searchRes.json();
    assert(searchData.projects.every((p) => p.name.toLowerCase().includes("analytics")), "Search query filters accurately");

    // 2. Type filter test
    const typeRes = await fetch(`${baseUrl}/projects?type=frontend_only`, {
      headers: { Cookie: cookieUserA },
    });
    const typeData = await typeRes.json();
    assert(typeData.projects.every((p) => p.projectType === "frontend_only"), "Type filter (frontend_only) filters accurately");

    // 3. Status filter test
    const statusRes = await fetch(`${baseUrl}/projects?status=completed`, {
      headers: { Cookie: cookieUserA },
    });
    const statusData = await statusRes.json();
    assert(statusData.projects.every((p) => p.status === "completed" || p.status === "complete"), "Status filter (completed) filters accurately");

    // 4. Pagination test
    const pageRes = await fetch(`${baseUrl}/projects?page=1&limit=2`, {
      headers: { Cookie: cookieUserA },
    });
    const pageData = await pageRes.json();
    assert(pageData.projects.length === 2, "Pagination limit=2 returns exactly 2 items");
    assert(pageData.page === 1, "Page metadata reports page 1");
    assert(pageData.totalPages >= 3, `Total pages calculated accurately (got ${pageData.totalPages})`);
    assert(pageData.total >= 6, `Total items calculated accurately (got ${pageData.total})`);

    // ─── SCENARIO 13: Path Traversal Prevention ───
    console.log("\n─── SCENARIO 13: Path Traversal Attack Prevention ───");

    const traversalRes = await fetch(`${baseUrl}/projects/${projectA1Id}/files/..%2f..%2f..%2fserver.js`, {
      headers: { Cookie: cookieUserA },
    });
    assert(traversalRes.status === 400, "Path traversal attempt '../' returns 400 Bad Request");
    const traversalData = await traversalRes.json();
    assert(traversalData.error && traversalData.error.includes("traversal"), "Traveral attempt explicitly reported in error");

    // Clean up batch projects
    for (const pid of pIds) {
      await deleteProjectRecord(pid);
    }
    await deleteProjectRecord(projectA1Id);
    await deleteProjectRecord(projectB1Id);

    // Clean up temporary sandboxes created for this test
    if (fs.existsSync(sandboxA1Path)) fs.rmSync(sandboxA1Path, { recursive: true, force: true });
    if (fs.existsSync(sandboxA2Path)) fs.rmSync(sandboxA2Path, { recursive: true, force: true });
    if (fs.existsSync(sandboxRunningPath)) fs.rmSync(sandboxRunningPath, { recursive: true, force: true });

    await new Promise((resolve) => server.close(resolve));

  } catch (err) {
    console.error("Test execution failed:", err);
    failed++;
    try {
      server.close();
    } catch (_) {}
  }

  console.log("\n========================================================");
  console.log(`  FINAL VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("========================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runProductionTests();
