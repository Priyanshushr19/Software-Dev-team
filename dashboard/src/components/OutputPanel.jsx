/**
 * OutputPanel.jsx — Tabbed Output Display
 * No emojis. Clean tabs. Code-style output rendering.
 */

import { useState, useEffect } from "react";
import useProjectStore from "../store/projectStore";
import CodeExplorer from "./CodeExplorer";

const TABS = [
  { key: "spec", label: "Spec" },
  { key: "blueprint", label: "Blueprint" },
  { key: "tasks", label: "Tasks" },
  { key: "code", label: "Code Explorer" },
  { key: "final", label: "Result" },
];

export default function OutputPanel({ activeTab: externalTab, onTabChange }) {
  const [internalTab, setInternalTab] = useState("spec");
  const activeTab = externalTab !== undefined ? externalTab : internalTab;

  const handleTabClick = (key) => {
    if (onTabChange) {
      onTabChange(key);
    } else {
      setInternalTab(key);
    }
  };

  const projectId = useProjectStore((s) => s.projectId);
  const spec = useProjectStore((s) => s.spec);
  const blueprint = useProjectStore((s) => s.blueprint);
  const validation = useProjectStore((s) => s.validation);
  const taskQueue = useProjectStore((s) => s.taskQueue);
  const taskStatuses = useProjectStore((s) => s.taskStatuses);
  const coderOutput = useProjectStore((s) => s.coderOutput);
  const fileRegistry = useProjectStore((s) => s.fileRegistry);
  const finalState = useProjectStore((s) => s.finalState);

  return (
    <div className="panel output-panel">
      <div className="panel-head">
        <span className="panel-tag">OUT</span>
        <span className="panel-title">Output</span>
      </div>

      <div className="tab-row">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`tab-btn ${activeTab === tab.key ? "tab-btn--active" : ""}`}
            onClick={() => handleTabClick(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="output-body">
        {activeTab === "spec" && <SpecView spec={spec} />}
        {activeTab === "blueprint" && (
          <BlueprintView blueprint={blueprint} validation={validation} />
        )}
        {activeTab === "tasks" && (
          <TasksView taskQueue={taskQueue} taskStatuses={taskStatuses} />
        )}
        {activeTab === "code" && (
          <CodeExplorer
            projectId={projectId}
            fileRegistry={fileRegistry}
            coderOutput={coderOutput}
          />
        )}
        {activeTab === "final" && <FinalView finalState={finalState} />}
      </div>
    </div>
  );
}

function SpecView({ spec }) {
  if (!spec) return <Empty text="Spec appears after PM completes" />;
  return <pre className="code-block">{JSON.stringify(spec, null, 2)}</pre>;
}

function BlueprintView({ blueprint, validation }) {
  const spec = useProjectStore((s) => s.spec);
  const projectType = spec?.projectType || blueprint?.projectType || "full_stack";

  const hasData =
    blueprint &&
    (blueprint.entities?.length ||
      blueprint.dbSchema ||
      blueprint.apiEndpoints?.length ||
      blueprint.frontendPages?.length ||
      blueprint.folderStructure ||
      blueprint.dependencies);

  if (!hasData)
    return <Empty text="Blueprint appears after Architect completes" />;

  const isFrontendOnly = projectType === "frontend_only";

  return (
    <div className="output-section">
      {validation && (
        <div className={`inline-badge ${validation.isValid ? "badge--ok" : "badge--fail"}`}>
          {validation.isValid ? "VALIDATED" : "VALIDATION FAILED"}
          {validation.validationCycles > 0 && ` // ${validation.validationCycles} cycles`}
        </div>
      )}

      {/* STEP 1: Entities */}
      <h4 className="section-heading">Entities [{blueprint.entities?.length || 0}]</h4>
      {blueprint.entities?.length > 0 ? (
        blueprint.entities.map((e, i) => (
          <div key={i} className="list-item">
            <span className="list-key">{e.name}</span>
            {e.tableName && <span className="auth-tag">{e.tableName}</span>}
            {e.description && <span className="list-val">{e.description}</span>}
          </div>
        ))
      ) : (
        <div className="empty-sub text-muted">No custom backend entities required</div>
      )}

      {/* STEP 2: Database Schema */}
      <h4 className="section-heading">Database Schema</h4>
      {isFrontendOnly || blueprint.dbSchema?.databaseType === "none" ? (
        <div className="inline-badge badge--nr">
          NOT REQUIRED — Frontend Only
        </div>
      ) : blueprint.dbSchema ? (
        <div className="db-schema-block">
          <div className="db-type-row">
            <span className="stat-label">DB ENGINE:</span>
            <span className="stat-value">{blueprint.dbSchema.databaseType}</span>
            {blueprint.dbSchema.databaseReason && (
              <span className="list-val">({blueprint.dbSchema.databaseReason})</span>
            )}
          </div>
          {blueprint.dbSchema.tables?.map((t, ti) => (
            <div key={ti} className="table-block" style={{ marginTop: "8px" }}>
              <div className="list-key">Table: <code>{t.name}</code> ({t.fields?.length || 0} fields)</div>
              {t.fields?.map((f, fi) => (
                <div key={fi} className="field-row" style={{ paddingLeft: "12px", fontSize: "0.85em" }}>
                  <code>{f.name}</code>: <span className="list-val">{f.type}</span>
                  {f.primaryKey && <span className="auth-tag">PK</span>}
                  {f.nullable === false && <span className="auth-tag">NOT NULL</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-sub text-muted">Designing database schema...</div>
      )}

      {/* STEP 3: API Endpoints */}
      <h4 className="section-heading">API Endpoints [{blueprint.apiEndpoints?.length || 0}]</h4>
      {isFrontendOnly ? (
        <div className="inline-badge badge--nr">
          NOT REQUIRED — Frontend Only
        </div>
      ) : blueprint.apiEndpoints?.length > 0 ? (
        blueprint.apiEndpoints.map((ep, i) => (
          <div key={i} className="endpoint-row">
            <span className={`http-method m-${(ep.method || "GET").toLowerCase()}`}>
              {ep.method || "GET"}
            </span>
            <code className="endpoint-path">{ep.path}</code>
            {ep.requiresAuth && <span className="auth-tag">AUTH</span>}
          </div>
        ))
      ) : (
        <div className="empty-sub text-muted">Designing endpoints...</div>
      )}

      {/* STEP 4: Frontend Pages */}
      {blueprint.frontendPages?.length > 0 && (
        <>
          <h4 className="section-heading">Pages [{blueprint.frontendPages.length}]</h4>
          {blueprint.frontendPages.map((p, i) => (
            <div key={i} className="list-item">
              <code className="list-key">{p.route}</code>
              <span className="list-val">{p.name}</span>
            </div>
          ))}
        </>
      )}

      {/* STEP 5: Folder Structure */}
      {blueprint.folderStructure && (
        <>
          <h4 className="section-heading">Folder Structure</h4>
          <pre className="code-block" style={{ maxHeight: "200px", overflowY: "auto" }}>
            {typeof blueprint.folderStructure === "string"
              ? blueprint.folderStructure
              : JSON.stringify(blueprint.folderStructure, null, 2)}
          </pre>
        </>
      )}
    </div>
  );
}

function TasksView({ taskQueue, taskStatuses }) {
  if (!taskQueue?.phases?.length)
    return <Empty text="Tasks appear after Planner completes" />;

  const total = taskQueue.phases.reduce((s, p) => s + (p.tasks?.length || 0), 0);
  const done = Object.values(taskStatuses).filter((s) => s === "done").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="output-section">
      <div className="progress-header">
        <span className="progress-label">{done}/{total} tasks</span>
        <span className="progress-pct">{pct}%</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>

      {taskQueue.phases.map((phase, pi) => (
        <div key={pi} className="task-group">
          <h4 className="section-heading">
            Phase {phase.phaseNumber}: {phase.phaseName}
          </h4>
          {phase.tasks?.map((task, ti) => {
            const s = taskStatuses[task.taskId] || "pending";
            return (
              <div key={ti} className={`task-row task-row--${s}`}>
                <span className="task-indicator">
                  {s === "done" ? "[x]" : s === "in_progress" ? "[~]" : "[ ]"}
                </span>
                <span className="task-id">{task.taskId}</span>
                <span className="task-name">{task.title}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function CodeView({ coderOutput }) {
  if (!coderOutput) return <Empty text="Code output appears during dev loop" />;
  return <pre className="code-block">{JSON.stringify(coderOutput, null, 2)}</pre>;
}

function FinalView({ finalState }) {
  if (!finalState) return <Empty text="Final result appears on completion" />;

  const isHealthy = finalState.deploymentHealthy === true;
  const url = finalState.deploymentUrl;
  const ver = finalState.deploymentVerification;

  return (
    <div className="output-section">
      <div className={`inline-badge ${isHealthy ? "badge--ok" : "badge--fail"}`} style={{ marginBottom: "12px" }}>
        {isHealthy ? "PROJECT COMPLETE — HEALTHY DEPLOYMENT" : "DEPLOYMENT FAILED / NEEDS ATTENTION"}
      </div>

      {isHealthy && url && (
        <div className="list-item" style={{ marginBottom: "14px", background: "rgba(0, 255, 213, 0.06)", border: "1px solid var(--accent-border)", padding: "10px 14px", borderRadius: "8px" }}>
          <span className="list-key">VERIFIED DEPLOYMENT URL:</span>
          <a href={url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontWeight: "bold", textDecoration: "underline" }}>
            {url}
          </a>
        </div>
      )}

      {ver && (
        <div className="db-schema-block" style={{ marginBottom: "14px" }}>
          <h4 className="section-heading">Deployment Verification</h4>
          {ver.frontend && (
            <div className="list-item">
              <span className="list-key">Frontend ({ver.frontend.url}):</span>
              <span className={ver.frontend.pass ? "badge--ok" : "badge--fail"}>
                {ver.frontend.pass ? `PASS (HTTP ${ver.frontend.statusCode})` : `FAIL (${ver.frontend.reachable ? `HTTP ${ver.frontend.statusCode}` : "Unreachable"})`}
              </span>
            </div>
          )}
          {ver.backend && (
            <div className="list-item">
              <span className="list-key">Backend ({ver.backend.url}):</span>
              <span className={ver.backend.pass ? "badge--ok" : "badge--fail"}>
                {ver.backend.pass ? `PASS (HTTP ${ver.backend.statusCode})` : `FAIL (${ver.backend.reachable ? `HTTP ${ver.backend.statusCode}` : "Unreachable"})`}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">SANDBOX</span>
          <span className="stat-value">{finalState.sandboxId || "—"}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">FILES</span>
          <span className="stat-value">{finalState.fileRegistryCount || 0}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">COST</span>
          <span className="stat-value">
            ${(finalState.tokenUsage?.estimatedCost || 0).toFixed(4)}
          </span>
        </div>
      </div>
      <pre className="code-block" style={{ marginTop: "12px", maxHeight: "250px", overflowY: "auto" }}>
        {JSON.stringify(finalState, null, 2)}
      </pre>
    </div>
  );
}

function Empty({ text }) {
  return <div className="empty-state">{text}</div>;
}
