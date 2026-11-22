/**
 * state.js — Complete V2 State Definition
 * 
 * FIRST PRINCIPLES:
 * In LangGraph:
 * - Simple fields: use valueField(defaultValue) — last write wins, preserve existing if incoming is empty/null/default.
 * - Accumulating fields (merge arrays/objects): use Annotation({ reducer, default })
 */

import { Annotation } from "@langchain/langgraph";

const valueField = (defaultValue = null) =>
  Annotation({
    reducer: (existing, incoming) => {
      if (incoming === undefined || incoming === null) {
        return existing !== undefined && existing !== null
          ? existing
          : typeof defaultValue === "function"
          ? defaultValue()
          : defaultValue;
      }
      return incoming;
    },
    default: typeof defaultValue === "function" ? defaultValue : () => defaultValue,
  });

export const AgentState = Annotation.Root({

  // ─── USER INPUT ───────────────────────────────────────────
  userRequirement: valueField(""),

  // ─── PM AGENT ─────────────────────────────────────────────
  pmStatus: valueField("idle"), // idle | needs_clarification | spec_ready

  pmQuestions: valueField(() => []),

  pmConversation: Annotation({
    reducer: (existing, incoming) => {
      if (!incoming) return existing || [];
      if (Array.isArray(incoming)) return [...(existing || []), ...incoming];
      return [...(existing || []), incoming];
    },
    default: () => [],
  }),

  clarifiedSpec: valueField(null),

  projectType: valueField("full_stack"), // frontend_only | backend_only | full_stack

  technologyConstraints: valueField(() => ({
    frontend: [],
    backend: [],
    database: [],
    other: [],
  })),

  // ─── ARCHITECT AGENT ──────────────────────────────────────
  blueprint: Annotation({
    reducer: (existing, incoming) => {
      if (!incoming) return existing || {};
      return { ...(existing || {}), ...incoming };
    },
    default: () => ({
      entities: [],
      dbSchema: {},
      apiEndpoints: [],
      frontendPages: [],
      folderStructure: "",
      dependencies: {},
    }),
  }),

  // ─── BLUEPRINT VALIDATOR ──────────────────────────────────
  blueprintValidation: valueField(() => ({ isValid: false, issues: [], validationCycles: 0 })),

  // ─── PLANNER AGENT ────────────────────────────────────────
  taskQueue: valueField(() => ({ phases: [] })),

  currentPhaseIndex: valueField(0),

  currentTaskIndex: valueField(0),

  // ─── FILE INTERFACE REGISTRY ──────────────────────────────
  fileRegistry: Annotation({
    reducer: (existing, incoming) => {
      if (!incoming) return existing || [];
      if (Array.isArray(incoming)) {
        const map = new Map((existing || []).map((f) => [f.path, f]));
        for (const entry of incoming) {
          map.set(entry.path, entry);
        }
        return Array.from(map.values());
      }
      return existing || [];
    },
    default: () => [],
  }),

  // ─── PROJECT PATTERNS ─────────────────────────────────────
  projectPatterns: Annotation({
    reducer: (existing, incoming) => {
      if (!incoming) return existing || {};
      return { ...(existing || {}), ...incoming };
    },
    default: () => ({
      errorHandling: "",
      namingConvention: "",
      responseFormat: "",
      importStyle: "",
      stateManagement: "",
      commentStyle: "",
    }),
  }),

  // ─── SANDBOX ──────────────────────────────────────────────
  sandboxId: valueField(""),

  sandboxHealthy: valueField(false),

  // ─── DEV LOOP ─────────────────────────────────────────────
  currentTask: valueField(null),

  taskStatuses: Annotation({
    reducer: (existing, incoming) => {
      if (!incoming) return existing || {};
      return { ...(existing || {}), ...incoming };
    },
    default: () => ({}),
  }),

  contextPackage: valueField(null),

  coderOutput: valueField(null),

  // ─── REVIEWER ─────────────────────────────────────────────
  reviewResult: valueField(() => ({ verdict: "", issues: [], reviewCycle: 0 })),

  // ─── EXECUTOR ─────────────────────────────────────────────
  executionResult: valueField(() => ({ result: "", output: "", errors: "" })),

  // ─── DEBUGGER ─────────────────────────────────────────────
  debugState: valueField(() => ({ tier: 1, attempts: 0, maxAttempts: 3, rollbackAttempted: false })),

  // ─── USER FEEDBACK ────────────────────────────────────────
  userFeedback: Annotation({
    reducer: (existing, incoming) => {
      if (!incoming) return existing || [];
      if (Array.isArray(incoming)) return [...(existing || []), ...incoming];
      return [...(existing || []), incoming];
    },
    default: () => [],
  }),

  feedbackIteration: valueField(0),

  maxFeedbackIterations: valueField(3),

  scopeDrift: valueField(0.0),

  userSatisfied: valueField(false),

  // ─── DEPLOYMENT ───────────────────────────────────────────
  deploymentConfig: valueField(() => ({ platform: "", files: [], instructions: [] })),

  deploymentAttempts: valueField(0),

  deploymentHealthy: valueField(false),

  deploymentVerification: valueField(null),

  deploymentUrl: valueField(null),

  // ─── TOKEN TRACKING ───────────────────────────────────────
  tokenUsage: Annotation({
    reducer: (existing, incoming) => {
      if (!incoming) return existing || { calls: [], totalInput: 0, totalOutput: 0, estimatedCost: 0 };
      const current = existing || { calls: [], totalInput: 0, totalOutput: 0, estimatedCost: 0 };
      return {
        calls: [...(current.calls || []), ...(incoming.newCalls || [])],
        totalInput: current.totalInput + (incoming.addedInput || 0),
        totalOutput: current.totalOutput + (incoming.addedOutput || 0),
        estimatedCost: current.estimatedCost + (incoming.addedCost || 0),
      };
    },
    default: () => ({
      calls: [],
      totalInput: 0,
      totalOutput: 0,
      estimatedCost: 0.0,
    }),
  }),

  tokenBudget: valueField(2.0),

  // ─── CONTROL ──────────────────────────────────────────────
  currentPhase: valueField("pm"),

  completedNodes: Annotation({
    reducer: (existing, incoming) => {
      if (!incoming) return existing || [];
      const incomingArray = Array.isArray(incoming) ? incoming : [incoming];
      return Array.from(new Set([...(existing || []), ...incomingArray]));
    },
    default: () => [],
  }),

  error: valueField(null),
});
