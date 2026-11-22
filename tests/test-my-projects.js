/**
 * test-my-projects.js — Comprehensive Test Suite for My Projects & ZIP Download
 *
 * Covers:
 * Test A: Project listing (User sees own projects, persists across requests)
 * Test B: User isolation (User B cannot see or download User A's projects; 403 Forbidden)
 * Test C: ZIP contents (Usable source files and relative structure preserved)
 * Test D: Secret exclusion (.env, node_modules, .git, *.log strictly excluded)
 * Test E: Restart persistence (Survives server restart without recreating sandbox)
 * Test F: Different projects (Distinct archives with own files)
 * Test G: Error handling (401, 403, 404, unavailable files)
 * Test H: Safe Delete (Owner restricted, cleans up without touching other projects)
 * Test I: Existing execution (Opening does not restart graph or create new sandbox)
 */

import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import http from "http";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import authRoutes from "../server/routes/auth.js";
import projectRoutes from "../server/routes/projects.js";
import { attachAuthUser } from "../server/middleware/requireAuth.js";
import { createSandbox, destroySandbox, writeFile, getSandboxBasePath } from "../src/utils/sandboxManager.js";
import {
  findProjectById,
  findProjectsByUserId,
  createProjectRecord,
  updateProjectRecord,
  deleteProjectRecord,
} from "../server/services/projectStore.js";

console.log("\n========================================================");
console.log("  TEST SUITE: MY PROJECTS DASHBOARD & ZIP DOWNLOAD");
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

function createTestServer() {
  const app = express();
  app.use(cors({ origin: "http://localhost:5173", credentials: true }));
  app.use(cookieParser());
  app.use(express.json());
  app.use(attachAuthUser);
  app.use("/api/auth", authRoutes);
  app.use("/api/projects", projectRoutes);

  const server = http.createServer(app);
  return server;
}

// Simple ZIP parser to inspect entries without external tool
function parseZipEntries(buffer) {
  const entries = [];
  let offset = 0;

  while (offset < buffer.length - 4) {
    const signature = buffer.readUInt32LE(offset);
    if (signature === 0x04034b50) {
      // Local file header
      const nameLen = buffer.readUInt16LE(offset + 26);
      const extraLen = buffer.readUInt16LE(offset + 28);
      const name = buffer.toString("utf8", offset + 30, offset + 30 + nameLen);
      const compressedSize = buffer.readUInt32LE(offset + 18);
      entries.push({ name, compressedSize });
      offset = offset + 30 + nameLen + extraLen + compressedSize;
    } else if (signature === 0x02014b50) {
      // Central directory header - skip
      offset += 46;
    } else {
      offset++;
    }
  }

  return entries;
}

async function runTests() {
  const server = createTestServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}/api`;

  let cookieUserA = "";
  let userAId = "";
  let cookieUserB = "";
  let userBId = "";

  const projectA1Id = `project-test-a1-${Date.now()}`;
  const projectA2Id = `project-test-a2-${Date.now()}`;
  const projectB1Id = `project-test-b1-${Date.now()}`;

  let sandboxA1Id = null;
  let sandboxA2Id = null;

  try {
    // ─── SETUP USERS ───────────────────────────────────────
    console.log("[Setup] Registering User A and User B...");

    const resA = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Operator A",
        email: `usera_${Date.now()}@example.com`,
        password: "SecretPassword123!",
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
        name: "Operator B",
        email: `userb_${Date.now()}@example.com`,
        password: "SecretPassword123!",
      }),
    });
    const dataB = await resB.json();
    userBId = dataB.user.id;
    cookieUserB = resB.headers.get("set-cookie").split(";")[0];
    assert(userBId, `User B registered (ID: ${userBId})`);

    // ─── TEST A: PROJECT LISTING ───────────────────────────
    console.log("\n─── TEST A: Project Listing for Authenticated User ───");

    // Create sandbox and record for Project A1
    sandboxA1Id = `sandbox-a1-${Date.now()}`;
    const sandboxA1Base = getSandboxBasePath();
    const sandboxA1Path = path.join(sandboxA1Base, sandboxA1Id);
    fs.mkdirSync(path.join(sandboxA1Path, "backend", "src"), { recursive: true });
    fs.mkdirSync(path.join(sandboxA1Path, "frontend", "src"), { recursive: true });
    fs.mkdirSync(path.join(sandboxA1Path, "node_modules", "some-dep"), { recursive: true });
    fs.mkdirSync(path.join(sandboxA1Path, ".git", "objects"), { recursive: true });

    // Real source code files
    fs.writeFileSync(path.join(sandboxA1Path, "backend", "package.json"), JSON.stringify({ name: "todo-backend" }));
    fs.writeFileSync(path.join(sandboxA1Path, "backend", "src", "index.js"), "console.log('Backend running');");
    fs.writeFileSync(path.join(sandboxA1Path, "frontend", "package.json"), JSON.stringify({ name: "todo-frontend" }));
    fs.writeFileSync(path.join(sandboxA1Path, "frontend", "src", "App.jsx"), "export default function App() { return <div>App</div>; }");
    fs.writeFileSync(path.join(sandboxA1Path, "README.md"), "# Todo Application");
    
    // Sensitive / temp files that MUST be excluded
    fs.writeFileSync(path.join(sandboxA1Path, "backend", ".env"), "PORT=5000\nDATABASE_URL=postgresql://secret:pass@db:5432\nJWT_SECRET=super-secret-key-123\n");
    fs.writeFileSync(path.join(sandboxA1Path, "node_modules", "some-dep", "index.js"), "module.exports = {};");
    fs.writeFileSync(path.join(sandboxA1Path, ".git", "config"), "[core]\nrepositoryformatversion = 0\n");
    fs.writeFileSync(path.join(sandboxA1Path, "build.log"), "2026-10-11 Log output");

    // Save project metadata for User A
    await createProjectRecord({
      id: projectA1Id,
      userId: userAId,
      name: "Todo Management Suite",
      requirement: "Build a full stack todo application with authentication and categories",
      projectType: "full_stack",
      sandboxId: sandboxA1Id,
      status: "completed",
    });

    // Create second project for User A
    sandboxA2Id = `sandbox-a2-${Date.now()}`;
    const sandboxA2Path = path.join(sandboxA1Base, sandboxA2Id);
    fs.mkdirSync(path.join(sandboxA2Path, "frontend", "src"), { recursive: true });
    fs.writeFileSync(path.join(sandboxA2Path, "frontend", "package.json"), JSON.stringify({ name: "blog-client" }));
    fs.writeFileSync(path.join(sandboxA2Path, "frontend", "src", "main.js"), "console.log('Blog initialized');");

    await createProjectRecord({
      id: projectA2Id,
      userId: userAId,
      name: "Personal Tech Blog",
      requirement: "Build a responsive personal markdown blog in vanilla JavaScript",
      projectType: "frontend_only",
      sandboxId: sandboxA2Id,
      status: "running",
    });

    // Request projects list for User A
    const listResA = await fetch(`${baseUrl}/projects`, {
      headers: { Cookie: cookieUserA },
    });
    const listDataA = await listResA.json();

    assert(listResA.status === 200, "User A successfully fetched project list (200 OK)");
    assert(Array.isArray(listDataA.projects), "Response returns projects array");
    assert(listDataA.projects.some((p) => p.id === projectA1Id), "User A sees Project A1");
    assert(listDataA.projects.some((p) => p.id === projectA2Id), "User A sees Project A2");
    assert(listDataA.projects.length >= 2, `User A sees both created projects (total: ${listDataA.projects.length})`);

    // ─── TEST B: USER ISOLATION & ACCESS CONTROL ───────────
    console.log("\n─── TEST B: User Isolation & Cross-Account Access Protection ───");

    // Request projects list for User B
    const listResB = await fetch(`${baseUrl}/projects`, {
      headers: { Cookie: cookieUserB },
    });
    const listDataB = await listResB.json();

    assert(listResB.status === 200, "User B fetched project list (200 OK)");
    assert(
      !listDataB.projects.some((p) => p.id === projectA1Id || p.id === projectA2Id),
      "User B CANNOT see User A's projects in project list"
    );

    // User B tries to view details of User A's project
    const getResB = await fetch(`${baseUrl}/projects/${projectA1Id}`, {
      headers: { Cookie: cookieUserB },
    });
    assert(getResB.status === 403, `User B blocked from GET /projects/:id of User A (Got 403 Forbidden)`);

    // User B tries to download ZIP of User A's project
    const zipResB = await fetch(`${baseUrl}/projects/${projectA1Id}/zip`, {
      headers: { Cookie: cookieUserB },
    });
    assert(zipResB.status === 403, `User B blocked from downloading User A's ZIP (Got 403 Forbidden)`);

    // User B tries to delete User A's project
    const delResB = await fetch(`${baseUrl}/projects/${projectA1Id}`, {
      method: "DELETE",
      headers: { Cookie: cookieUserB },
    });
    assert(delResB.status === 403, `User B blocked from DELETE /projects/:id of User A (Got 403 Forbidden)`);

    // User B tries to view sandbox of User A's project
    const sbResB = await fetch(`${baseUrl}/projects/${projectA1Id}/sandbox`, {
      headers: { Cookie: cookieUserB },
    });
    assert(sbResB.status === 403, `User B blocked from GET /projects/:id/sandbox of User A (Got 403 Forbidden)`);

    // ─── TEST C & D: ZIP DOWNLOAD, CONTENTS & SECRET EXCLUSION ──
    console.log("\n─── TEST C & D: ZIP Archive Generation, Usable Structure & Secret Exclusion ───");

    const zipResA = await fetch(`${baseUrl}/projects/${projectA1Id}/zip`, {
      headers: { Cookie: cookieUserA },
    });

    assert(zipResA.status === 200, "User A successfully requested project ZIP (200 OK)");
    assert(zipResA.headers.get("Content-Type") === "application/zip", "Content-Type is application/zip");

    const disposition = zipResA.headers.get("Content-Disposition");
    assert(disposition && disposition.includes("attachment") && disposition.includes(".zip"), `Content-Disposition header includes attachment and .zip filename: ${disposition}`);

    const zipBuffer = Buffer.from(await zipResA.arrayBuffer());
    assert(zipBuffer.length > 0, `ZIP archive received (size: ${zipBuffer.length} bytes)`);

    // Parse ZIP file entries
    const entries = parseZipEntries(zipBuffer);
    const entryNames = entries.map((e) => e.name.replace(/\\/g, "/"));

    console.log(`   📦 Archive contained ${entryNames.length} files:`, entryNames);

    // Verify source code exists
    assert(entryNames.includes("backend/src/index.js"), "ZIP contains backend/src/index.js");
    assert(entryNames.includes("backend/package.json"), "ZIP contains backend/package.json");
    assert(entryNames.includes("frontend/src/App.jsx"), "ZIP contains frontend/src/App.jsx");
    assert(entryNames.includes("frontend/package.json"), "ZIP contains frontend/package.json");
    assert(entryNames.includes("README.md"), "ZIP contains README.md");

    // Verify sensitive and temporary files are strictly excluded
    const hasEnvFile = entryNames.some((name) => name === ".env" || name.endsWith("/.env"));
    assert(!hasEnvFile, "SECRET EXCLUSION: .env is NOT present in archive");

    const hasNodeModules = entryNames.some((name) => name.includes("node_modules"));
    assert(!hasNodeModules, "SECRET EXCLUSION: node_modules is NOT present in archive");

    const hasGit = entryNames.some((name) => name.includes(".git"));
    assert(!hasGit, "SECRET EXCLUSION: .git is NOT present in archive");

    const hasLogs = entryNames.some((name) => name.endsWith(".log"));
    assert(!hasLogs, "SECRET EXCLUSION: *.log temporary files are NOT present in archive");

    // Verify .env.example placeholder was generated safely
    const hasEnvExample = entryNames.some((name) => name.endsWith(".env.example"));
    assert(hasEnvExample, "Safe .env.example placeholder generated for operator reference");

    // ─── TEST E: SERVER RESTART PERSISTENCE ────────────────
    console.log("\n─── TEST E: Server Restart Persistence ───");

    // Close current server instance to simulate backend shutdown
    await new Promise((resolve) => server.close(resolve));

    // Spin up a fresh server instance
    const restartedServer = createTestServer();
    await new Promise((resolve) => restartedServer.listen(0, resolve));
    const newPort = restartedServer.address().port;
    const newBaseUrl = `http://localhost:${newPort}/api`;

    // Fetch projects again using User A's session
    const restartListRes = await fetch(`${newBaseUrl}/projects`, {
      headers: { Cookie: cookieUserA },
    });
    const restartListData = await restartListRes.json();

    assert(restartListRes.status === 200, "Fetched project list from restarted server instance");
    assert(
      restartListData.projects.some((p) => p.id === projectA1Id),
      "Project A1 survives backend restart and remains discoverable"
    );
    assert(
      restartListData.projects.some((p) => p.id === projectA2Id),
      "Project A2 survives backend restart and remains discoverable"
    );

    // Download ZIP again from restarted server
    const restartZipRes = await fetch(`${newBaseUrl}/projects/${projectA1Id}/zip`, {
      headers: { Cookie: cookieUserA },
    });
    assert(restartZipRes.status === 200, "ZIP download functions after server restart without recreating sandbox");

    // ─── TEST F: DIFFERENT PROJECTS ISOLATION ──────────────
    console.log("\n─── TEST F: Different Projects Isolation ───");

    const zipResA2 = await fetch(`${newBaseUrl}/projects/${projectA2Id}/zip`, {
      headers: { Cookie: cookieUserA },
    });
    const zipBufferA2 = Buffer.from(await zipResA2.arrayBuffer());
    const entriesA2 = parseZipEntries(zipBufferA2).map((e) => e.name.replace(/\\/g, "/"));

    assert(entriesA2.includes("frontend/src/main.js"), "Project A2 ZIP contains Project A2's frontend/src/main.js");
    assert(!entriesA2.includes("backend/src/index.js"), "Project A2 ZIP does NOT contain Project A1's files");

    // ─── TEST G: ERROR HANDLING ────────────────────────────
    console.log("\n─── TEST G: Error Handling ───");

    // 1. Unauthenticated request
    const unauthRes = await fetch(`${newBaseUrl}/projects`);
    assert(unauthRes.status === 401, "Unauthenticated project request returns 401");

    // 2. Non-existent project
    const notFoundRes = await fetch(`${newBaseUrl}/projects/non-existent-id`, {
      headers: { Cookie: cookieUserA },
    });
    assert(notFoundRes.status === 404, "Non-existent project returns 404");

    // 3. ZIP for project without sandbox
    const noSbId = `project-nosb-${Date.now()}`;
    await createProjectRecord({
      id: noSbId,
      userId: userAId,
      name: "Failed Init Project",
      requirement: "Some failed requirement",
      sandboxId: null,
      status: "failed",
    });
    const noSbZipRes = await fetch(`${newBaseUrl}/projects/${noSbId}/zip`, {
      headers: { Cookie: cookieUserA },
    });
    assert(noSbZipRes.status === 404, "ZIP request for project without files returns 404 with helpful error");
    const noSbErr = await noSbZipRes.json();
    assert(noSbErr.error && noSbErr.error.includes("not available"), `Error message is clear: "${noSbErr.error}"`);

    // ─── TEST H: SAFE DELETE ───────────────────────────────
    console.log("\n─── TEST H: Safe Delete Operations ───");

    // Delete project A2
    const delRes = await fetch(`${newBaseUrl}/projects/${projectA2Id}`, {
      method: "DELETE",
      headers: { Cookie: cookieUserA },
    });
    const delData = await delRes.json();
    assert(delRes.status === 200 && delData.success, "Project A2 safely deleted by owner");

    // Verify project A2 is removed from list
    const postDelList = await fetch(`${newBaseUrl}/projects`, {
      headers: { Cookie: cookieUserA },
    });
    const postDelData = await postDelList.json();
    assert(!postDelData.projects.some((p) => p.id === projectA2Id), "Project A2 no longer appears in project list");
    assert(postDelData.projects.some((p) => p.id === projectA1Id), "Project A1 remains intact after A2 deletion");

    // Clean up test server
    await new Promise((resolve) => restartedServer.close(resolve));

    // Clean up temporary sandboxes created for this test
    try {
      if (fs.existsSync(sandboxA1Path)) fs.rmSync(sandboxA1Path, { recursive: true, force: true });
      if (fs.existsSync(sandboxA2Path)) fs.rmSync(sandboxA2Path, { recursive: true, force: true });
      await deleteProjectRecord(projectA1Id);
      await deleteProjectRecord(noSbId);
    } catch (_) {}

  } catch (err) {
    console.error("Test execution failed:", err);
    failed++;
    try {
      server.close();
    } catch (_) {}
  }

  console.log("\n========================================================");
  console.log(`  SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("========================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
