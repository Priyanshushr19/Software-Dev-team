/**
 * App.jsx — Mission Control Dashboard
 * 
 * Industrial dark UI. No emojis. Clean typography.
 * Layout: header -> navigation -> requirement bar / projects view -> pipeline -> columns -> token bar
 */

import { useState, useCallback, useEffect } from "react";
import useProjectStore, {
  beginAuthCheck,
  clearHumanInputRequest,
  logoutAuthState,
  markResumeRequested,
  reset as resetProjectState,
  setAuthenticatedUser,
  setAuthConfig,
  setAuthError,
  setProject,
  setTransientError,
  setUnauthenticated,
  useAuthStore,
  useProjectDispatch,
} from "./store/projectStore";
import useWebSocket from "./hooks/useWebSocket";
import {
  createProject,
  getAuthConfig,
  getCurrentUser,
  googleLogin,
  login,
  logout,
  register,
  resumeProject,
  downloadProjectZip,
  deleteProject,
} from "./lib/api";
import AuthScreen from "./components/AuthScreen";
import PipelineVisualizer from "./components/PipelineVisualizer";
import LogStream from "./components/LogStream";
import OutputPanel from "./components/OutputPanel";
import HumanInputPanel from "./components/HumanInputPanel";
import TokenBudgetBar from "./components/TokenBudgetBar";
import MyProjects from "./components/MyProjects";

export default function App() {
  const [currentView, setCurrentView] = useState("dashboard"); // "dashboard" | "projects"
  const [requirementInput, setRequirementInput] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [outputActiveTab, setOutputActiveTab] = useState("spec");
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dispatch = useProjectDispatch();

  const authStatus = useAuthStore((s) => s.status);
  const authUser = useAuthStore((s) => s.user);
  const authError = useAuthStore((s) => s.error);
  const googleClientId = useAuthStore((s) => s.googleClientId);

  const projectId = useProjectStore((s) => s.projectId);
  const requirement = useProjectStore((s) => s.requirement);
  const status = useProjectStore((s) => s.status);
  const wsConnected = useProjectStore((s) => s.wsConnected);
  const humanInputRequest = useProjectStore((s) => s.humanInputRequest);
  const error = useProjectStore((s) => s.error);
  const errorRecoverable = useProjectStore((s) => s.errorRecoverable);

  const isAuthenticated = authStatus === "authenticated";
  const { sendMessage, disconnect } = useWebSocket(isAuthenticated ? projectId : null);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapAuth() {
      dispatch(beginAuthCheck());

      try {
        const config = await getAuthConfig();
        if (!cancelled) {
          dispatch(setAuthConfig(config.googleClientId || ""));
        }
      } catch (bootstrapError) {
        if (!cancelled) {
          dispatch(setAuthError(bootstrapError.message));
        }
      }

      try {
        const result = await getCurrentUser();
        if (!cancelled) {
          dispatch(setAuthenticatedUser(result.user));
        }
      } catch {
        if (!cancelled) {
          dispatch(setUnauthenticated(null));
        }
      }
    }

    bootstrapAuth();

    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  const handleStart = useCallback(async () => {
    if (!requirementInput.trim()) return;
    setIsStarting(true);
    try {
      const result = await createProject(requirementInput.trim());
      dispatch(setProject({ projectId: result.projectId, requirement: requirementInput.trim() }));
      setRequirementInput("");
      setCurrentView("dashboard");
    } catch (e) {
      alert(`Failed to start project: ${e.message}`);
    } finally {
      setIsStarting(false);
    }
  }, [dispatch, requirementInput]);

  const handleHumanResponse = useCallback(
    (data) => {
      sendMessage({ type: "human_response", data });
      dispatch(clearHumanInputRequest());
    },
    [dispatch, sendMessage]
  );

  const handleCancel = useCallback(() => {
    sendMessage({ type: "cancel" });
  }, [sendMessage]);

  const handleResume = useCallback(async () => {
    if (!projectId) return;
    try {
      dispatch(markResumeRequested());
      await resumeProject(projectId);
    } catch (e) {
      dispatch(setTransientError({ message: `Resume failed: ${e.message}`, recoverable: true }));
    }
  }, [dispatch, projectId]);

  const handleWorkspaceDownloadZip = useCallback(async () => {
    if (!projectId || isDownloadingZip) return;
    setIsDownloadingZip(true);
    addToast("Packaging project source code archive...", "info");
    try {
      await downloadProjectZip(projectId);
      addToast("ZIP archive downloaded successfully", "success");
    } catch (e) {
      addToast(`Download failed: ${e.message}`, "error");
    } finally {
      setIsDownloadingZip(false);
    }
  }, [projectId, isDownloadingZip, addToast]);

  const handleWorkspaceDeleteConfirm = useCallback(async () => {
    if (!projectId || isDeletingProject) return;
    setIsDeletingProject(true);
    try {
      await deleteProject(projectId);
      disconnect();
      dispatch(resetProjectState());
      setShowDeleteConfirm(false);
      setCurrentView("projects");
      addToast("Project deleted permanently", "success");
    } catch (e) {
      addToast(`Delete failed: ${e.message}`, "error");
    } finally {
      setIsDeletingProject(false);
    }
  }, [projectId, isDeletingProject, disconnect, dispatch, addToast]);

  const handleNewProject = useCallback(() => {
    disconnect();
    dispatch(resetProjectState());
    setOutputActiveTab("spec");
    setCurrentView("dashboard");
  }, [disconnect, dispatch]);

  const handleLogout = useCallback(async () => {
    try {
      await logout();
    } catch {
      // Ignore network errors here; we still clear local state.
    } finally {
      disconnect();
      dispatch(logoutAuthState());
      dispatch(resetProjectState());
    }
  }, [disconnect, dispatch]);

  const completeAuth = useCallback(
    (user) => {
      dispatch(setAuthenticatedUser(user));
    },
    [dispatch]
  );

  const handleLogin = useCallback(
    async (payload) => {
      const result = await login(payload);
      completeAuth(result.user);
    },
    [completeAuth]
  );

  const handleRegister = useCallback(
    async (payload) => {
      const result = await register(payload);
      completeAuth(result.user);
    },
    [completeAuth]
  );

  const handleGoogleLogin = useCallback(
    async (credential) => {
      const result = await googleLogin(credential);
      completeAuth(result.user);
    },
    [completeAuth]
  );

  if (authStatus === "checking") {
    return (
      <div className="auth-shell auth-shell--loading">
        <div className="auth-loading-card">
          <p className="auth-pre">SESSION BOOTSTRAP</p>
          <h1 className="auth-title">Validating operator session...</h1>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <AuthScreen
        googleClientId={googleClientId}
        authError={authError}
        onLogin={handleLogin}
        onRegister={handleRegister}
        onGoogleLogin={handleGoogleLogin}
      />
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div
            className="logo"
            onClick={() => setCurrentView("dashboard")}
            style={{ cursor: "pointer" }}
            title="Return to Mission Control"
          >
            <span className="logo-mark">//</span>
            <span className="logo-text">DEVTEAM</span>
          </div>
          <span className="header-divider" />
          <nav className="header-nav">
            <button
              className={`nav-tab ${currentView === "dashboard" ? "nav-tab--active" : ""}`}
              onClick={() => setCurrentView("dashboard")}
            >
              MISSION CONTROL
            </button>
            <button
              className={`nav-tab ${currentView === "projects" ? "nav-tab--active" : ""}`}
              onClick={() => setCurrentView("projects")}
            >
              MY PROJECTS
            </button>
          </nav>
        </div>
        <div className="header-right">
          <div className="header-user">
            <span className="header-user-name">{authUser?.name || authUser?.email}</span>
          </div>
          <div className="conn-indicator">
            <span className={`conn-dot ${wsConnected ? "live" : ""}`} />
            <span className="conn-label">{wsConnected ? "CONNECTED" : "OFFLINE"}</span>
          </div>
          {projectId && currentView === "dashboard" && (
            <button className="btn btn-text" onClick={handleNewProject}>
              NEW PROJECT
            </button>
          )}
          <button className="btn btn-text" onClick={handleLogout}>
            LOGOUT
          </button>
        </div>
      </header>

      <main className="main">
        {/* TOAST NOTIFICATIONS */}
        {toasts.length > 0 && (
          <div className="toast-container" role="status" aria-live="polite">
            {toasts.map((t) => (
              <div key={t.id} className={`toast toast--${t.type}`}>
                <span className="toast-dot" />
                <span className="toast-msg">{t.message}</span>
                <button className="toast-close" onClick={() => removeToast(t.id)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {currentView === "projects" ? (
          <MyProjects
            onOpenProject={(id, opts) => {
              if (opts?.initialTab) {
                setOutputActiveTab(opts.initialTab);
              }
              setCurrentView("dashboard");
            }}
            onNewProject={() => {
              handleNewProject();
              setCurrentView("dashboard");
            }}
          />
        ) : !projectId ? (
          <div className="landing">
            <div className="landing-inner">
              <div className="landing-left">
                <p className="landing-pre">MULTI-AGENT AI SYSTEM</p>
                <h1 className="landing-title">
                  Describe it.<br />
                  We build it.
                </h1>
                <p className="landing-desc">
                  27 specialized agents — PM, Architect, Planner, Coder, 
                  Reviewer, Executor, Debugger — working in concert. 
                  From a single sentence to a deployed application.
                </p>
                <div style={{ marginTop: "24px" }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setCurrentView("projects")}
                  >
                    VIEW SAVED PROJECTS →
                  </button>
                </div>
              </div>
              <div className="landing-right">
                <div className="input-block">
                  <label className="input-label">PROJECT REQUIREMENT</label>
                  <textarea
                    value={requirementInput}
                    onChange={(e) => setRequirementInput(e.target.value)}
                    placeholder="Build a todo app with categories, due dates, and user authentication..."
                    rows={5}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleStart();
                    }}
                  />
                  <div className="input-actions">
                    <button
                      className="btn btn-accent"
                      onClick={handleStart}
                      disabled={!requirementInput.trim() || isStarting}
                    >
                      {isStarting ? "INITIALIZING..." : "LAUNCH"}
                    </button>
                    <span className="input-shortcut">Ctrl+Enter</span>
                  </div>
                </div>
                <div className="templates">
                  <span className="templates-label">TEMPLATES</span>
                  {[
                    "Blog platform with comments and tags",
                    "E-commerce store with admin panel",
                    "Real-time chat app with rooms",
                  ].map((ex) => (
                    <button
                      key={ex}
                      className="template-btn"
                      onClick={() => setRequirementInput(ex)}
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="dashboard">
            <div className="req-bar">
              <div className="req-bar-left">
                <span className="req-label">TARGET</span>
                <span className="req-text">{requirement}</span>
              </div>
              <div className="req-bar-right">
                <button
                  className="btn btn-text btn-sm"
                  onClick={() => setCurrentView("projects")}
                  style={{ marginRight: "6px" }}
                >
                  ALL PROJECTS
                </button>
                <button
                  className={`btn btn-secondary btn-sm ${outputActiveTab === "code" ? "nav-tab--active" : ""}`}
                  onClick={() => setOutputActiveTab("code")}
                  title="Explore project source code files"
                  style={{ marginRight: "6px" }}
                >
                  FILES
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleWorkspaceDownloadZip}
                  disabled={isDownloadingZip}
                  title="Download project as a ZIP archive"
                  style={{ marginRight: "6px" }}
                >
                  {isDownloadingZip ? "PACKAGING..." : "ZIP"}
                </button>
                <button
                  className="btn btn-ghost-danger btn-sm"
                  onClick={() => setShowDeleteConfirm(true)}
                  title="Permanently delete this project"
                  style={{ marginRight: "8px" }}
                >
                  DELETE
                </button>
                <span className={`status-pill status--${status}`}>
                  {status === "running" && "RUNNING"}
                  {status === "waiting_input" && "AWAITING INPUT"}
                  {status === "complete" && "COMPLETE"}
                  {status === "error" && "ERROR"}
                  {status === "cancelled" && "CANCELLED"}
                  {status === "idle" && "IDLE"}
                </span>
                {(status === "running" || status === "waiting_input") && (
                  <button className="btn btn-text btn-sm" onClick={handleCancel}>
                    ABORT
                  </button>
                )}
                {(status === "idle" || (status === "error" && errorRecoverable)) && (
                  <button className="btn btn-accent btn-sm" onClick={handleResume}>
                    {status === "error" ? "RETRY" : "RESUME"}
                  </button>
                )}
              </div>
            </div>

            {status === "error" && error && (
              <div className="error-bar">
                <span className="error-bar-label">ERROR</span>
                <span className="error-bar-msg">{error}</span>
                {errorRecoverable && (
                  <span className="error-bar-hint">Checkpointed. Click RETRY to resume from last good state.</span>
                )}
              </div>
            )}

            <PipelineVisualizer />

            <div className="dashboard-grid">
              <div className="dashboard-col">
                <LogStream />
              </div>
              <div className="dashboard-col">
                <OutputPanel activeTab={outputActiveTab} onTabChange={setOutputActiveTab} />
              </div>
            </div>

            {humanInputRequest && (
              <HumanInputPanel
                request={humanInputRequest}
                onSubmit={handleHumanResponse}
              />
            )}

            <TokenBudgetBar />

            {/* WORKSPACE DELETE CONFIRMATION MODAL */}
            {showDeleteConfirm && (
              <div
                className="modal-backdrop"
                onClick={() => !isDeletingProject && setShowDeleteConfirm(false)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && !isDeletingProject) setShowDeleteConfirm(false);
                }}
                tabIndex={-1}
              >
                <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                  <p className="modal-tag">CONFIRM DESTRUCTION</p>
                  <h3 className="modal-title">Delete Project?</h3>
                  <p className="modal-desc">
                    Are you sure you want to permanently delete this project?
                  </p>
                  <p className="modal-subtext">
                    Project ID: <code>{projectId}</code>
                    <br />
                    Requirement: <em>{requirement}</em>
                    <br />
                    This will delete all project database records, stop any active run, destroy the Docker sandbox,
                    and clear checkpoint state. This action cannot be undone.
                  </p>
                  <div className="modal-actions">
                    <button
                      className="btn btn-text"
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={isDeletingProject}
                    >
                      CANCEL
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={handleWorkspaceDeleteConfirm}
                      disabled={isDeletingProject}
                    >
                      {isDeletingProject ? "DELETING..." : "DELETE PROJECT"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
