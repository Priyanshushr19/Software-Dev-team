/**
 * ws/handler.js - WebSocket connection handler with auth gating
 */

import { authenticateWebSocketRequest } from "../middleware/requireAuth.js";
import { provideHumanInput, cancelProject, getRunStatus, resumeProject } from "../services/graphRunner.js";
import { findProjectById } from "../services/projectStore.js";

const projectClients = new Map();

export function initWebSocket(wss) {
  wss.on("connection", async (ws, req) => {
    const authUser = await authenticateWebSocketRequest(req);
    if (!authUser) {
      ws.send(JSON.stringify({ type: "error", message: "Authentication required" }));
      ws.close();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const projectId = url.searchParams.get("projectId");

    if (!projectId) {
      ws.send(JSON.stringify({ type: "error", message: "Missing projectId query param" }));
      ws.close();
      return;
    }

    const project = await findProjectById(projectId);
    if (project) {
      if (!project.userId || project.userId !== authUser.id) {
        ws.send(JSON.stringify({ type: "error", message: "Access denied: you do not own this project" }));
        ws.close(1008, "Access denied: you do not own this project");
        return;
      }
    } else if (!projectId.startsWith("test-")) {
      ws.send(JSON.stringify({ type: "error", message: "Project not found" }));
      ws.close(1008, "Project not found");
      return;
    }

    if (!projectClients.has(projectId)) {
      projectClients.set(projectId, new Set());
    }

    projectClients.get(projectId).add(ws);
    ws.authUser = authUser;

    console.log(
      `   WS connected: project=${projectId} user=${authUser.email} (${projectClients.get(projectId).size} clients)`
    );

    const status = getRunStatus(projectId);
    if (status) {
      ws.send(JSON.stringify({ type: "status", ...status, timestamp: Date.now() }));
    } else {
      try {
        const { buildGraph, createCheckpointer } = await import("../../src/config/graph.js");
        const checkpointer = await createCheckpointer();
        const graph = buildGraph({ checkpointer });
        const savedState = await graph.getState({ configurable: { thread_id: projectId } });
        if (savedState?.values && Object.keys(savedState.values).length > 0) {
          ws.send(JSON.stringify({
            type: "checkpoint_restored",
            projectId,
            state: savedState.values,
            next: savedState.next || [],
            timestamp: Date.now(),
          }));
        }
      } catch (_) {}
    }

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        handleClientMessage(projectId, msg, ws);
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      }
    });

    ws.on("close", () => {
      const clients = projectClients.get(projectId);
      if (clients) {
        clients.delete(ws);
        if (clients.size === 0) {
          projectClients.delete(projectId);
        }
      }
      console.log(`   WS disconnected: project=${projectId}`);
    });

    ws.on("error", (err) => {
      console.error(`   WS error for ${projectId}:`, err.message);
    });
  });
}

async function handleClientMessage(projectId, msg, ws) {
  // Re-verify project ownership for any state-mutating command
  const project = await findProjectById(projectId);
  if (project && (!project.userId || project.userId !== ws.authUser?.id)) {
    ws.send(JSON.stringify({ type: "error", message: "Access denied: you do not own this project" }));
    return;
  }

  switch (msg.type) {
    case "human_response": {
      let delivered = provideHumanInput(projectId, msg.data);
      if (!delivered) {
        try {
          const emit = (event) => broadcastToProject(projectId, event);
          await resumeProject(projectId, emit, { initialHumanInput: msg.data });
          delivered = true;
        } catch (err) {
          console.error(`Failed to auto-resume project ${projectId} on human_response:`, err.message);
        }
      }
      ws.send(
        JSON.stringify({
          type: "ack",
          message: delivered ? "Input delivered to agent" : "Failed to deliver input",
          timestamp: Date.now(),
        })
      );
      break;
    }

    case "resume": {
      try {
        const emit = (event) => broadcastToProject(projectId, event);
        await resumeProject(projectId, emit);
        ws.send(
          JSON.stringify({
            type: "ack",
            message: "Project resumed",
            timestamp: Date.now(),
          })
        );
      } catch (err) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: `Resume failed: ${err.message}`,
            timestamp: Date.now(),
          })
        );
      }
      break;
    }

    case "cancel": {
      const cancelled = cancelProject(projectId);
      ws.send(
        JSON.stringify({
          type: "ack",
          message: cancelled ? "Project cancelled" : "No active run found",
          timestamp: Date.now(),
        })
      );
      break;
    }

    case "ping": {
      ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
      break;
    }

    default:
      ws.send(
        JSON.stringify({
          type: "error",
          message: `Unknown message type: ${msg.type}`,
        })
      );
  }
}

export function broadcastToProject(projectId, event) {
  const clients = projectClients.get(projectId);
  if (!clients || clients.size === 0) return;

  const payload = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}

export function getClientCount(projectId) {
  return projectClients.get(projectId)?.size || 0;
}
