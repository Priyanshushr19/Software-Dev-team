import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import { WebSocketServer } from "ws";

import { initGemini } from "../src/utils/gemini.js";
import { attachAuthUser } from "./middleware/requireAuth.js";
import authRoutes from "./routes/auth.js";
import projectRoutes from "./routes/projects.js";
import { initWebSocket } from "./ws/handler.js";

const PORT = process.env.SERVER_PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

const app = express();

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(attachAuthUser);

app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    console.log(`   ${req.method} ${req.path}`);
  }
  next();
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    version: "1.0.0",
    gemini: !!process.env.GEMINI_API_KEY,
    authenticated: !!req.authUser,
    timestamp: Date.now(),
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/projects", projectRoutes);

const server = createServer(app);
const wss = new WebSocketServer({
  server,
  path: "/ws",
});

initWebSocket(wss);

async function start() {
  console.log("");
  console.log("==============================================");
  console.log("  AI DEV TEAM - Mission Control Server");
  console.log("  Authenticated Dashboard Mode");
  console.log("==============================================");
  console.log("");

  try {
    initGemini(process.env.GEMINI_API_KEY);
    console.log(`   Gemini initialized (model: ${process.env.GEMINI_MODEL || "gemini-2.5-flash"})`);
  } catch (error) {
    console.warn(`   Gemini not available: ${error.message}`);
    console.warn("   Set GEMINI_API_KEY in .env for full functionality");
  }

  server.listen(PORT, () => {
    console.log(`   REST API:    http://localhost:${PORT}/api`);
    console.log(`   WebSocket:   ws://localhost:${PORT}/ws`);
    console.log(`   Frontend:    ${FRONTEND_URL}`);
    console.log("");
    console.log("   Waiting for authenticated dashboard connections...");
    console.log("");
  });
}

start().catch((error) => {
  console.error("   Server failed to start:", error);
  process.exit(1);
});
