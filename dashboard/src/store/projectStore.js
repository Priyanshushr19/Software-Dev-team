/**
 * store/projectStore.js - Redux Toolkit project store with persistence
 *
 * Refresh should restore the active dashboard session so the app can
 * reconnect to the current project instead of falling back to a blank shell.
 */

import { configureStore, createSlice } from "@reduxjs/toolkit";
import { useDispatch, useSelector } from "react-redux";

const STORAGE_KEY = "ai-dev-team-dashboard-state";
const MAX_EVENTS = 500;

/**
 * The 27 nodes in pipeline order, grouped by phase
 * Used by PipelineVisualizer to render the flow
 */
export const PIPELINE_PHASES = {
  pm: {
    label: "PM",
    nodes: ["pmAgent", "humanInput"],
  },
  architect: {
    label: "Architect",
    nodes: [
      "architectStep1", "architectStep2", "architectStep3",
      "architectStep4", "architectStep5", "blueprintValidator",
    ],
  },
  planner: {
    label: "Planner",
    nodes: ["plannerAgent", "setupSandbox", "sandboxHealthCheck"],
  },
  dev_loop: {
    label: "Dev Loop",
    nodes: [
      "selectNextTask", "contextBuilder", "coderAgent", "updateRegistry",
      "reviewerAgent", "executorAgent", "snapshotManager",
      "debuggerAgent", "simplifyTask", "humanEscalation",
      "phaseVerification", "patternExtractor", "stateCompactor",
    ],
  },
  deploy: {
    label: "Deploy",
    nodes: ["deploymentVerifier", "presentToUser"],
  },
};

export const ALL_NODES = Object.values(PIPELINE_PHASES).flatMap((phase) => phase.nodes);

export const NODE_LABELS = {
  pmAgent: "PM Agent",
  humanInput: "Human Input",
  architectStep1: "Entities & Models",
  architectStep2: "Database Schema",
  architectStep3: "API Endpoints",
  architectStep4: "Frontend Pages",
  architectStep5: "Folder Structure",
  blueprintValidator: "Blueprint Validator",
  plannerAgent: "Task Planner",
  setupSandbox: "Setup Sandbox",
  sandboxHealthCheck: "Health Check",
  selectNextTask: "Select Next Task",
  contextBuilder: "Build Context",
  coderAgent: "Coder Agent",
  updateRegistry: "Update Registry",
  reviewerAgent: "Code Reviewer",
  executorAgent: "Executor",
  snapshotManager: "Snapshot",
  debuggerAgent: "Debugger",
  simplifyTask: "Simplify Task",
  humanEscalation: "Human Escalation",
  phaseVerification: "Phase Verification",
  patternExtractor: "Pattern Extractor",
  stateCompactor: "State Compactor",
  deploymentVerifier: "Deployment Verifier",
  presentToUser: "Present Results",
};

function createProjectState() {
  return {
    wsConnected: false,
    projectId: null,
    requirement: "",
    status: "idle",
    activeNode: null,
    completedNodes: [],
    currentPhase: "pm",
    events: [],
    maxEvents: MAX_EVENTS,
    spec: null,
    blueprint: null,
    validation: null,
    taskQueue: null,
    sandboxId: null,
    sandboxHealthy: false,
    currentTask: null,
    taskStatuses: {},
    coderOutput: null,
    reviewResult: null,
    executionResult: null,
    fileRegistry: [],
    finalState: null,
    tokenUsage: {
      calls: [],
      totalInput: 0,
      totalOutput: 0,
      estimatedCost: 0,
    },
    tokenBudget: 2.0,
    humanInputRequest: null,
    error: null,
    errorRecoverable: false,
  };
}

function createAuthState() {
  return {
    user: null,
    status: "checking",
    googleClientId: "",
    error: null,
  };
}

function loadPersistedState() {
  if (typeof window === "undefined") {
    return createProjectState();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createProjectState();
    }

    const parsed = JSON.parse(raw);
    return {
      ...createProjectState(),
      ...parsed,
      wsConnected: false,
      activeNode: null,
      maxEvents: MAX_EVENTS,
      events: Array.isArray(parsed.events) ? parsed.events.slice(-MAX_EVENTS) : [],
      completedNodes: Array.isArray(parsed.completedNodes) ? parsed.completedNodes : [],
      taskStatuses: parsed.taskStatuses || {},
      tokenUsage: {
        calls: [],
        totalInput: 0,
        totalOutput: 0,
        estimatedCost: 0,
        ...(parsed.tokenUsage || {}),
      },
    };
  } catch (error) {
    console.warn("[store] Failed to load persisted dashboard state:", error);
    return createProjectState();
  }
}

function persistProjectState(state) {
  if (typeof window === "undefined") {
    return;
  }

  const persistableState = {
    ...state,
    wsConnected: false,
    activeNode: null,
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistableState));
}

const initialState = loadPersistedState();

const authSlice = createSlice({
  name: "auth",
  initialState: createAuthState(),
  reducers: {
    beginAuthCheck(state) {
      state.status = "checking";
      state.error = null;
    },
    setAuthConfig(state, action) {
      state.googleClientId = action.payload || "";
    },
    setAuthenticatedUser(state, action) {
      state.user = action.payload;
      state.status = "authenticated";
      state.error = null;
    },
    setUnauthenticated(state, action) {
      state.user = null;
      state.status = "unauthenticated";
      state.error = action.payload || null;
    },
    setAuthError(state, action) {
      state.error = action.payload;
      if (state.status === "checking") {
        state.status = "unauthenticated";
      }
    },
    logoutAuthState() {
      return {
        ...createAuthState(),
        status: "unauthenticated",
      };
    },
  },
});

const projectSlice = createSlice({
  name: "project",
  initialState,
  reducers: {
    setWsConnected(state, action) {
      state.wsConnected = action.payload;
    },
    setProject(state, action) {
      const { projectId, requirement } = action.payload;
      Object.assign(state, {
        ...createProjectState(),
        projectId,
        requirement,
        status: "running",
      });
    },
    addEvent(state, action) {
      state.events.push(action.payload);
      if (state.events.length > state.maxEvents) {
        state.events = state.events.slice(-state.maxEvents);
      }
    },
    processEvent(state, action) {
      const event = action.payload;

      state.events.push(event);
      if (state.events.length > state.maxEvents) {
        state.events = state.events.slice(-state.maxEvents);
      }

      switch (event.type) {
        case "node_complete":
          if (!state.completedNodes.includes(event.node)) {
            state.completedNodes.push(event.node);
          }
          if (event.data?.blueprint) {
            state.blueprint = {
              ...(state.blueprint || {}),
              ...(event.data.blueprint || {}),
            };
          }
          if (event.data?.clarifiedSpec && !state.spec) {
            state.spec = event.data.clarifiedSpec;
          }
          if (state.activeNode === event.node) {
            state.activeNode = null;
          }
          break;

        case "phase_change":
          state.currentPhase = event.phase;
          break;

        case "spec_ready":
          state.spec = event.spec;
          break;

        case "blueprint_update":
          state.blueprint = {
            ...(state.blueprint || {}),
            ...(event.blueprint || {}),
          };
          break;

        case "validation_result":
          state.validation = event.validation;
          break;

        case "taskqueue_ready":
          state.taskQueue = event.taskQueue;
          break;

        case "sandbox_created":
          state.sandboxId = event.sandboxId;
          state.sandboxHealthy = event.healthy;
          break;

        case "task_started":
          state.currentTask = event.task;
          break;

        case "task_progress":
          state.taskStatuses = { ...state.taskStatuses, ...(event.statuses || {}) };
          break;

        case "code_written":
          state.coderOutput = event.files;
          break;

        case "review_result":
          state.reviewResult = event.review;
          break;

        case "execution_result":
          state.executionResult = event.execution;
          break;

        case "token_update":
          state.tokenUsage = event.usage;
          break;

        case "human_input_needed":
          state.status = "waiting_input";
          state.activeNode = "humanInput";
          state.humanInputRequest = {
            type: event.inputType,
            questions: event.questions || [],
            task: event.task || null,
            error: event.error || null,
          };
          break;

        case "run_complete":
          state.status = "complete";
          state.finalState = event.finalState;
          state.activeNode = null;
          state.humanInputRequest = null;
          if (event.finalState?.blueprint) {
            state.blueprint = {
              ...(state.blueprint || {}),
              ...(event.finalState.blueprint || {}),
            };
          }
          break;

        case "run_cancelled":
          state.status = "cancelled";
          state.activeNode = null;
          state.humanInputRequest = null;
          break;

        case "error":
          state.status = "error";
          state.error = event.message;
          state.errorRecoverable = event.recoverable ?? false;
          break;

        case "error_state":
          state.error = state.error
            ? `${state.error} [at ${event.currentPhase || "unknown"}: ${event.currentTask || "unknown task"}]`
            : event.currentTask || "Unknown error location";
          break;

        case "run_started":
          state.status = "running";
          state.activeNode = "pmAgent";
          state.currentPhase = "pm";
          state.error = null;
          state.errorRecoverable = false;
          break;

        case "checkpoint_restored":
          if (event.state) {
            if (event.state.clarifiedSpec) state.spec = event.state.clarifiedSpec;
            if (event.state.blueprint) state.blueprint = event.state.blueprint;
            if (event.state.taskQueue) state.taskQueue = event.state.taskQueue;
            if (event.state.currentPhase) state.currentPhase = event.state.currentPhase;
            if (event.state.currentTask) state.currentTask = event.state.currentTask;
            if (event.state.taskStatuses) state.taskStatuses = event.state.taskStatuses;
            if (event.state.completedNodes) state.completedNodes = event.state.completedNodes;
            if (event.state.sandboxId) state.sandboxId = event.state.sandboxId;
            if (event.state.userRequirement) state.requirement = event.state.userRequirement;

            if (event.state.error) {
              state.status = "error";
              state.error = event.state.error;
              state.errorRecoverable = true;
            } else if (
              (event.state.pmStatus === "needs_clarification" && event.state.pmQuestions?.length) ||
              (Array.isArray(event.next) && event.next.includes("humanInput"))
            ) {
              state.status = "waiting_input";
              state.activeNode = "humanInput";
              state.humanInputRequest = {
                type: "pm_clarification",
                questions: event.state.pmQuestions || [],
              };
              state.error = null;
              state.errorRecoverable = true;
            } else if (event.state.currentPhase === "done" || (Array.isArray(event.next) && event.next.length === 0)) {
              state.status = "complete";
              state.error = null;
              state.errorRecoverable = false;
            } else {
              state.status = "idle";
              state.error = null;
              state.errorRecoverable = true;
            }
          }
          break;

        case "status":
          if (event.status) {
            state.status = event.waitingForInput ? "waiting_input" : event.status;
          }
          break;

        default:
          break;
      }
    },
    clearHumanInputRequest(state) {
      state.humanInputRequest = null;
      if (state.status === "waiting_input") {
        state.status = "running";
      }
    },
    markResumeRequested(state) {
      state.status = "running";
      state.error = null;
      state.errorRecoverable = false;
    },
    setTransientError(state, action) {
      state.status = "error";
      state.error = action.payload.message;
      state.errorRecoverable = action.payload.recoverable ?? false;
    },
    loadProject(state, action) {
      const { project, state: savedState } = action.payload;
      state.projectId = project.id;
      state.requirement = project.requirement || "";
      state.status = project.status || "idle";
      state.error = project.error || null;
      state.errorRecoverable = !!project.error;
      state.sandboxId = project.sandboxId || savedState?.sandboxId || null;
      state.currentPhase = project.currentPhase || savedState?.currentPhase || "pm";
      state.currentTask = project.currentTask || savedState?.currentTask || null;
      state.tokenBudget = project.tokenBudget || 2.0;

      if (savedState) {
        if (savedState.clarifiedSpec) state.spec = savedState.clarifiedSpec;
        if (savedState.blueprint) state.blueprint = savedState.blueprint;
        if (savedState.blueprintValid !== undefined) state.validation = { isValid: savedState.blueprintValid };
        if (savedState.taskQueue) state.taskQueue = savedState.taskQueue;
        if (savedState.taskStatuses) state.taskStatuses = savedState.taskStatuses;
        if (savedState.completedNodes) state.completedNodes = savedState.completedNodes;
        if (savedState.fileRegistry) state.fileRegistry = savedState.fileRegistry;
        if (savedState.tokenUsage) state.tokenUsage = savedState.tokenUsage;
        state.finalState = savedState;

        if (
          savedState.pmStatus === "needs_clarification" &&
          Array.isArray(savedState.pmQuestions) &&
          savedState.pmQuestions.length > 0
        ) {
          state.status = "waiting_input";
          state.activeNode = "humanInput";
          state.humanInputRequest = {
            type: "pm_clarification",
            questions: savedState.pmQuestions,
          };
        }
      }
    },
    reset() {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(STORAGE_KEY);
      }
      return createProjectState();
    },
  },
});

export const {
  setWsConnected,
  setProject,
  addEvent,
  processEvent,
  clearHumanInputRequest,
  markResumeRequested,
  setTransientError,
  loadProject,
  reset,
} = projectSlice.actions;

export const {
  beginAuthCheck,
  setAuthConfig,
  setAuthenticatedUser,
  setUnauthenticated,
  setAuthError,
  logoutAuthState,
} = authSlice.actions;

export const store = configureStore({
  reducer: {
    project: projectSlice.reducer,
    auth: authSlice.reducer,
  },
});

store.subscribe(() => {
  persistProjectState(store.getState().project);
});

export function useProjectDispatch() {
  return useDispatch();
}

export default function useProjectStore(selector) {
  return useSelector((state) => selector(state.project));
}

export function getNodeStatus(nodeName, state) {
  if (!state) return "pending";
  const { completedNodes = [], activeNode, status, spec, blueprint, currentPhase } = state;
  const projectType = spec?.projectType || blueprint?.projectType || "full_stack";

  if (projectType === "frontend_only") {
    if (nodeName === "architectStep2" || nodeName === "architectStep3") {
      return "not_required";
    }
  }

  if (projectType === "backend_only") {
    if (nodeName === "architectStep4") {
      return "not_required";
    }
  }

  if (completedNodes.includes(nodeName)) {
    return "completed";
  }

  if (activeNode === nodeName && (status === "running" || status === "waiting_input")) {
    return "running";
  }

  if (status === "error" && activeNode === nodeName) {
    return "failed";
  }

  // Once in deploy or done phase, mark uninvoked recovery/cleanup nodes as not_required
  const isPastDevLoop = currentPhase === "deploy" || currentPhase === "done" || status === "complete";
  if (isPastDevLoop) {
    const recoveryNodes = [
      "debuggerAgent",
      "simplifyTask",
      "humanEscalation",
      "phaseVerification",
      "patternExtractor",
      "stateCompactor"
    ];
    if (recoveryNodes.includes(nodeName)) {
      return "not_required";
    }
  }

  return "pending";
}

export function useAuthStore(selector) {
  return useSelector((state) => selector(state.auth));
}

