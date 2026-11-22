/**
 * deploymentVerifier.js — Generate & Verify Docker Deployment
 * 
 * FIRST PRINCIPLES:
 * The LLM should NOT generate Dockerfiles or docker-compose.yml because:
 * 1. It doesn't know the exact sandbox directory structure
 * 2. It doesn't know which port the backend listens on
 * 3. It doesn't know the container names on the Docker network
 * 4. It doesn't know the entry point path (src/index.js vs src/server.js)
 * 
 * Instead, WE generate these files deterministically based on:
 * - The sandbox's package.json (knows the entry point)
 * - The blueprint's DB type (postgres vs mongo)
 * - Fixed conventions (backend on :5000, frontend on :5173)
 * 
 * Then we verify by running docker-compose up and testing endpoints.
 */

import { execSync } from "child_process";
import { getSandboxPath, readFile } from "../utils/sandboxManager.js";
import fs from "fs";
import path from "path";

const BACKEND_PORT = 15000;
const FRONTEND_PORT = 15173;
const DB_PORT = 15432;

/**
 * Detect the backend entry point by checking what actually exists
 */
function detectBackendEntry(sandboxPath) {
  const candidates = [
    "src/index.js",
    "src/server.js",
    "src/app.js",
    "index.js",
    "server.js",
    "app.js",
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(sandboxPath, "backend", candidate))) {
      return candidate;
    }
  }

  // Fallback: check package.json
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(sandboxPath, "backend", "package.json"), "utf-8"));
    if (pkg.main) return pkg.main;
    if (pkg.scripts?.start) {
      const match = pkg.scripts.start.match(/node\s+(.+)/);
      if (match) return match[1].trim();
    }
  } catch (e) {}

  return "src/index.js"; // final fallback
}

/**
 * Detect DB type from backend dependencies
 */
function detectDbType(sandboxPath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(sandboxPath, "backend", "package.json"), "utf-8"));
    if (pkg.dependencies?.mongoose || pkg.dependencies?.mongodb) return "mongo";
  } catch (e) {}
  return "postgres";
}

/**
 * Generate all Docker deployment files with CORRECT paths
 */
function generateDeploymentFiles(sandboxPath, projectType = "full_stack") {
  const entryPoint = detectBackendEntry(sandboxPath);
  const dbType = detectDbType(sandboxPath);
  const dbImage = dbType === "mongo" ? "mongo:7" : "postgres:16-alpine";
  const dbPort = dbType === "mongo" ? "27017" : "5432";
  const dbEnv = dbType === "mongo"
    ? "MONGO_INITDB_DATABASE: appdb"
    : `POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: appdb`;
  const dbUrl = dbType === "mongo"
    ? "mongodb://db:27017/appdb"
    : "postgresql://postgres:postgres@db:5432/appdb";
  const dbHealthCheck = dbType === "mongo"
    ? 'mongosh --eval "db.runCommand({ping:1})" --quiet'
    : "pg_isready -U postgres";
  const dbHealthInterval = "5s";

  console.log(`   Project type: ${projectType}`);

  if (projectType !== "frontend_only") {
    // ─── Backend Dockerfile ────────────────────────────────
    const backendDockerfile = `FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 5000
CMD ["node", "${entryPoint}"]
`;
    fs.writeFileSync(path.join(sandboxPath, "backend", "Dockerfile"), backendDockerfile);
    console.log("   Generated: backend/Dockerfile");
  }

  if (projectType !== "backend_only") {
    // Check if frontend has package.json and build script
    const frontendPkgPath = path.join(sandboxPath, "frontend", "package.json");
    let hasBuildScript = false;
    if (fs.existsSync(frontendPkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(frontendPkgPath, "utf-8"));
        if (pkg.scripts && pkg.scripts.build) {
          hasBuildScript = true;
        }
        // If build script uses vite, ensure vite is in devDependencies
        if (pkg.scripts?.build?.includes("vite") || pkg.scripts?.dev?.includes("vite")) {
          pkg.devDependencies = pkg.devDependencies || {};
          if (!pkg.devDependencies.vite && !pkg.dependencies?.vite) {
            pkg.devDependencies.vite = "^5.0.0";
            fs.writeFileSync(frontendPkgPath, JSON.stringify(pkg, null, 2));
            console.log("   Added missing vite to frontend devDependencies");
          }
        }
      } catch (e) {
        console.warn("   Failed to parse frontend package.json:", e.message);
      }
    }

    let frontendDockerfile;
    if (hasBuildScript) {
      // ─── Frontend Dockerfile (multi-stage: build with vite, serve with nginx) ──
      frontendDockerfile = `FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
`;
    } else {
      // ─── Frontend Dockerfile (vanilla static HTML/CSS/JS, serve directly with nginx) ──
      frontendDockerfile = `FROM nginx:alpine
COPY . /usr/share/nginx/html
RUN rm -f /usr/share/nginx/html/Dockerfile /usr/share/nginx/html/nginx.conf /usr/share/nginx/html/package*.json
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
`;
    }

    fs.writeFileSync(path.join(sandboxPath, "frontend", "Dockerfile"), frontendDockerfile);
    console.log("   Generated: frontend/Dockerfile");

    // ─── Nginx config ────────────────────────────────
    const nginxConf = projectType === "frontend_only" ? `server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
` : `server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # API proxy to backend service
    location /api/ {
        proxy_pass http://backend:5000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SPA fallback — serve index.html for all non-file routes
    location / {
        try_files $uri $uri/ /index.html;
    }
}
`;
    fs.writeFileSync(path.join(sandboxPath, "frontend", "nginx.conf"), nginxConf);
    console.log("   Generated: frontend/nginx.conf");
  }

  // ─── docker-compose.yml ────────────────────────────────
  let composeServices = "";

  if (projectType === "frontend_only") {
    composeServices = `  frontend:
    build: ./frontend
    restart: unless-stopped
    ports:
      - "${FRONTEND_PORT}:80"
`;
  } else if (projectType === "backend_only") {
    composeServices = `  db:
    image: ${dbImage}
    restart: unless-stopped
    ports:
      - "${DB_PORT}:${dbPort}"
    environment:
      ${dbEnv}
    volumes:
      - db_data:/var/lib/${dbType === "mongo" ? "mongodb" : "postgresql"}/data
    healthcheck:
      test: ["CMD-SHELL", "${dbHealthCheck}"]
      interval: ${dbHealthInterval}
      timeout: 5s
      retries: 10

  backend:
    build: ./backend
    restart: unless-stopped
    ports:
      - "${BACKEND_PORT}:5000"
    environment:
      DATABASE_URL: ${dbUrl}
      JWT_SECRET: dev-secret-change-in-production
      PORT: "5000"
      NODE_ENV: production
    depends_on:
      db:
        condition: service_healthy
    env_file:
      - ./backend/.env
`;
  } else {
    composeServices = `  db:
    image: ${dbImage}
    restart: unless-stopped
    ports:
      - "${DB_PORT}:${dbPort}"
    environment:
      ${dbEnv}
    volumes:
      - db_data:/var/lib/${dbType === "mongo" ? "mongodb" : "postgresql"}/data
    healthcheck:
      test: ["CMD-SHELL", "${dbHealthCheck}"]
      interval: ${dbHealthInterval}
      timeout: 5s
      retries: 10

  backend:
    build: ./backend
    restart: unless-stopped
    ports:
      - "${BACKEND_PORT}:5000"
    environment:
      DATABASE_URL: ${dbUrl}
      JWT_SECRET: dev-secret-change-in-production
      PORT: "5000"
      NODE_ENV: production
    depends_on:
      db:
        condition: service_healthy
    env_file:
      - ./backend/.env

  frontend:
    build: ./frontend
    restart: unless-stopped
    ports:
      - "${FRONTEND_PORT}:80"
    depends_on:
      - backend
`;
  }

  const compose = `version: "3.8"

services:
${composeServices}
volumes:
  db_data:
`;
  fs.writeFileSync(path.join(sandboxPath, "docker-compose.yml"), compose);
  console.log("   Generated: docker-compose.yml");

  // ─── Ensure .env files exist ───────────────────────────
  if (projectType !== "frontend_only" && fs.existsSync(path.join(sandboxPath, "backend"))) {
    const backendEnv = path.join(sandboxPath, "backend", ".env");
    if (!fs.existsSync(backendEnv)) {
      fs.writeFileSync(backendEnv, [
        `DATABASE_URL=${dbUrl}`,
        "JWT_SECRET=dev-secret-change-in-production",
        "PORT=5000",
        "NODE_ENV=production",
      ].join("\n") + "\n");
    }
  }

  if (projectType !== "backend_only" && fs.existsSync(path.join(sandboxPath, "frontend"))) {
    const frontendEnv = path.join(sandboxPath, "frontend", ".env");
    if (!fs.existsSync(frontendEnv)) {
      fs.writeFileSync(frontendEnv, [
        `VITE_API_URL=/api`,
      ].join("\n") + "\n");
    }

    // ─── Also ensure frontend has a vite.config if missing ──
    const viteConfig = path.join(sandboxPath, "frontend", "vite.config.js");
    if (!fs.existsSync(viteConfig)) {
      fs.writeFileSync(viteConfig, `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:5000'
    }
  }
});
`);
      console.log("   Generated: frontend/vite.config.js");
    }
  }

  return { entryPoint, dbType };
}




export function getPublishedPorts(sandboxPath) {
  const ports = {
    backend: BACKEND_PORT,
    frontend: FRONTEND_PORT,
    db: DB_PORT,
  };

  if (!sandboxPath) return ports;

  const composePath = path.join(sandboxPath, "docker-compose.yml");
  if (!fs.existsSync(composePath)) return ports;

  try {
    const content = fs.readFileSync(composePath, "utf-8");
    const servicesPart = content.split(/services:\s*/i)[1];
    if (!servicesPart) return ports;

    const lines = servicesPart.split("\n");
    let currentService = "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const indent = line.search(/\S/);
      if (indent >= 0 && indent <= 2 && trimmed.endsWith(":")) {
        const key = trimmed.slice(0, -1).toLowerCase();
        if (["backend", "frontend", "db", "postgres", "mongo", "database"].some(s => key.includes(s))) {
          currentService = key;
        }
      }

      const portMatch = line.match(/-\s*["']?(\d+):(\d+)["']?/);
      if (portMatch && currentService) {
        const hostPort = parseInt(portMatch[1], 10);
        if (currentService.includes("backend")) ports.backend = hostPort;
        else if (currentService.includes("frontend")) ports.frontend = hostPort;
        else if (currentService.includes("db") || currentService.includes("postgres") || currentService.includes("mongo") || currentService.includes("database")) ports.db = hostPort;
      }
    }
  } catch (e) {
    // Fallback to default ports
  }

  return ports;
}

export async function testHttpEndpoint(url, timeoutMs = 5000, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: { "User-Agent": "DevTeam-DeploymentVerifier/1.0" },
      });
      clearTimeout(timeoutId);
      return {
        reachable: true,
        statusCode: res.status,
        statusText: res.statusText,
        url,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (attempt < maxRetries) {
        await sleep(2000);
        continue;
      }
      return {
        reachable: false,
        statusCode: 0,
        statusText: error.name === "AbortError" ? "Timeout" : (error.message || "Connection refused"),
        error: error.message,
        url,
      };
    }
  }
}

export async function deploymentVerifierNode(state) {
  const attempts = state.deploymentAttempts || 0;

  if (attempts >= 2) {
    console.log("\n[Deployment Verifier] Max attempts reached. Presenting project as-is.\n");
    return {
      completedNodes: ["deploymentVerifier"],
      deploymentAttempts: attempts,
      deploymentHealthy: false,
      executionResult: { result: "fail", output: "Skipped — max attempts. Code is complete, docker-compose may need manual fixes.", errors: "Max deployment verification attempts reached." },
    };
  }

  console.log(`\n[Deployment Verifier] Setting up deployment (attempt ${attempts + 1}/2)...\n`);

  const sandboxPath = getSandboxPath(state.sandboxId);
  const projectType = state.projectType || state.clarifiedSpec?.projectType || "full_stack";

  if (!sandboxPath) {
    console.log("   No sandbox path — skipping");
    return {
      completedNodes: ["deploymentVerifier"],
      deploymentAttempts: attempts + 1,
      deploymentHealthy: false,
      executionResult: { result: "fail", output: "Skipped — no sandbox", errors: "Sandbox path unavailable" },
    };
  }

  const outputs = [];
  const errors = [];

  try {
    // ─── Step 1: Generate deployment files ──────────────────
    console.log("   Generating deployment files...");
    const { entryPoint, dbType } = generateDeploymentFiles(sandboxPath, projectType);
    outputs.push(`Generated Dockerfiles (entry: ${entryPoint}, db: ${dbType})`);

    const ports = getPublishedPorts(sandboxPath);
    const backendPort = ports.backend;
    const frontendPort = ports.frontend;
    const backendUrl = `http://localhost:${backendPort}`;
    const frontendUrl = `http://localhost:${frontendPort}`;

    console.log(`[DEPLOY] host_port: ${frontendPort}, container_port: 80, service: frontend`);
    if (projectType !== "frontend_only") {
      console.log(`[DEPLOY] host_port: ${backendPort}, container_port: 5000, service: backend`);
    }

    // ─── Step 2: Build ──────────────────────────────────────
    console.log("   Building containers (this may take a minute)...");
    const buildResult = runInSandbox(sandboxPath, "docker-compose build --no-cache 2>&1", 300000);

    if (buildResult.exitCode !== 0) {
      const fullLog = (buildResult.stdout + "\n" + buildResult.stderr).trim();
      const lastLines = fullLog.split("\n").slice(-20).join("\n");
      console.log("   Build failed. Last 20 lines:");
      console.log(lastLines);
      errors.push(`Docker build failed:\n${lastLines}`);
      return buildVerifyResult(false, outputs, errors, attempts + 1, null, ports, projectType);
    }
    outputs.push("Docker build successful");

    // ─── Step 3: Start ──────────────────────────────────────
    console.log("   Starting services...");
    runInSandbox(sandboxPath, "docker-compose down 2>&1", 15000);

    const upResult = runInSandbox(sandboxPath, "docker-compose up -d 2>&1", 60000);
    if (upResult.exitCode !== 0) {
      const fullLog = (upResult.stdout + "\n" + upResult.stderr).trim();
      errors.push(`docker-compose up failed:\n${fullLog.slice(-500)}`);
      return buildVerifyResult(false, outputs, errors, attempts + 1, null, ports, projectType);
    }
    outputs.push("Services started");

    // ─── Step 4: Wait ───────────────────────────────────────
    console.log("   Waiting 20 seconds for services...");
    await sleep(20000);

    const psResult = runInSandbox(sandboxPath, "docker-compose ps 2>&1", 10000);
    if (psResult.stdout) console.log(psResult.stdout);

    // ─── Step 5: Test Frontend ──────────────────────────────
    let frontendPass = true;
    let frontendTest = { reachable: true, statusCode: 200 };

    if (projectType !== "backend_only") {
      console.log(`\n   Testing frontend at ${frontendUrl}...`);
      frontendTest = await testHttpEndpoint(frontendUrl, 10000);
      frontendPass = frontendTest.reachable && frontendTest.statusCode >= 200 && frontendTest.statusCode < 400;

      console.log(`[HEALTH] endpoint: ${frontendUrl}, status: ${frontendTest.statusCode}, reachable: ${frontendTest.reachable}`);
      if (frontendTest.reachable) {
        console.log(`   Frontend response: HTTP ${frontendTest.statusCode}`);
        console.log(`   Frontend reachable: YES`);
        outputs.push(`Frontend responds: HTTP ${frontendTest.statusCode}`);
      } else {
        console.log(`   Frontend response: ${frontendTest.statusText}`);
        console.log(`   Frontend reachable: NO`);
        const logs = runInSandbox(sandboxPath, "docker-compose logs --tail=30 frontend 2>&1", 10000);
        errors.push(`Frontend not responding at ${frontendUrl} (${frontendTest.statusText}). Logs:\n${logs.stdout.slice(-300)}`);
      }
    }

    // ─── Step 6: Test Backend ───────────────────────────────
    let backendPass = true;
    let backendTest = { reachable: true, statusCode: 200 };

    if (projectType !== "frontend_only") {
      console.log(`\n   Testing backend at ${backendUrl}...`);
      backendTest = null;

      for (const testPath of ["/api/health", "/health", "/status", "/api", "/"]) {
        const res = await testHttpEndpoint(`${backendUrl}${testPath}`, 5000);
        if (res.reachable) {
          backendTest = { ...res, testedPath: testPath };
          break;
        }
      }

      if (!backendTest) {
        backendTest = await testHttpEndpoint(backendUrl, 5000);
      }

      backendPass = backendTest.reachable && backendTest.statusCode >= 200 && backendTest.statusCode <= 404;

      console.log(`[HEALTH] endpoint: ${backendUrl}, status: ${backendTest.statusCode}, reachable: ${backendTest.reachable}`);
      if (backendTest.reachable) {
        console.log(`   Backend response: HTTP ${backendTest.statusCode}`);
        console.log(`   Backend reachable: YES`);
        if (backendTest.statusCode === 404) {
          console.log(`   Note: 404 means server is reachable but the tested route does not exist.`);
        }
        outputs.push(`Backend responds at ${backendTest.testedPath || "/"}: HTTP ${backendTest.statusCode}`);
      } else {
        console.log(`   Backend response: ${backendTest.statusText}`);
        console.log(`   Backend reachable: NO`);
        const logs = runInSandbox(sandboxPath, "docker-compose logs --tail=30 backend 2>&1", 10000);
        errors.push(`Backend not responding at ${backendUrl} (${backendTest.statusText}). Logs:\n${logs.stdout.slice(-300)}`);
      }
    }

    // ─── Step 7: Test Database ──────────────────────────────
    let dbPass = true;
    if (projectType !== "frontend_only") {
      console.log(`\n   Testing database...`);
      dbPass = false;
      const dbCmd = dbType === "mongo"
        ? 'docker-compose exec -T db mongosh --eval "db.runCommand({ping:1})" --quiet 2>&1'
        : 'docker-compose exec -T db pg_isready -U postgres 2>&1';
      const dbTest = runInSandbox(sandboxPath, dbCmd, 10000);

      if (dbTest.exitCode === 0) {
        dbPass = true;
        outputs.push("Database accepting connections");
      } else {
        const psCheck = runInSandbox(sandboxPath, "docker-compose ps db 2>&1", 5000);
        if (psCheck.stdout.includes("Up") || psCheck.stdout.includes("running")) {
          dbPass = true;
          outputs.push("Database container running");
        } else {
          errors.push("Database container not responding");
        }
      }
      console.log(`   Database reachable: ${dbPass ? "YES" : "NO"}`);
    }

    // ─── Step 8: Summary & Evaluation ───────────────────────
    console.log(`\n   Deployment verification:`);
    console.log(`   Frontend: ${frontendPass ? "PASS" : "FAIL"}`);
    console.log(`   Backend: ${backendPass ? "PASS" : "FAIL"}`);
    console.log(`   Database: ${dbPass ? "PASS" : "FAIL"}`);

    const deploymentHealthy = frontendPass && backendPass && dbPass;
    console.log(`\n   Deployment: ${deploymentHealthy ? "PASS" : "FAIL"}`);

    const verification = {
      frontend: {
        reachable: frontendTest.reachable,
        statusCode: frontendTest.statusCode,
        url: frontendUrl,
        pass: frontendPass,
      },
      backend: {
        reachable: backendTest.reachable,
        statusCode: backendTest.statusCode,
        url: backendUrl,
        pass: backendPass,
      },
      database: {
        reachable: dbPass,
        pass: dbPass,
      },
      deploymentHealthy,
    };

    if (!deploymentHealthy) {
      runInSandbox(sandboxPath, "docker-compose down 2>&1", 15000);
    }

    return buildVerifyResult(deploymentHealthy, outputs, errors, attempts + 1, verification, ports, projectType);

  } catch (e) {
    try { runInSandbox(sandboxPath, "docker-compose down 2>&1", 15000); } catch (err) {}
    errors.push(`Verification error: ${e.message}`);
    return buildVerifyResult(false, outputs, errors, attempts + 1, null, { backend: BACKEND_PORT, frontend: FRONTEND_PORT }, projectType);
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function runInSandbox(sandboxPath, command, timeout = 30000) {
  try {
    const stdout = execSync(command, {
      cwd: sandboxPath,
      timeout,
      stdio: "pipe",
      encoding: "utf-8",
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildVerifyResult(passed, outputs, errors, attempts, verification = null, ports = { backend: BACKEND_PORT, frontend: FRONTEND_PORT }, projectType = "full_stack") {
  const backendPort = ports?.backend || BACKEND_PORT;
  const frontendPort = ports?.frontend || FRONTEND_PORT;

  let files = ["docker-compose.yml"];
  let instructions = [
    "cd sandboxes/<sandbox-id>",
    "docker-compose up --build",
  ];

  let deploymentUrl = null;

  if (passed) {
    if (projectType === "backend_only") {
      deploymentUrl = `http://localhost:${backendPort}`;
    } else {
      deploymentUrl = `http://localhost:${frontendPort}`;
    }
  }

  if (projectType === "frontend_only") {
    files.push("frontend/Dockerfile", "frontend/nginx.conf");
    instructions.push(`Frontend: http://localhost:${frontendPort}`);
  } else if (projectType === "backend_only") {
    files.push("backend/Dockerfile");
    instructions.push(`Backend API: http://localhost:${backendPort}/api`);
  } else {
    files.push("backend/Dockerfile", "frontend/Dockerfile", "frontend/nginx.conf");
    instructions.push(`Frontend: http://localhost:${frontendPort}`);
    instructions.push(`Backend API: http://localhost:${backendPort}/api`);
  }

  return {
    completedNodes: ["deploymentVerifier"],
    deploymentAttempts: attempts,
    deploymentHealthy: passed,
    deploymentVerification: verification,
    deploymentUrl,
    executionResult: {
      result: passed ? "pass" : "fail",
      output: outputs.join("\n"),
      errors: errors.join("\n"),
    },
    deploymentConfig: {
      platform: "docker-compose",
      files,
      instructions,
    },
  };
}

/**
 * Router: pass or fail -> presentToUser (never route back into dev loop when tasks are done)
 */
export function deploymentVerifierRouter(state) {
  const isHealthy = state.executionResult?.result === "pass" || state.deploymentHealthy === true;
  console.log(`[ROUTE] from: deploymentVerifier to: presentToUser (healthy: ${isHealthy})`);
  return "presentToUser";
}
