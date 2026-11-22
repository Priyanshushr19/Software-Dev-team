/**
 * pmAgent.js — Project Manager Agent (Fixed Token Tracking)
 */

import { safeCallGemini, callGemini, makeTokenDelta, emptyTokenDelta } from "../utils/gemini.js";

const PM_SYSTEM_PROMPT = `You are the PM Agent in an AI software development team.

ROLE: You are a senior project manager who converts vague requirements into clear, actionable specifications.

GOAL: Analyze the user's project requirement and:
1. Determine the EXACT project type and technology constraints requested by the user.
2. Either ask clarifying questions if the requirement is ambiguous OR generate a complete project specification.

CORE RULE — USER-PROVIDED TECHNOLOGIES ARE THE SOURCE OF TRUTH:
- The user is the one who chooses the technologies. The AI must NOT choose or replace technologies on the user's behalf.
- If the user explicitly provides technologies (e.g., "React", "HTML, CSS and JavaScript", "Vue and Tailwind", "React, Express and MongoDB"), extract ONLY those exact technologies into technologyConstraints.
- Do NOT convert requested stacks (e.g., do NOT convert HTML/CSS/JS to React; do NOT replace Vue with React; do NOT replace MongoDB with PostgreSQL).
- Do NOT add unrequested backend/database technologies (Express, Node, MongoDB, PostgreSQL, etc.) if the user asked for a frontend app or did not request a backend.

PM CLARIFICATION RULES FOR TECHNOLOGIES:
- If the user HAS already explicitly provided the technology (e.g., "Build a calculator using React and Tailwind"), DO NOT ask technology clarification questions.
- If the user has NOT specified any technology (e.g., "Build a calculator", "Build a landing page"), you MAY ask: "Which technologies would you like to use?" along with functional questions.

PROJECT TYPE CLASSIFICATION RULES (STRICT CONSTRAINTS):
- "frontend_only": If the user requests a frontend component, calculator, landing page, portfolio, UI, dashboard UI, widget, etc., WITHOUT asking for a backend/server/database/API.
  Examples: "Build a calculator using React", "Build a calculator using HTML, CSS and JavaScript", "Build a frontend using Vue and Tailwind".
  For frontend_only: backend MUST be [], database MUST be []. DO NOT add Express, Node backend, MongoDB, PostgreSQL, JWT, APIs, or backend services.
- "backend_only": If the user requests an API, server, microservice, backend REST service WITHOUT requesting a frontend UI.
  For backend_only: frontend MUST be [].
- "full_stack": Only if the user explicitly requests both frontend and backend/API/database (e.g., "React, Express and MongoDB").

OUTPUT FORMAT — You MUST return one of two JSON formats:

FORMAT 1 — When you need more information (status: "needs_clarification"):
{
  "status": "needs_clarification",
  "questions": ["Question 1?", "Question 2?"],
  "assumptions": ["Assumption I'm making if you don't answer..."]
}

FORMAT 2 — When you have enough information to create a spec (status: "spec_ready"):
{
  "status": "spec_ready",
  "spec": {
    "appName": "my-app",
    "description": "One-line description",
    "projectType": "frontend_only" | "backend_only" | "full_stack",
    "technologyConstraints": {
      "frontend": ["React", "Tailwind CSS"], // EXACT user-requested frontend tech
      "backend": [],                         // EXACT user-requested backend tech (or [] if none)
      "database": [],                        // EXACT user-requested db tech (or [] if none)
      "other": []
    },
    "userRoles": ["user"],
    "authRequired": false,
    "features": [
      {
        "name": "Feature Name",
        "description": "What it does",
        "subFeatures": ["sub1", "sub2"],
        "userAccess": ["user"]
      }
    ],
    "databaseRecommendation": "none" | "PostgreSQL" | "MongoDB",
    "databaseReason": "Why this DB fits (or none for frontend_only)",
    "pages": [
      {
        "name": "Page Name",
        "route": "/route",
        "description": "What this page shows",
        "requiresAuth": false
      }
    ],
    "assumptions": ["Things I decided on my own"]
  }
}

RULES:
- Be concise in questions. No fluff.
- PM specification is the source of truth for project scope and technology selection.
- Always include "projectType" and "technologyConstraints" in the spec.`;

export async function pmAgentNode(state) {
  console.log("\n🤖 [PM Agent] Analyzing requirement...\n");

  let userPrompt;

  if (state.pmConversation.length === 0) {
    userPrompt = `User's project requirement:\n"${state.userRequirement}"`;
  } else {
    userPrompt = `Original requirement:\n"${state.userRequirement}"\n\n`;
    userPrompt += `Conversation so far:\n`;
    for (const entry of state.pmConversation) {
      if (entry.role === "pm") {
        userPrompt += `PM Questions: ${JSON.stringify(entry.questions)}\n`;
      } else if (entry.role === "user") {
        userPrompt += `User Answers: ${entry.answers}\n`;
      }
    }
    userPrompt += `\nNow generate the FINAL spec incorporating all the user's answers. Return status: "spec_ready".`;
  }

  const result = await safeCallGemini({
    systemPrompt: PM_SYSTEM_PROMPT,
    userPrompt,
    agentName: "pmAgent",
    currentCost: state.tokenUsage?.estimatedCost || 0,
    tokenBudget: state.tokenBudget,
  });


  if (!result.ok) {
    console.error(`   [pmAgent] LLM failed: ${result.error}`);
    return { error: `pmAgent failed: ${result.error}`, tokenUsage: emptyTokenDelta("pmAgent") };
  }

  const response = result.parsed;
  const tokenDelta = makeTokenDelta("pmAgent", result.tokens);

  if (response.status === "needs_clarification") {
    console.log("❓ [PM Agent] Need more info. Questions:");
    response.questions.forEach((q, i) => console.log(`   ${i + 1}. ${q}`));
    if (response.assumptions?.length) {
      console.log("\n   📌 Assumptions made:");
      response.assumptions.forEach((a) => console.log(`   - ${a}`));
    }

    const reqLower = (state.userRequirement || "").toLowerCase();
    const isExplicitFullStack = reqLower.includes("full stack") || reqLower.includes("fullstack") || reqLower.includes("full-stack") || reqLower.includes("backend") || reqLower.includes("database") || reqLower.includes("express") || reqLower.includes("postgres") || reqLower.includes("mongo") || reqLower.includes("api");
    const isNoBackend = reqLower.includes("no backend") || reqLower.includes("don't use any backend") || reqLower.includes("do not use any backend") || reqLower.includes("without backend") || reqLower.includes("no server");
    const isFrontendWord = reqLower.includes("calculator") || reqLower.includes("landing page") || reqLower.includes("portfolio") || reqLower.includes("widget");
    const isBackendWord = reqLower.includes("rest api") || reqLower.includes("express api") || reqLower.includes("backend service") || reqLower.includes("backend only");

    const projectType = isExplicitFullStack ? "full_stack" : (response.projectType || response.spec?.projectType || (
      isNoBackend || (isFrontendWord && !isBackendWord) ? "frontend_only" :
      isBackendWord && !isFrontendWord ? "backend_only" :
      "full_stack"
    ));
    const technologyConstraints = response.technologyConstraints || response.spec?.technologyConstraints || {
      frontend: [], backend: [], database: [], other: []
    };

    return {
      pmStatus: "needs_clarification",
      projectType,
      technologyConstraints,
      pmQuestions: response.questions,
      pmConversation: [
        { role: "pm", questions: response.questions, assumptions: response.assumptions || [] },
      ],
      tokenUsage: tokenDelta,
      currentPhase: "pm",
    };
  }

  const spec = response.spec || response;
  const reqLower = (state.userRequirement || "").toLowerCase();
  const isExplicitFullStack = reqLower.includes("full stack") || reqLower.includes("fullstack") || reqLower.includes("full-stack") || reqLower.includes("backend") || reqLower.includes("database") || reqLower.includes("express") || reqLower.includes("postgres") || reqLower.includes("mongo");
  let projectType = isExplicitFullStack ? "full_stack" : (spec.projectType || "full_stack");

  if (isExplicitFullStack) {
    spec.projectType = "full_stack";
    if (!spec.databaseRecommendation || spec.databaseRecommendation === "none") {
      spec.databaseRecommendation = "PostgreSQL";
    }
  }

  const technologyConstraints = spec.technologyConstraints || {
    frontend: [],
    backend: [],
    database: [],
    other: [],
  };

  if (response.status === "spec_ready" || spec) {
    console.log("✅ [PM Agent] Spec ready!");
    console.log(`   App: ${spec.appName}`);
    console.log(`   Project Type: ${projectType}`);
    console.log(`   Tech Constraints: ${JSON.stringify(technologyConstraints)}`);
    console.log(`   Features: ${spec.features?.length || 0}`);
    console.log(`   Pages: ${spec.pages?.length || 0}`);
    console.log(`   DB: ${spec.databaseRecommendation || "none"}`);

    return {
      pmStatus: "spec_ready",
      clarifiedSpec: spec,
      projectType,
      technologyConstraints,
      pmConversation: [{ role: "pm", spec }],
      tokenUsage: tokenDelta,
      currentPhase: "architect",
      completedNodes: ["pmAgent"],
    };
  }
}
