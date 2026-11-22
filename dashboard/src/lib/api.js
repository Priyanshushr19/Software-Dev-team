/**
 * lib/api.js — REST API Client
 * 
 * Simple fetch wrapper for the Express server endpoints.
 * WebSocket handles real-time; this handles request-response.
 */

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...options,
  });

  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  return data;
}

/** Start a new project */
export async function createProject(requirement, tokenBudget = 2.0) {
  return request("/projects", {
    method: "POST",
    body: JSON.stringify({ requirement, tokenBudget }),
  });
}

/** List active projects */
export async function listProjects() {
  return request("/projects");
}

/** Get project details + state */
export async function getProject(projectId) {
  return request(`/projects/${projectId}`);
}

/** Resume a checkpointed project */
export async function resumeProject(projectId) {
  return request(`/projects/${projectId}/resume`, { method: "POST" });
}

/** Cancel a running project */
export async function cancelProject(projectId) {
  return request(`/projects/${projectId}/cancel`, { method: "POST" });
}

/** Delete a project */
export async function deleteProject(projectId) {
  return request(`/projects/${projectId}`, { method: "DELETE" });
}

/** Download project source code as a ZIP archive */
export async function downloadProjectZip(projectId, suggestedFilename) {
  const res = await fetch(`${BASE_URL}/projects/${projectId}/zip`, {
    credentials: "include",
  });

  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data.error) errorMsg = data.error;
    } catch (_) {}
    throw new Error(errorMsg);
  }

  let filename = suggestedFilename || `${projectId}.zip`;
  const disposition = res.headers.get("Content-Disposition");
  if (disposition) {
    const match = disposition.match(/filename="?([^"]+)"?/);
    if (match && match[1]) {
      filename = match[1];
    }
  }

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 100);
}

/** Get sandbox info */
export async function getSandbox(projectId) {
  return request(`/projects/${projectId}/sandbox`);
}

/** Read a file from the sandbox */
export async function readFile(projectId, filePath) {
  return request(`/projects/${projectId}/files/${filePath}`);
}

/** Health check */
export async function healthCheck() {
  return request("/health");
}

export async function getAuthConfig() {
  return request("/auth/config");
}

export async function getCurrentUser() {
  return request("/auth/me");
}

export async function login(payload) {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function register(payload) {
  return request("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function googleLogin(credential) {
  return request("/auth/google", {
    method: "POST",
    body: JSON.stringify({ credential }),
  });
}

export async function logout() {
  return request("/auth/logout", {
    method: "POST",
  });
}
