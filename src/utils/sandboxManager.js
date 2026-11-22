/**
 * sandboxManager.js — Complete Docker Sandbox
 * 
 * CONTAINERS:
 * 1. Database (PostgreSQL or MongoDB) — persistent volume
 * 2. Backend (Node.js) — bind mount to local folder
 * 3. Frontend (Node.js) — bind mount to local folder
 * All on same Docker network so they can talk to each other.
 * 
 * SETUP SEQUENCE:
 * 1. Create Docker network
 * 2. Start DB container → wait for ready → create tables
 * 3. Start Backend container → npm install → set DATABASE_URL
 * 4. Start Frontend container → npm install → set VITE_API_URL
 * 5. Health check everything
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const sandboxes = new Map();
const NETWORK_NAME = "aidev-network";

// Check Docker availability
let dockerAvailable = false;
try {
  execSync("docker info", { stdio: "pipe", timeout: 5000 });
  dockerAvailable = true;
} catch (e) {
  console.warn("⚠️ Docker not available.");
}

// ═══════════════════════════════════════════════════════════════
// DOCKER HELPERS
// ═══════════════════════════════════════════════════════════════

function dockerExec(containerId, command, timeout = 30000) {
  try {
    const isWin = process.platform === "win32";
    const execCmd = isWin
      ? `docker exec ${containerId} sh -c "${command.replace(/"/g, '\\"')}"`
      : `docker exec ${containerId} sh -c '${command.replace(/'/g, "'\\''")}'`;
    const stdout = execSync(
      execCmd,
      { encoding: "utf-8", timeout, stdio: "pipe" }
    );
    return { stdout: stdout || "", stderr: "", exitCode: 0 };
  } catch (error) {
    return {
      stdout: error.stdout || "",
      stderr: error.stderr || error.message,
      exitCode: error.status || 1,
    };
  }
}

function ensureNetwork() {
  try {
    execSync(`docker network inspect ${NETWORK_NAME}`, { stdio: "pipe" });
  } catch (e) {
    console.log(`   🌐 Creating Docker network: ${NETWORK_NAME}`);
    execSync(`docker network create ${NETWORK_NAME}`, { stdio: "pipe" });
  }
}

function waitForContainer(containerId, checkCmd, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    const result = dockerExec(containerId, checkCmd, 5000);
    if (result.exitCode === 0) return true;
    execSync("sleep 1");
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════
// SANDBOX PATH RESOLUTION
// ═══════════════════════════════════════════════════════════════

export function getSandboxBasePath() {
  if (process.env.SANDBOX_DIR) return process.env.SANDBOX_DIR;
  const cwd = process.cwd();
  if (path.basename(cwd) === "server") {
    return path.join(cwd, "sandboxes");
  }
  const serverSandboxes = path.join(cwd, "server", "sandboxes");
  if (fs.existsSync(serverSandboxes)) return serverSandboxes;
  return path.join(cwd, "sandboxes");
}

export function findSandboxPath(sandboxId) {
  if (!sandboxId) return null;
  if (process.env.SANDBOX_DIR) {
    const p = path.join(process.env.SANDBOX_DIR, sandboxId);
    if (fs.existsSync(p)) return p;
  }
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "sandboxes", sandboxId),
    path.join(cwd, "server", "sandboxes", sandboxId),
    path.join(cwd, "..", "sandboxes", sandboxId),
    path.join(cwd, "..", "server", "sandboxes", sandboxId),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.join(getSandboxBasePath(), sandboxId);
}

// ═══════════════════════════════════════════════════════════════
// CREATE SANDBOX
// ═══════════════════════════════════════════════════════════════

export async function createSandbox(folderStructure, dependencies, dbSchema, projectType = "full_stack", technologyConstraints = {}) {
  const sandboxId = `sandbox-${Date.now()}`;
  const sandboxBase = getSandboxBasePath();
  const sandboxPath = path.join(sandboxBase, sandboxId);

  const isFrontendOnly = projectType === "frontend_only";
  const isBackendOnly = projectType === "backend_only";

  const frontendTech = (technologyConstraints?.frontend || []).map(t => String(t).toLowerCase());
  const frontendDepsRaw = dependencies?.frontend?.dependencies || {};
  const hasReactInConstraints = frontendTech.some(t => t.includes("react"));
  const hasVueInConstraints = frontendTech.some(t => t.includes("vue"));
  const hasHtmlCssJsInConstraints = frontendTech.some(t => t.includes("html") || t.includes("javascript") || t.includes("css")) && !hasReactInConstraints && !hasVueInConstraints;

  const isReact = hasReactInConstraints || (!hasHtmlCssJsInConstraints && Object.keys(frontendDepsRaw).some(d => d.includes("react")));
  const isVanilla = hasHtmlCssJsInConstraints || (!isReact && !hasVueInConstraints);

  console.log(`   📂 Creating sandbox: ${sandboxPath} (${projectType})`);
  console.log(`   🎨 Tech: ${isVanilla ? "Vanilla HTML/CSS/JS" : isReact ? "React" : "Custom"}, Backend: ${!isFrontendOnly}`);
  console.log(`   🐳 Docker: ${dockerAvailable ? "ENABLED" : "DISABLED"}`);

  // ─── Step 1: Create local folder structure ────────────────

  fs.mkdirSync(sandboxPath, { recursive: true });

  const backendPath = path.join(sandboxPath, "backend");
  const frontendPath = path.join(sandboxPath, "frontend");

  if (!isFrontendOnly) {
    fs.mkdirSync(backendPath, { recursive: true });
    const backendDirs = ["src", "src/models", "src/routes", "src/middleware", "src/config", "src/utils"];
    backendDirs.forEach(d => fs.mkdirSync(path.join(backendPath, d), { recursive: true }));
  }

  if (!isBackendOnly) {
    fs.mkdirSync(frontendPath, { recursive: true });
    const frontendDirs = isVanilla
      ? ["src", "src/components", "src/utils"]
      : ["src", "src/pages", "src/components", "src/hooks", "src/context", "src/utils"];
    frontendDirs.forEach(d => fs.mkdirSync(path.join(frontendPath, d), { recursive: true }));
  }

  // Parse additional folders
  if (typeof folderStructure === "string") {
    for (const line of folderStructure.split("\n")) {
      const match = line.match(/(?:├──|└──|│\s+[├└]──|\s+)\s*(.+)/);
      if (match) {
        const item = match[1].trim().replace(/\/$/, "");
        if (item && !item.includes(".") && item.length < 100) {
          // If frontend-only, don't create backend folders
          if (isFrontendOnly && item.startsWith("backend")) continue;
          if (isBackendOnly && item.startsWith("frontend")) continue;
          try { fs.mkdirSync(path.join(sandboxPath, item), { recursive: true }); }
          catch (e) { /* skip */ }
        }
      }
    }
  }

  // ─── Step 2: Write package.json files ─────────────────────

  if (!isFrontendOnly) {
    const backendDeps = dependencies?.backend?.dependencies && Object.keys(dependencies.backend.dependencies).length > 0
      ? dependencies.backend.dependencies
      : { "express": "^4.18.2", "cors": "^2.8.5", "dotenv": "^16.4.7", "pg": "^8.11.0", "bcryptjs": "^2.4.3", "jsonwebtoken": "^9.0.2" };

    const backendDevDeps = dependencies?.backend?.devDependencies || { "nodemon": "^3.0.0" };

    fs.writeFileSync(path.join(backendPath, "package.json"), JSON.stringify({
      name: dependencies?.backend?.name || "backend",
      version: "1.0.0",
      type: "module",
      main: "src/index.js",
      scripts: { start: "node src/index.js", dev: "nodemon src/index.js" },
      dependencies: backendDeps,
      devDependencies: backendDevDeps,
    }, null, 2));
  }

  if (!isBackendOnly) {
    let frontendDeps = {};
    let frontendDevDeps = { "vite": "^5.0.0", ...(dependencies?.frontend?.devDependencies || {}) };

    if (isReact) {
      frontendDeps = {
        "react": "^18.2.0",
        "react-dom": "^18.2.0",
        "react-router-dom": "^6.20.0",
        ...(dependencies?.frontend?.dependencies || {}),
      };
      if (!isFrontendOnly) frontendDeps["axios"] = frontendDeps["axios"] || "^1.6.0";

      frontendDevDeps["@vitejs/plugin-react"] = frontendDevDeps["@vitejs/plugin-react"] || "^4.2.0";
      frontendDevDeps["tailwindcss"] = frontendDevDeps["tailwindcss"] || "^3.4.1";
      frontendDevDeps["postcss"] = frontendDevDeps["postcss"] || "^8.4.35";
      frontendDevDeps["autoprefixer"] = frontendDevDeps["autoprefixer"] || "^10.4.17";
    }

    const scripts = isReact
      ? { dev: "vite", build: "vite build", preview: "vite preview" }
      : { start: "npx serve . -p 5173" };

    fs.writeFileSync(path.join(frontendPath, "package.json"), JSON.stringify({
      name: dependencies?.frontend?.name || "frontend",
      version: "1.0.0",
      type: "module",
      scripts,
      dependencies: frontendDeps,
      devDependencies: frontendDevDeps,
    }, null, 2));
  }

  // Detect DB type
  const dbType = dependencies?.backend?.dependencies?.mongoose ? "mongo" : "postgres";
  const dbContainerName = `aidev-db-${sandboxId}`;
  const backendContainerName = `aidev-backend-${sandboxId}`;
  const frontendContainerName = `aidev-frontend-${sandboxId}`;
  const volumeName = `aidev-dbdata-${sandboxId}`;

  // DB connection strings
  const dbUrl = dbType === "mongo"
    ? `mongodb://${dbContainerName}:27017/appdb`
    : `postgresql://postgres:postgres@${dbContainerName}:5432/appdb`;

  // ─── Step 3: Write .env files ─────────────────────────────

  if (!isFrontendOnly) {
    fs.writeFileSync(path.join(backendPath, ".env"), [
      "PORT=5000",
      `DATABASE_URL=${dbUrl}`,
      "JWT_SECRET=dev-secret-change-in-production",
      "NODE_ENV=development",
    ].join("\n") + "\n");
  }

  if (!isBackendOnly) {
    fs.writeFileSync(path.join(frontendPath, ".env"), [
      `VITE_API_URL=${isFrontendOnly ? "" : "http://localhost:5000/api"}`,
    ].join("\n") + "\n");
  }

  // ─── Step 3b: Deterministic scaffold files ────────────
  // These NEVER change between projects. Generating them here
  // means the LLM only writes business logic (models, routes, pages).

  // --- .gitignore ---
  fs.writeFileSync(path.join(sandboxPath, ".gitignore"), [
    "node_modules/", ".env", "dist/", ".DS_Store", "*.log",
  ].join("\n") + "\n");

  // ─── Backend scaffold files (only if backend required) ───
  if (!isFrontendOnly) {
    // --- Backend: src/config/db.js ---
    if (dbType === "postgres") {
      fs.writeFileSync(path.join(backendPath, "src/config/db.js"), `import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('Unexpected DB error:', err);
});

export { pool };

export async function connectDB() {
  try {
    const client = await pool.connect();
    console.log('Connected to PostgreSQL');
    client.release();
  } catch (err) {
    console.error('DB connection failed:', err.message);
  }
}
`);
    } else {
      fs.writeFileSync(path.join(backendPath, "src/config/db.js"), `import mongoose from 'mongoose';
import 'dotenv/config';

export async function connectDB() {
  try {
    await mongoose.connect(process.env.DATABASE_URL);
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('DB connection failed:', err.message);
  }
}

export default mongoose;
`);
    }

    // --- Backend: src/index.js (Express skeleton) ---
    fs.writeFileSync(path.join(backendPath, "src/index.js"), `import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { connectDB } from './config/db.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ═══ ROUTE IMPORTS (auto-assembled after all routes are built) ═══
// ROUTE_IMPORTS_PLACEHOLDER
// ROUTE_MOUNTS_PLACEHOLDER

// Error handler (must be last)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: err.message || 'Internal server error' });
});

// Start
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(\`Server running on port \${PORT}\`);
  });
});

export default app;
`);

    // --- Backend: src/middleware/auth.js (JWT skeleton) ---
    fs.writeFileSync(path.join(backendPath, "src/middleware/auth.js"), `import jwt from 'jsonwebtoken';

export function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ success: false, message: 'Invalid token' });
  }
}

export function authorizeRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    next();
  };
}
`);
  }

  // ─── Frontend scaffold files (only if frontend required) ───
  if (!isBackendOnly) {
    if (isReact) {
      // --- Frontend: index.html (React) ---
      fs.writeFileSync(path.join(frontendPath, "index.html"), `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`);

      // --- Frontend: src/main.jsx ---
      fs.writeFileSync(path.join(frontendPath, "src/main.jsx"), `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`);

      // --- Frontend: src/App.jsx ---
      fs.writeFileSync(path.join(frontendPath, "src/App.jsx"), `import { BrowserRouter, Routes, Route } from 'react-router-dom';

// ═══ PAGE IMPORTS (auto-assembled after all pages are built) ═══
// PAGE_IMPORTS_PLACEHOLDER

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center"><p>Loading...</p></div>} />
        {/* PAGE_ROUTES_PLACEHOLDER */}
      </Routes>
    </BrowserRouter>
  );
}
`);

      // --- Frontend: src/index.css (Tailwind) ---
      fs.writeFileSync(path.join(frontendPath, "src/index.css"), `@tailwind base;
@tailwind components;
@tailwind utilities;
`);

      // --- Frontend: tailwind.config.js ---
      fs.writeFileSync(path.join(frontendPath, "tailwind.config.js"), `/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: { extend: {} },
  plugins: [],
};
`);

      // --- Frontend: postcss.config.js ---
      fs.writeFileSync(path.join(frontendPath, "postcss.config.js"), `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`);

      // --- Frontend: vite.config.js ---
      fs.writeFileSync(path.join(frontendPath, "vite.config.js"), `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5000'
    }
  }
});
`);
    } else {
      // --- Frontend: index.html (Vanilla HTML/CSS/JS) ---
      fs.writeFileSync(path.join(frontendPath, "index.html"), `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App</title>
    <link rel="stylesheet" href="/src/style.css" />
  </head>
  <body class="bg-gray-950 text-gray-100 min-h-screen">
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`);

      // --- Frontend: src/style.css ---
      fs.writeFileSync(path.join(frontendPath, "src/style.css"), `/* Base Styles */
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background-color: #0c0c10;
  color: #f3f4f6;
  min-height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
}
`);

      // --- Frontend: src/main.js ---
      fs.writeFileSync(path.join(frontendPath, "src/main.js"), `// Application Entry Point
console.log('App initialized');
`);

      // --- Frontend: vite.config.js ---
      fs.writeFileSync(path.join(frontendPath, "vite.config.js"), `import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
  }
});
`);
    }

    // --- Frontend: src/utils/api.js (only for full-stack) ---
    if (!isFrontendOnly) {
      fs.writeFileSync(path.join(frontendPath, "src/utils/api.js"), `import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = \`Bearer \${token}\`;
  return config;
});

export default api;
`);
    }
  }

  console.log("   Scaffold: boilerplate files created");

  // ─── Step 4: Initialize Git ───────────────────────────────

  try {
    execSync("git init", { cwd: sandboxPath, stdio: "pipe" });
    execSync("git add -A", { cwd: sandboxPath, stdio: "pipe" });
    execSync('git commit -m "Initial scaffold" --allow-empty', { cwd: sandboxPath, stdio: "pipe" });
    execSync("git tag v0.0.0", { cwd: sandboxPath, stdio: "pipe" });
    console.log("   ✅ Git initialized");
  } catch (e) {
    console.warn(`   ⚠️ Git init failed: ${e.message}`);
  }

  // ─── Step 5: Start Docker containers ──────────────────────

  let dbContainerId = null;
  let backendContainerId = null;
  let frontendContainerId = null;

  if (dockerAvailable) {
    try {
      ensureNetwork();

      const runBackend = projectType !== "frontend_only";
      const runDb = projectType !== "frontend_only";
      const runFrontend = projectType !== "backend_only";

      // --- Database Container ---
      if (runDb) {
        console.log(`\n   🗄️  Starting ${dbType === "mongo" ? "MongoDB" : "PostgreSQL"} container...`);

        if (dbType === "mongo") {
          dbContainerId = execSync([
            "docker run -d",
            `--name ${dbContainerName}`,
            `--network ${NETWORK_NAME}`,
            `-v ${volumeName}:/data/db`,
            "-e MONGO_INITDB_DATABASE=appdb",
            "mongo:7",
          ].join(" "), { encoding: "utf-8", stdio: "pipe", timeout: 60000 }).trim();

          console.log(`   🗄️  MongoDB container: ${dbContainerId.slice(0, 12)}`);
          console.log("   ⏳ Waiting for MongoDB to be ready...");
          const dbReady = waitForContainer(dbContainerId, "mongosh --eval 'db.runCommand({ping:1})' --quiet", 30);
          console.log(dbReady ? "   ✅ MongoDB ready" : "   ⚠️ MongoDB may not be ready");

        } else {
          dbContainerId = execSync([
            "docker run -d",
            `--name ${dbContainerName}`,
            `--network ${NETWORK_NAME}`,
            `-v ${volumeName}:/var/lib/postgresql/data`,
            "-e POSTGRES_USER=postgres",
            "-e POSTGRES_PASSWORD=postgres",
            "-e POSTGRES_DB=appdb",
            "postgres:16-alpine",
          ].join(" "), { encoding: "utf-8", stdio: "pipe", timeout: 60000 }).trim();

          console.log(`   🗄️  PostgreSQL container: ${dbContainerId.slice(0, 12)}`);
          console.log("   ⏳ Waiting for PostgreSQL to be ready...");
          const dbReady = waitForContainer(dbContainerId, "pg_isready -U postgres", 30);
          console.log(dbReady ? "   ✅ PostgreSQL ready" : "   ⚠️ PostgreSQL may not be ready");
        }

        // --- Create Tables ---
        if (dbSchema && dbType === "postgres") {
          console.log("   📊 Creating database tables...");
          const sql = generateCreateTableSQL(dbSchema);
          if (sql) {
            const sqlEscaped = sql.replace(/'/g, "'\\''");
            const createResult = dockerExec(dbContainerId, 
              `psql -U postgres -d appdb -c '${sqlEscaped}'`, 15000);
            if (createResult.exitCode === 0) {
              console.log("   ✅ Tables created");
            } else {
              console.warn(`   ⚠️ Table creation issues: ${createResult.stderr.slice(0, 200)}`);
            }
          }
        }

        if (dbSchema && dbType === "mongo") {
          console.log("   📊 MongoDB collections will be created on first insert (schemaless)");
        }
      }

      // --- Backend Container ---
      if (runBackend) {
        console.log("\n   🖥️  Starting Backend container...");
        backendContainerId = execSync([
          "docker run -d",
          `--name ${backendContainerName}`,
          `--network ${NETWORK_NAME}`,
          `-v "${sandboxPath}:/app"`,
          "-w /app",
          `-e DATABASE_URL=${dbUrl}`,
          "-e JWT_SECRET=dev-secret-change-in-production",
          "-e PORT=5000",
          "-e NODE_ENV=development",
          "node:20-slim",
          "tail -f /dev/null",
        ].join(" "), { encoding: "utf-8", stdio: "pipe", timeout: 30000 }).trim();

        console.log(`   🖥️  Backend container: ${backendContainerId.slice(0, 12)}`);

        console.log("   📦 Installing backend dependencies...");
        const backendInstall = dockerExec(backendContainerId, "cd /app/backend && npm install 2>&1", 120000);
        console.log(backendInstall.exitCode === 0 
          ? "   ✅ Backend dependencies installed" 
          : `   ⚠️ Backend npm install issues: ${backendInstall.stderr.slice(0, 200)}`);
      }

      // --- Frontend Container ---
      if (runFrontend) {
        console.log("\n   🎨 Starting Frontend container...");
        const apiUrlEnv = runBackend ? `http://${backendContainerName}:5000/api` : "";
        frontendContainerId = execSync([
          "docker run -d",
          `--name ${frontendContainerName}`,
          `--network ${NETWORK_NAME}`,
          `-v "${sandboxPath}:/app"`,
          "-w /app",
          `-e VITE_API_URL=${apiUrlEnv}`,
          "node:20-slim",
          "tail -f /dev/null",
        ].join(" "), { encoding: "utf-8", stdio: "pipe", timeout: 30000 }).trim();

        console.log(`   🎨 Frontend container: ${frontendContainerId.slice(0, 12)}`);

        console.log("   📦 Installing frontend dependencies...");
        const frontendInstall = dockerExec(frontendContainerId, "cd /app/frontend && npm install 2>&1", 120000);
        console.log(frontendInstall.exitCode === 0 
          ? "   ✅ Frontend dependencies installed" 
          : `   ⚠️ Frontend npm install issues: ${frontendInstall.stderr.slice(0, 200)}`);
      }

    } catch (e) {
      console.warn(`   ⚠️ Docker setup failed: ${e.message}`);
      console.warn("   Falling back to local-only mode");
    }
  }

  // ─── Store sandbox info ───────────────────────────────────

  sandboxes.set(sandboxId, {
    path: sandboxPath,
    backendPath,
    frontendPath,
    dbType,
    dbContainerId,
    backendContainerId,
    frontendContainerId,
    dbContainerName,
    backendContainerName,
    frontendContainerName,
    runBackend: !isFrontendOnly,
    runDb: !isFrontendOnly,
    runFrontend: !isBackendOnly,
    projectType,
    createdAt: Date.now(),
    snapshotCount: 0,
  });

  return sandboxId;
}

// ═══════════════════════════════════════════════════════════════
// RECONNECT SANDBOX (for resume)
// ═══════════════════════════════════════════════════════════════

function getDockerContainerState(name) {
  try {
    const out = execSync(`docker inspect -f "{{.State.Running}} {{.Id}}" ${name}`, { stdio: "pipe", encoding: "utf-8" }).trim();
    const parts = out.split(" ");
    const isRunning = parts[0] === "true";
    const id = parts[1] || null;
    return { exists: true, running: isRunning, id };
  } catch {
    return { exists: false, running: false, id: null };
  }
}

/**
 * Ensure sandbox is loaded in memory map.
 * Reconnects from disk and running containers if server was restarted.
 */
export function ensureSandboxLoaded(sandboxId) {
  if (!sandboxId) return null;
  let s = sandboxes.get(sandboxId);
  if (s) return s;

  const sandboxPath = findSandboxPath(sandboxId);
  if (!sandboxPath || !fs.existsSync(sandboxPath)) return null;

  const backendPath = path.join(sandboxPath, "backend");
  const frontendPath = path.join(sandboxPath, "frontend");
  const hasBackend = fs.existsSync(backendPath);
  const hasFrontend = fs.existsSync(frontendPath);
  const projectType = hasBackend && hasFrontend ? "full_stack" : hasBackend ? "backend_only" : "frontend_only";

  let dbType = "postgres";
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(backendPath, "package.json"), "utf-8"));
    if (pkg.dependencies?.mongoose) dbType = "mongo";
  } catch (_) {}

  const dbContainerName = `aidev-db-${sandboxId}`;
  const backendContainerName = `aidev-backend-${sandboxId}`;
  const frontendContainerName = `aidev-frontend-${sandboxId}`;

  const dbState = dockerAvailable && hasBackend ? getDockerContainerState(dbContainerName) : { exists: false, id: null };
  const backendState = dockerAvailable && hasBackend ? getDockerContainerState(backendContainerName) : { exists: false, id: null };
  const frontendState = dockerAvailable && hasFrontend ? getDockerContainerState(frontendContainerName) : { exists: false, id: null };

  s = {
    path: sandboxPath,
    backendPath,
    frontendPath,
    dbType,
    dbContainerId: dbState.id,
    backendContainerId: backendState.id,
    frontendContainerId: frontendState.id,
    dbContainerName,
    backendContainerName,
    frontendContainerName,
    runBackend: hasBackend,
    runDb: hasBackend,
    runFrontend: hasFrontend,
    projectType,
    createdAt: Date.now(),
    snapshotCount: 0,
  };

  sandboxes.set(sandboxId, s);
  return s;
}

/**
 * Reconnect to an existing sandbox folder by reusing or recovering Docker containers.
 * Used when resuming a project — preserves existing files and running containers.
 */
export async function reconnectSandbox(sandboxId) {
  if (!sandboxId) return false;

  const sandboxPath = findSandboxPath(sandboxId);

  console.log(`\n   🔄 Reconnecting sandbox: ${sandboxId}`);

  // Check folder exists on disk
  if (!sandboxPath || !fs.existsSync(sandboxPath)) {
    console.error(`   ❌ Sandbox folder not found: ${sandboxPath || sandboxId}`);
    return null;
  }

  console.log(`   📂 Found existing sandbox at: ${sandboxPath}`);

  const backendPath = path.join(sandboxPath, "backend");
  const frontendPath = path.join(sandboxPath, "frontend");
  const hasBackend = fs.existsSync(backendPath);
  const hasFrontend = fs.existsSync(frontendPath);
  const projectType = hasBackend && hasFrontend ? "full_stack" : hasBackend ? "backend_only" : "frontend_only";

  // Detect DB type from backend package.json
  let dbType = "postgres";
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(backendPath, "package.json"), "utf-8"));
    if (pkg.dependencies?.mongoose) dbType = "mongo";
  } catch (e) { /* default postgres */ }

  const dbContainerName = `aidev-db-${sandboxId}`;
  const backendContainerName = `aidev-backend-${sandboxId}`;
  const frontendContainerName = `aidev-frontend-${sandboxId}`;

  const dbUrl = dbType === "mongo"
    ? `mongodb://${dbContainerName}:27017/appdb`
    : `postgresql://postgres:postgres@${dbContainerName}:5432/appdb`;

  if (!dockerAvailable) {
    console.log("   ℹ️ Docker not available — using existing local filesystem sandbox");
    sandboxes.set(sandboxId, {
      path: sandboxPath,
      backendPath,
      frontendPath,
      dbType,
      dbContainerId: null,
      backendContainerId: null,
      frontendContainerId: null,
      dbContainerName,
      backendContainerName,
      frontendContainerName,
      runBackend: hasBackend,
      runDb: hasBackend,
      runFrontend: hasFrontend,
      projectType,
      createdAt: Date.now(),
      snapshotCount: 0,
    });
    return { sandboxId, reused: true, docker: false };
  }

  try {
    ensureNetwork();

    let dbContainerId = null;
    let backendContainerId = null;
    let frontendContainerId = null;

    // --- DB Container ---
    if (hasBackend) {
      const dbState = getDockerContainerState(dbContainerName);
      if (dbState.exists && dbState.running) {
        dbContainerId = dbState.id;
        console.log(`   🗄️  Reusing active ${dbType === "mongo" ? "MongoDB" : "PostgreSQL"} container: ${dbContainerId.slice(0, 12)}`);
      } else if (dbState.exists && !dbState.running) {
        console.log(`   🗄️  Starting stopped ${dbType === "mongo" ? "MongoDB" : "PostgreSQL"} container...`);
        execSync(`docker start ${dbContainerName}`, { stdio: "pipe", timeout: 30000 });
        dbContainerId = dbState.id;
      } else {
        console.log(`   🗄️  Creating ${dbType === "mongo" ? "MongoDB" : "PostgreSQL"} container for existing sandbox...`);
        const volumeName = `aidev-dbdata-${sandboxId}`;
        if (dbType === "mongo") {
          dbContainerId = execSync([
            "docker run -d",
            `--name ${dbContainerName}`,
            `--network ${NETWORK_NAME}`,
            `-v ${volumeName}:/data/db`,
            "-e MONGO_INITDB_DATABASE=appdb",
            "mongo:7",
          ].join(" "), { encoding: "utf-8", stdio: "pipe", timeout: 60000 }).trim();
          waitForContainer(dbContainerId, "mongosh --eval 'db.runCommand({ping:1})' --quiet", 30);
        } else {
          dbContainerId = execSync([
            "docker run -d",
            `--name ${dbContainerName}`,
            `--network ${NETWORK_NAME}`,
            `-v ${volumeName}:/var/lib/postgresql/data`,
            "-e POSTGRES_USER=postgres",
            "-e POSTGRES_PASSWORD=postgres",
            "-e POSTGRES_DB=appdb",
            "postgres:16-alpine",
          ].join(" "), { encoding: "utf-8", stdio: "pipe", timeout: 60000 }).trim();
          waitForContainer(dbContainerId, "pg_isready -U postgres", 30);
        }
      }
    }

    // --- Backend Container ---
    if (hasBackend) {
      const backendState = getDockerContainerState(backendContainerName);
      if (backendState.exists && backendState.running) {
        backendContainerId = backendState.id;
        console.log(`   🖥️  Reusing active Backend container: ${backendContainerId.slice(0, 12)}`);
      } else if (backendState.exists && !backendState.running) {
        console.log("   🖥️  Starting stopped Backend container...");
        execSync(`docker start ${backendContainerName}`, { stdio: "pipe", timeout: 30000 });
        backendContainerId = backendState.id;
      } else {
        console.log("   🖥️  Creating Backend container for existing sandbox...");
        backendContainerId = execSync([
          "docker run -d",
          `--name ${backendContainerName}`,
          `--network ${NETWORK_NAME}`,
          `-v "${sandboxPath}:/app"`,
          "-w /app",
          `-e DATABASE_URL=${dbUrl}`,
          "-e JWT_SECRET=dev-secret-change-in-production",
          "-e PORT=5000",
          "-e NODE_ENV=development",
          "node:20-slim",
          "tail -f /dev/null",
        ].join(" "), { encoding: "utf-8", stdio: "pipe", timeout: 30000 }).trim();

        // Only run npm install if node_modules does not exist
        const hasNodeModules = fs.existsSync(path.join(backendPath, "node_modules"));
        if (!hasNodeModules) {
          console.log("   📦 Installing backend dependencies...");
          dockerExec(backendContainerId, "cd /app/backend && npm install 2>&1", 120000);
        } else {
          console.log("   ✅ Backend node_modules already exists on disk — skipping npm install");
        }
      }
    }

    // --- Frontend Container ---
    if (hasFrontend) {
      const frontendState = getDockerContainerState(frontendContainerName);
      if (frontendState.exists && frontendState.running) {
        frontendContainerId = frontendState.id;
        console.log(`   🎨 Reusing active Frontend container: ${frontendContainerId.slice(0, 12)}`);
      } else if (frontendState.exists && !frontendState.running) {
        console.log("   🎨 Starting stopped Frontend container...");
        execSync(`docker start ${frontendContainerName}`, { stdio: "pipe", timeout: 30000 });
        frontendContainerId = frontendState.id;
      } else {
        console.log("   🎨 Creating Frontend container for existing sandbox...");
        frontendContainerId = execSync([
          "docker run -d",
          `--name ${frontendContainerName}`,
          `--network ${NETWORK_NAME}`,
          `-v "${sandboxPath}:/app"`,
          "-w /app",
          `-e VITE_API_URL=http://${backendContainerName}:5000/api`,
          "node:20-slim",
          "tail -f /dev/null",
        ].join(" "), { encoding: "utf-8", stdio: "pipe", timeout: 30000 }).trim();

        // Only run npm install if node_modules does not exist
        const hasNodeModules = fs.existsSync(path.join(frontendPath, "node_modules"));
        if (!hasNodeModules) {
          console.log("   📦 Installing frontend dependencies...");
          dockerExec(frontendContainerId, "cd /app/frontend && npm install 2>&1", 120000);
        } else {
          console.log("   ✅ Frontend node_modules already exists on disk — skipping npm install");
        }
      }
    }

    // Store in sandboxes map
    sandboxes.set(sandboxId, {
      path: sandboxPath,
      backendPath,
      frontendPath,
      dbType,
      dbContainerId,
      backendContainerId,
      frontendContainerId,
      dbContainerName,
      backendContainerName,
      frontendContainerName,
      runBackend: hasBackend,
      runDb: hasBackend,
      runFrontend: hasFrontend,
      projectType,
      createdAt: Date.now(),
      snapshotCount: 0,
    });

    console.log("   ✅ Sandbox reconnected! Preserved workspace and active containers.\n");
    return { sandboxId, reused: true, docker: true };

  } catch (e) {
    console.error(`   ❌ Reconnect failed: ${e.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════

function generateCreateTableSQL(dbSchema) {
  if (!dbSchema?.tables?.length) return null;

  const statements = [];

  for (const table of dbSchema.tables) {
    const fields = (table.fields || []).map(f => {
      const constraints = (f.constraints || []).join(" ");
      return `  ${f.name} ${f.type || "TEXT"} ${constraints}`.trimEnd();
    });

    let sql = `CREATE TABLE IF NOT EXISTS ${table.name} (\n${fields.join(",\n")}\n)`;
    statements.push(sql + ";");
  }

  // Add foreign keys as ALTER TABLE (safer — handles table creation order)
  for (const table of dbSchema.tables) {
    if (table.foreignKeys) {
      for (const fk of table.foreignKeys) {
        statements.push(
          `ALTER TABLE ${table.name} ADD CONSTRAINT IF NOT EXISTS fk_${table.name}_${fk.field} ` +
          `FOREIGN KEY (${fk.field}) REFERENCES ${fk.references} ON DELETE ${fk.onDelete || "CASCADE"};`
        );
      }
    }
  }

  // Add indexes
  for (const table of dbSchema.tables) {
    if (table.indexes) {
      for (const idx of table.indexes) {
        const idxName = `idx_${table.name}_${idx.replace(/,/g, "_")}`;
        statements.push(
          `CREATE INDEX IF NOT EXISTS ${idxName} ON ${table.name} (${idx});`
        );
      }
    }
  }

  return statements.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════════

export async function healthCheck(sandboxId) {
  const sandbox = ensureSandboxLoaded(sandboxId);
  if (!sandbox) return { healthy: false, failures: ["Sandbox not found"] };

  const failures = [];

  // Check directories
  if (sandbox.runBackend && !fs.existsSync(sandbox.backendPath)) failures.push("Backend directory missing");
  if (sandbox.runFrontend && !fs.existsSync(sandbox.frontendPath)) failures.push("Frontend directory missing");

  // Check package.json
  if (sandbox.runBackend && !fs.existsSync(path.join(sandbox.backendPath, "package.json"))) failures.push("Backend package.json missing");
  if (sandbox.runFrontend && !fs.existsSync(path.join(sandbox.frontendPath, "package.json"))) failures.push("Frontend package.json missing");

  // Check Git
  try { execSync("git status", { cwd: sandbox.path, stdio: "pipe" }); }
  catch (e) { failures.push("Git not initialized"); }

  // Check DB container
  if (sandbox.runDb && sandbox.dbContainerId) {
    if (sandbox.dbType === "postgres") {
      const result = dockerExec(sandbox.dbContainerId, "pg_isready -U postgres", 5000);
      if (result.exitCode !== 0) failures.push("PostgreSQL not responding");
    } else {
      const result = dockerExec(sandbox.dbContainerId, "mongosh --eval 'db.runCommand({ping:1})' --quiet", 5000);
      if (result.exitCode !== 0) failures.push("MongoDB not responding");
    }
  }

  // Check Backend container
  if (sandbox.runBackend) {
    if (sandbox.backendContainerId) {
      const result = dockerExec(sandbox.backendContainerId, "node --version", 5000);
      if (result.exitCode !== 0) failures.push("Backend container not responding");

      const nmCheck = dockerExec(sandbox.backendContainerId, "ls /app/backend/node_modules/.package-lock.json 2>/dev/null", 5000);
      if (nmCheck.exitCode !== 0) failures.push("Backend node_modules not installed");
    } else {
      failures.push("No backend container");
    }
  }

  // Check Frontend container
  if (sandbox.runFrontend) {
    if (sandbox.frontendContainerId) {
      const result = dockerExec(sandbox.frontendContainerId, "node --version", 5000);
      if (result.exitCode !== 0) failures.push("Frontend container not responding");
    } else {
      failures.push("No frontend container");
    }
  }

  // Check tables exist (PostgreSQL)
  if (sandbox.runDb && sandbox.dbContainerId && sandbox.dbType === "postgres") {
    const tableCheck = dockerExec(sandbox.dbContainerId,
      "psql -U postgres -d appdb -c \"SELECT tablename FROM pg_tables WHERE schemaname='public'\" -t", 5000);
    if (tableCheck.exitCode === 0 && tableCheck.stdout.trim()) {
      const tables = tableCheck.stdout.trim().split("\n").map(t => t.trim()).filter(Boolean);
      console.log(`   📊 Tables found: ${tables.join(", ")}`);
    }
  }

  return {
    healthy: failures.length === 0,
    failures,
    sandboxPath: sandbox.path,
    dockerEnabled: !!(sandbox.backendContainerId || sandbox.frontendContainerId),
  };
}

// ═══════════════════════════════════════════════════════════════
// FILE OPERATIONS (local disk — instant)
// ═══════════════════════════════════════════════════════════════

export function resolveSandboxFilePath(sandbox, filePath) {
  if (!filePath) return sandbox.path;
  let rel = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel.startsWith("frontend/") && !rel.startsWith("backend/")) {
    if (rel === "docker-compose.yml" || rel === "README.md" || rel === ".gitignore") {
      return path.join(sandbox.path, rel);
    }
    if (sandbox.runFrontend && !sandbox.runBackend) {
      rel = `frontend/${rel}`;
    } else if (sandbox.runBackend && !sandbox.runFrontend) {
      rel = `backend/${rel}`;
    }
  }
  const resolved = path.resolve(sandbox.path, rel);
  const normalizedRoot = path.resolve(sandbox.path);
  if (!resolved.startsWith(normalizedRoot)) {
    throw new Error("Path traversal outside sandbox root");
  }
  return resolved;
}

export function writeFile(sandboxId, filePath, content) {
  const sandbox = ensureSandboxLoaded(sandboxId);
  if (!sandbox) throw new Error(`Sandbox ${sandboxId} not found`);
  const fullPath = resolveSandboxFilePath(sandbox, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
}

export function readFile(sandboxId, filePath) {
  const sandbox = ensureSandboxLoaded(sandboxId);
  if (!sandbox) throw new Error(`Sandbox ${sandboxId} not found`);
  const fullPath = resolveSandboxFilePath(sandbox, filePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, "utf-8");
}

export function getFileList(sandboxId) {
  const sandbox = ensureSandboxLoaded(sandboxId);
  if (!sandbox) throw new Error(`Sandbox ${sandboxId} not found`);
  const files = [];
  function walk(dir, prefix = "") {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else files.push(rel);
    }
  }
  walk(sandbox.path);
  return files;
}

// ═══════════════════════════════════════════════════════════════
// COMMAND EXECUTION
// ═══════════════════════════════════════════════════════════════

/**
 * Execute command in the appropriate container.
 * Detects backend vs frontend from the command path.
 */
export function executeCommand(sandboxId, command, timeout = 30000) {
  const sandbox = ensureSandboxLoaded(sandboxId);
  if (!sandbox) throw new Error(`Sandbox ${sandboxId} not found`);

  // Route to correct container based on command content
  if (sandbox.backendContainerId && (command.includes("/app/backend") || command.includes("cd /app/backend"))) {
    return dockerExec(sandbox.backendContainerId, command, timeout);
  }
  if (sandbox.frontendContainerId && (command.includes("/app/frontend") || command.includes("cd /app/frontend"))) {
    return dockerExec(sandbox.frontendContainerId, command, timeout);
  }

  // Default: use backend container for general commands, or frontend container if backend unavailable
  if (sandbox.backendContainerId) {
    return dockerExec(sandbox.backendContainerId, command, timeout);
  }
  if (sandbox.frontendContainerId) {
    return dockerExec(sandbox.frontendContainerId, command, timeout);
  }

  // Local fallback
  try {
    const stdout = execSync(command, {
      cwd: sandbox.path, timeout, stdio: "pipe", encoding: "utf-8",
    });
    return { stdout: stdout || "", stderr: "", exitCode: 0 };
  } catch (error) {
    return {
      stdout: error.stdout || "",
      stderr: error.stderr || error.message,
      exitCode: error.status || 1,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// GIT OPERATIONS
// ═══════════════════════════════════════════════════════════════

export function snapshot(sandboxId, message) {
  const sandbox = ensureSandboxLoaded(sandboxId);
  if (!sandbox) throw new Error(`Sandbox ${sandboxId} not found`);
  sandbox.snapshotCount++;
  const tag = `v0.${sandbox.snapshotCount}.0`;
  try {
    execSync("git add -A", { cwd: sandbox.path, stdio: "pipe" });
    execSync(`git commit -m "${message}" --allow-empty`, { cwd: sandbox.path, stdio: "pipe" });
    execSync(`git tag ${tag}`, { cwd: sandbox.path, stdio: "pipe" });
    return { success: true, tag, message };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export function rollback(sandboxId, tag) {
  const sandbox = ensureSandboxLoaded(sandboxId);
  if (!sandbox) throw new Error(`Sandbox ${sandboxId} not found`);
  try {
    execSync(`git checkout ${tag}`, { cwd: sandbox.path, stdio: "pipe" });
    return { success: true, rolledBackTo: tag };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

export function getSandboxPath(sandboxId) {
  return ensureSandboxLoaded(sandboxId)?.path || null;
}

export function getSandboxInfo(sandboxId) {
  const sandbox = ensureSandboxLoaded(sandboxId);
  if (!sandbox) return null;
  return {
    path: sandbox.path,
    dockerEnabled: !!(sandbox.backendContainerId || sandbox.frontendContainerId),
    dbType: sandbox.dbType,
    dbContainer: sandbox.dbContainerId?.slice(0, 12),
    backendContainer: sandbox.backendContainerId?.slice(0, 12),
    frontendContainer: sandbox.frontendContainerId?.slice(0, 12),
  };
}

export function destroySandbox(sandboxId) {
  const sandbox = sandboxes.get(sandboxId) || ensureSandboxLoaded(sandboxId);
  if (!sandbox) {
    const directPath = findSandboxPath(sandboxId);
    if (directPath && fs.existsSync(directPath)) {
      try { fs.rmSync(directPath, { recursive: true, force: true }); }
      catch (e) { /* best effort */ }
    }
    return;
  }

  // Remove all containers
  const containers = [sandbox.dbContainerId, sandbox.backendContainerId, sandbox.frontendContainerId];
  for (const id of containers) {
    if (id) {
      try { execSync(`docker rm -f ${id}`, { stdio: "pipe", timeout: 10000 }); }
      catch (e) { /* best effort */ }
    }
  }
  console.log("   🐳 Containers removed");

  // Remove local files
  try { fs.rmSync(sandbox.path, { recursive: true, force: true }); }
  catch (e) { /* best effort */ }

  sandboxes.delete(sandboxId);
}
