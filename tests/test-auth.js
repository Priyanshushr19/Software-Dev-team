import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import authRoutes from "../server/routes/auth.js";
import { attachAuthUser, requireAuth } from "../server/middleware/requireAuth.js";
import { initWebSocket } from "../server/ws/handler.js";

async function runAuthTests() {
  console.log("==============================================");
  console.log("  Testing Authentication System (JWT + Cookies + Google Auth)");
  console.log("==============================================");

  const app = express();
  app.use(cors({ origin: "http://localhost:5173", credentials: true }));
  app.use(cookieParser());
  app.use(express.json());
  app.use(attachAuthUser);

  app.use("/api/auth", authRoutes);
  app.get("/api/protected", requireAuth, (req, res) => {
    res.json({ message: "Access granted", user: req.authUser });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });
  initWebSocket(wss);

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}/api`;
  const wsUrl = `ws://localhost:${port}/ws`;

  let cookieHeader = "";

  try {
    // 1. Test Unauthenticated Access to Protected Endpoint
    console.log("\n[Test 1] Unauthenticated access to /api/protected...");
    const res1 = await fetch(`${baseUrl}/protected`);
    if (res1.status === 401) {
      console.log("   PASSED: Correctly returned 401 Unauthorized.");
    } else {
      throw new Error(`Expected 401, got ${res1.status}`);
    }

    // 2. Test User Registration
    console.log("\n[Test 2] User Registration (/api/auth/register)...");
    const testUser = {
      name: "Test Operator",
      email: `operator_${Date.now()}@example.com`,
      password: "SuperSecretPassword123!",
    };
    const res2 = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testUser),
    });
    const data2 = await res2.json();

    if (res2.status === 201 && data2.user && data2.user.email === testUser.email) {
      console.log(`   PASSED: Registered user ${data2.user.email} (ID: ${data2.user.id}).`);
    } else {
      throw new Error(`Registration failed: ${JSON.stringify(data2)}`);
    }

    // Extract cookie from response headers
    const setCookie = res2.headers.get("set-cookie");
    if (setCookie && setCookie.includes("aidev_session")) {
      console.log("   PASSED: Set-Cookie header contains 'aidev_session' httpOnly JWT.");
      cookieHeader = setCookie.split(";")[0];
    } else {
      throw new Error("Set-Cookie header missing or invalid");
    }

    // 3. Test Authenticated Access using JWT Cookie
    console.log("\n[Test 3] Accessing /api/auth/me with Cookie...");
    const res3 = await fetch(`${baseUrl}/auth/me`, {
      headers: { Cookie: cookieHeader },
    });
    const data3 = await res3.json();
    if (res3.status === 200 && data3.user?.email === testUser.email) {
      console.log(`   PASSED: Authenticated as ${data3.user.email}`);
    } else {
      throw new Error(`Auth check failed: ${JSON.stringify(data3)}`);
    }

    // 4. Test Login Endpoint
    console.log("\n[Test 4] User Login (/api/auth/login)...");
    const res4 = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testUser.email, password: testUser.password }),
    });
    const data4 = await res4.json();
    const loginCookie = res4.headers.get("set-cookie");
    if (res4.status === 200 && data4.user?.email === testUser.email && loginCookie) {
      console.log("   PASSED: User logged in successfully and new JWT cookie issued.");
      cookieHeader = loginCookie.split(";")[0];
    } else {
      throw new Error(`Login failed: ${JSON.stringify(data4)}`);
    }

    // 5. Test WebSocket Connection Authentication
    console.log("\n[Test 5] WebSocket Authentication Gating...");
    // A) Unauthenticated WS attempt
    const wsUnauth = new WebSocket(`${wsUrl}?projectId=test-1`);
    const unauthResult = await new Promise((res) => {
      wsUnauth.on("close", () => res("closed"));
      wsUnauth.on("message", (msg) => {
        const parsed = JSON.parse(msg.toString());
        if (parsed.type === "error") res("rejected");
      });
    });
    if (unauthResult === "closed" || unauthResult === "rejected") {
      console.log("   PASSED: Unauthenticated WebSocket connection rejected.");
    } else {
      throw new Error("Unauthenticated WebSocket connection was permitted");
    }

    // B) Authenticated WS attempt with Cookie
    const wsAuth = new WebSocket(`${wsUrl}?projectId=test-1`, {
      headers: { Cookie: cookieHeader },
    });
    const authResult = await new Promise((res, rej) => {
      const timeout = setTimeout(() => rej(new Error("WS connection timed out")), 3000);
      wsAuth.on("open", () => {
        clearTimeout(timeout);
        wsAuth.close();
        res("connected");
      });
      wsAuth.on("error", (err) => {
        clearTimeout(timeout);
        rej(err);
      });
    });
    if (authResult === "connected") {
      console.log("   PASSED: Authenticated WebSocket connection established.");
    }

    // 6. Test Logout
    console.log("\n[Test 6] User Logout (/api/auth/logout)...");
    const res6 = await fetch(`${baseUrl}/auth/logout`, {
      method: "POST",
      headers: { Cookie: cookieHeader },
    });
    const data6 = await res6.json();
    const logoutCookie = res6.headers.get("set-cookie");
    if (res6.status === 200 && data6.success && logoutCookie) {
      console.log("   PASSED: Logout successful and Auth Cookie cleared.");
    } else {
      throw new Error(`Logout failed: ${JSON.stringify(data6)}`);
    }

    // 7. Verify Unauthenticated after logout
    console.log("\n[Test 7] Verifying access denied post-logout...");
    // The cleared cookie will have empty value or past expiration date
    const clearedCookieHeader = logoutCookie.split(";")[0];
    const res7 = await fetch(`${baseUrl}/protected`, {
      headers: { Cookie: clearedCookieHeader },
    });
    if (res7.status === 401) {
      console.log("   PASSED: Access denied after logout.");
    } else {
      throw new Error(`Access unexpectedly granted post-logout with status ${res7.status}`);
    }

    // 8. Test Auth Config endpoint
    console.log("\n[Test 8] Checking /api/auth/config...");
    const res8 = await fetch(`${baseUrl}/auth/config`);
    const data8 = await res8.json();
    if (res8.status === 200 && "googleClientId" in data8) {
      console.log("   PASSED: Auth config endpoint operational.");
    } else {
      throw new Error("Auth config check failed");
    }

    console.log("\n==============================================");
    console.log("  ALL AUTHENTICATION TESTS PASSED SUCCESSFULLY!  ");
    console.log("==============================================\n");
  } finally {
    server.close();
  }
}

runAuthTests().catch((err) => {
  console.error("\n[TEST FAILURE]:", err);
  process.exit(1);
});
