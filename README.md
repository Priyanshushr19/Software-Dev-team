# 🤖 AI Dev Team — Multi-Agent Software Development System

> **Autonomous Full-Stack Software Engineering Platform powered by LangGraph, Google Gemini, Docker, and React.**
> From a single prompt to a fully planned, architected, coded, reviewed, tested, and containerized application.

---

## 📌 Overview

**AI Dev Team** is an autonomous multi-agent software engineering system capable of executing the complete software development lifecycle (SDLC). It coordinates **27 specialized nodes and agents** organized across **5 pipeline phases**. 

Instead of generating raw code in a single prompt, the system mirrors a human engineering team:
1. **Product Managers** clarify ambiguous requirements and generate structured specifications.
2. **System Architects** progressively design entities, database schemas, API contracts, pages, and folder layouts, cross-validating every contract before writing a line of code.
3. **Planners & DevOps** construct dependency-ordered task queues, spin up isolated multi-container Docker environments, and verify runtime health.
4. **Autonomous Dev Loop** selects tasks, builds minimal context packages, writes code, reviews implementations, executes tests inside live containers, takes Git snapshots, self-debugs on failure, simplifies stuck tasks, and escalates to human operators only when necessary.
5. **Deployment Verifiers** probe live frontend and backend endpoints, verify HTTP reachability, and present working deliverables.

All operations are checkpointed to **Redis** (with automatic persistent file fallback), enabling crash recovery, human-in-the-loop interactions, and state restoration across server restarts.

---

## 🏗️ System Architecture & Workflow

The core engine is modeled as a compiled **LangGraph state machine** with cycle protection, checkpointing, and token budget governance:

```
[Phase 1: PM]           START ───> [pmAgent] <───> [humanInput]
                                         │ (spec_ready)
                                         ▼
[Phase 2: Architect]    [architectStep1: Entities & Models]
                                         │
                        [architectStep2: Database Schema]
                                         │
                        [architectStep3: API Endpoints]
                                         │
                        [architectStep4: Frontend Pages]
                                         │
                        [architectStep5: Folder Structure]
                                         │
                        [blueprintValidator] ──(mismatch / cycle ≤ 2)──> [route to step]
                                         │ (valid)
                                         ▼
[Phase 3: Planner]      [plannerAgent: Task Graph Construction]
                                         │
                        [setupSandbox: Multi-Container Docker Init]
                                         │
                        [sandboxHealthCheck] ──(unhealthy)──> [repair / halt]
                                         │ (healthy)
                                         ▼
[Phase 4: Dev Loop]   ┌───> [selectNextTask] ──(all tasks done)──> [deploymentVerifier]
                      │                  │ (task pending)
                      │                  ▼
                      │     [contextBuilder: Registry + Imports]
                      │                  │
                      │     [coderAgent: Focused Code Generation]
                      │                  │
                      │     [updateRegistry: Public API Extraction]
                      │                  │
                      │     [reviewerAgent] ──(rejection ≤ 2)──> [coderAgent]
                      │            │ (approved)                 │ (rejection > 2)
                      │            ▼                            ▼
                      │     [executorAgent]               [simplifyTask]
                      │      │ (pass)     │ (fail)              │
                      │      ▼            ▼                     ▼
                      │   [snapshot]   [debuggerAgent]   [selectNextTask]
                      │   (Git tag)      │ (fix)      │ (escalate)
                      │      │           ▼            ▼
                      │      │        [coderAgent]  [humanEscalation]
                      │      │                              │
                      │      └──────────────────────────────┘
                      │
                      │ (phase boundary reached)
                      └─── [phaseVerification] ──> [patternExtractor] ──> [stateCompactor]

[Phase 5: Deploy]     [deploymentVerifier] ──(fail)──> [debuggerAgent]
                               │ (healthy)
                               ▼
                        [presentToUser] ───> END
```

---

## 🌟 Key Features

### 1. 27 Autonomous Graph Nodes & Specialized Agents
- **PM Agent**: Identifies ambiguities in requirements, poses clarifying questions, and establishes strict software specifications.
- **5-Step Architect**: Iteratively generates data entities, SQL/NoSQL schemas, RESTful API contracts, UI routes, and physical directory layouts.
- **Blueprint Validator**: Enforces cross-consistency between DB tables, endpoints, and frontend routes, auto-routing back to architects when mismatches are detected.
- **Planner Agent**: Decomposes blueprints into topological phases (setup, models, backend API, frontend components, integration).
- **Coder & Reviewer**: Strict separation of concerns where coder writes code and reviewer verifies syntax, security, and requirement adherence.
- **Live Executor & Debugger**: Runs actual commands in isolated Docker containers, parses compiler/runtime output, and automatically applies targeted fixes.
- **State Compactor & Pattern Extractor**: Extracts reusable architecture patterns across phases and compacts execution history to optimize LLM context windows.

### 2. Multi-Container Docker Sandboxes
- **Isolated Stack**: Spin-up of PostgreSQL (`postgres:16-alpine`) or MongoDB (`mongo:7`), Node.js backend container (`node:20-slim`), and Vite/React frontend container on a shared Docker bridge network (`aidev-network`).
- **Local Filesystem Fallback**: If Docker is unavailable, seamlessly scaffolds and operates directly against local disk storage.
- **Git Snapshots**: Commits and tags each completed task (`v0.1.0`, `v0.2.0`) enabling instant rollback on critical failure.

### 3. Strict Project Ownership & Multi-Tenant Security
- **Identity Isolation**: Projects belong strictly to the authenticated creator. User A cannot view, open, inspect files, download archives, or delete User B's projects.
- **Secure File Access & Path Traversal Guards**: REST and WebSocket file APIs reject unauthorized path traversal attempts (`..`, absolute paths, out-of-boundary access).
- **ZIP Packaging Engine**: Streams cleaned source code directly to users while strictly excluding `.env`, credentials, `node_modules`, `.git`, caches, and logs, while automatically generating safe `.env.example` templates.
- **Safe Resource Lifecycle**: Deletion safely stops active runs, destroys only unshared Docker containers, purges thread checkpoints, and removes database records without impacting other users.

### 4. Industrial Mission Control Dashboard
- **Real-Time WebSocket Streaming**: Instant telemetry of agent transitions, active nodes, file writes, test outputs, and budget consumption.
- **Pipeline Visualizer**: Live graphical representation of all 27 nodes with state highlights (pending, active, completed, failed).
- **Interactive Code Explorer**: Split-pane file hierarchy and read-only source viewer with line numbers, file statistics, language badges, code copying, and file downloads.
- **My Projects Management**: High-density workspace dashboard featuring real-time search, execution status filters, project type filters (Full Stack vs. Frontend Only), sorting, pagination, and deletion dialogs.
- **Human-in-the-Loop Gateway**: Interactive forms allowing operators to answer PM clarification questions or resolve escalated debug situations directly from the UI.

---

## 📁 Repository Structure

```
ai-dev-team/
├── src/                               # Core Autonomous Agent Graph
│   ├── agents/                        # Specialized LLM Agents
│   │   ├── architectAgent.js          # 5-Step progressive system architect
│   │   ├── blueprintValidator.js      # Cross-validation engine for architectures
│   │   ├── coderAgent.js              # Source code authoring agent
│   │   ├── debuggerAgent.js           # Automated bug diagnostic & repair agent
│   │   ├── plannerAgent.js            # Task decomposition & dependency scheduler
│   │   ├── pmAgent.js                 # Requirement analysis & clarification agent
│   │   └── reviewerAgent.js           # Static code & contract reviewer
│   ├── nodes/                         # LangGraph Deterministic Control Nodes
│   │   ├── contextBuilder.js          # Minimal token-efficient context packager
│   │   ├── deploymentVerifier.js      # Live HTTP endpoint health & status verifier
│   │   ├── executorAgent.js           # Containerized test execution engine
│   │   ├── humanEscalation.js         # Human-in-the-loop fallback bridge
│   │   ├── humanInput.js              # PM question responder bridge
│   │   ├── patternExtractor.js        # Architectural pattern harvester
│   │   ├── phaseVerification.js       # Phase boundary completion validator
│   │   ├── presentToUser.js           # Final deliverable presenter
│   │   ├── sandboxHealthCheck.js      # Docker container runtime health checker
│   │   ├── selectNextTask.js          # Dependency-aware task dispatcher
│   │   ├── setupSandbox.js            # Workspace scaffolding & container initiator
│   │   ├── simplifyTask.js            # Task complexity reducer on failure
│   │   ├── snapshotManager.js         # Git commit & release tagger
│   │   ├── stateCompactor.js          # Token budget & context compressor
│   │   └── updateRegistry.js          # Export & public interface cataloger
│   ├── config/                        # Graph Configuration & State Schemas
│   │   ├── graph.js                   # LangGraph topology & checkpointer factory
│   │   └── state.js                   # 30-channel global agent state definition
│   └── utils/                         # Infrastructure & Runtime Utilities
│       ├── fileSaver.js               # Persistent JSON file checkpointer
│       ├── gemini.js                  # Gemini API client with token counter
│       ├── redisDocker.js             # Automated Redis container manager
│       ├── sandboxManager.js          # Docker container & file manager
│       └── tokenTracker.js            # Token usage & budget reporting
│
├── server/                            # Express Backend & WebSocket Server
│   ├── auth/                          # Authentication & JWT Session helpers
│   ├── data/                          # Persistent JSON databases (users, projects)
│   ├── middleware/                    # Cookie & JWT requireAuth middleware
│   ├── routes/                        # REST API (auth, projects, sandbox, files, zip)
│   ├── services/                      # Stores & GraphRunner orchestration bridge
│   ├── ws/                            # Authenticated WebSocket handler & broadcaster
│   └── index.js                       # HTTP/WS server entry point
│
├── dashboard/                         # React Frontend (Vite + Redux + Industrial Dark UI)
│   ├── src/
│   │   ├── components/                # UI Components
│   │   │   ├── AuthScreen.jsx         # Login, Register, Google OAuth
│   │   │   ├── CodeExplorer.jsx       # Interactive file tree & source code viewer
│   │   │   ├── HumanInputPanel.jsx    # Live operator response interface
│   │   │   ├── LogStream.jsx          # Terminal log viewer with auto-scroll
│   │   │   ├── MyProjects.jsx         # Project workspace dashboard with filters & pagination
│   │   │   ├── OutputPanel.jsx        # Tabbed spec, blueprint, tasks, code, results
│   │   │   ├── PipelineVisualizer.jsx # 27-node real-time pipeline graph
│   │   │   └── TokenBudgetBar.jsx     # Financial & token budget consumption gauge
│   │   ├── hooks/useWebSocket.js      # WebSocket state synchronization hook
│   │   ├── lib/api.js                 # REST client for backend endpoints
│   │   ├── store/projectStore.js      # Redux Toolkit store with persistence
│   │   ├── App.jsx                    # Root Mission Control layout & view switcher
│   │   └── index.css                  # Industrial Dark Terminal stylesheet
│   ├── package.json                   # Frontend dependencies
│   └── vite.config.js                 # Vite bundler configuration
│
├── tests/                             # Comprehensive Automated Test Suites
│   ├── test-all-mock.js               # Integrated mock runner
│   ├── test-architect.js              # Architect step validation
│   ├── test-auth.js                   # Authentication & WS gating suite
│   ├── test-deployment-verifier.js    # Endpoint reachability verifier tests
│   ├── test-devloop.js                # Core dev loop state transition tests
│   ├── test-final-production.js       # Production verification (13 core scenarios)
│   ├── test-graph-skeleton.js         # End-to-end mock graph execution
│   ├── test-my-projects.js            # Project ownership, ZIP, & delete tests
│   ├── test-planner-integration.js    # Task queue to dev loop handoff tests
│   ├── test-pm-clarification.js       # PM Agent interactive clarification tests
│   ├── test-resume.js                 # Redis checkpoint, restart, & Docker resume
│   ├── test-sandbox.js                # Docker container provisioning tests
│   └── test-validator.js              # Blueprint cross-check validation tests
│
├── .checkpoints.json                  # Persistent fallback checkpoint storage
├── package.json                       # Root scripts & dependencies
└── README.md                          # Project documentation
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher
- **Docker Desktop**: Running (required for containerized sandboxes; fallback filesystem mode activated if absent)
- **Google Gemini API Key**: [Get a Gemini API Key](https://aistudio.google.com/apikey)
- **Redis (Optional)**: Automatically detected via Docker; persistent file checkpointer (`.checkpoints.json`) is used automatically if Redis is absent.

---

### 2. Installation

1. **Clone the repository**:
   ```bash
   git clone <repo-url>
   cd AIDevFinal
   ```

2. **Install root dependencies**:
   ```bash
   npm install
   ```

3. **Install dashboard frontend dependencies**:
   ```bash
   cd dashboard
   npm install
   cd ..
   ```

---

### 3. Environment Configuration

Create a `.env` file in the project root:

```env
# Google Gemini API
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash

# Checkpointing (Optional - uses persistent file checkpointer if omitted)
REDIS_URL=redis://localhost:6379

# Backend Configuration
SERVER_PORT=4000
FRONTEND_URL=http://localhost:5173
TOKEN_BUDGET=2.0

# Security (JWT Auth)
JWT_SECRET=your_super_secret_jwt_key_here
```

Ensure `server/.env` contains matching configuration or uses environment inheritance. For the dashboard (`dashboard/.env`):

```env
VITE_API_URL=http://localhost:4000/api
VITE_WS_URL=ws://localhost:4000
```

---

### 4. Running the Application

#### Option A: Full Platform Mode (Recommended)
Spins up both the Express API/WebSocket server and the React Mission Control dashboard concurrently:

```bash
npm run dev
```

- **Mission Control Dashboard**: `http://localhost:5173`
- **REST API**: `http://localhost:4000/api`
- **WebSocket Gateway**: `ws://localhost:4000/ws`

#### Option B: Standalone Servers
```bash
# Terminal 1: Backend Server
npm run server

# Terminal 2: Vite Frontend
npm run dashboard
```

#### Option C: Terminal CLI Execution
Execute requirements directly via the interactive CLI runner:

```bash
# Interactive prompt
node src/index.js

# Direct requirement argument
node src/index.js "Build a full-stack Kanban board with user authentication and task filtering"
```

---

## 🧪 Comprehensive Test Suites

The repository contains an exhaustive automated test suite validating every tier of the system:

```bash
# Run complete mock test suite across all 7 core modules
npm run test:all:mock

# Run final comprehensive production verification suite (13 critical scenarios)
npm run test:final

# Run project ownership, isolation, and ZIP packaging tests
npm run test:projects

# Run authentication, JWT, and WebSocket gating tests
npm run test:auth

# Run checkpointing, server restart, and Docker container resume tests
npm run test:resume

# Run Blueprint Validator rule tests
npm run test:validator

# Run Dev Loop routing and wiring tests
npm run test:devloop

# Run Planner to Dev Loop handoff integration tests
npm run test:planner:integration
```

### What `npm run test:final` Validates:
1. **Ownership Assignment**: Project created by User A is bound to User A's ID.
2. **List Isolation**: User B cannot view User A's projects in dashboard listings.
3. **Endpoint Protection**: Direct `GET /api/projects/:id` by non-owners yields `403 Forbidden`.
4. **File & ZIP Protection**: Files, sandbox metadata, and ZIP archives cannot be downloaded by non-owners.
5. **Deletion Protection**: Non-owners cannot delete or alter other users' projects.
6. **Authorized Operations**: User A can browse files, view code, and download source code archives.
7. **Safe Deletion**: Deletion permanently purges targeted metadata and workspace.
8. **Resource Isolation**: Deleting project A does not affect project B or shared sandboxes.
9. **Server Restart Persistence**: Ownership and state survive server reboots without data loss.
10. **WebSocket Gating**: Unauthorized WebSocket subscriptions are rejected with close code 1008.
11. **Running Project Lifecycle**: Running graphs are safely cancelled and unmounted upon deletion.
12. **Dashboard Query API**: Verification of search, status filtering, type filtering, sorting, and pagination.
13. **Security Hardening**: Path traversal attempts (`..`, absolute paths) on file endpoints return `400 Bad Request`.

---

## 🔒 Security & Data Isolation Architecture

- **Session Authentication**: Secured with HTTP-only, SameSite cookies carrying signed JSON Web Tokens (`aidev_session`).
- **Zero Frontend Trust**: `userId` or `ownerId` parameters submitted in payloads are strictly ignored. The authenticated user context is derived exclusively from server middleware (`req.authUser`).
- **Filesystem Confinement**: All sandbox filesystem operations verify that resolved file targets reside strictly within the project's sandbox root via `path.resolve` boundary verification.
- **Credential & Secret Protection**: Exported ZIP archives never include `.env`, `.pem`, `.key`, `id_rsa`, or credential artifacts, generating safe `.env.example` templates automatically.
- **Idempotent Resource Teardown**: Partial failures during cleanup (e.g. stopped Docker daemon) do not corrupt metadata or leave unhandled zombie processes.

---

## 💻 Tech Stack

- **Core AI Orchestration**: `@langchain/langgraph`, `@langchain/langgraph-checkpoint-redis`, Google Gemini (`@google/genai`)
- **Backend Architecture**: Node.js, Express, `ws` (WebSockets), `archiver`, `jsonwebtoken`, `bcryptjs`
- **Frontend Dashboard**: React 18, Vite, Redux Toolkit, React-Redux, IBM Plex Mono & DM Sans typography
- **Container Infrastructure**: Docker Engine (Node.js 20, PostgreSQL 16 Alpine, MongoDB 7, Redis)
- **Persistence**: Redis Key-Value Store / Persistent File Checkpointer (`.checkpoints.json`), Local JSON stores

---

## 📄 License

This project is licensed under the MIT License.
