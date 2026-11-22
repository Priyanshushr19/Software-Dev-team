/**
 * PipelineVisualizer.jsx
 * 
 * Horizontal phase blocks with node dots inside.
 * No emojis. Uses color coding: idle=dim, active=pulse, done=accent.
 */

import useProjectStore, {
  PIPELINE_PHASES,
  NODE_LABELS,
  getNodeStatus,
} from "../store/projectStore";

export default function PipelineVisualizer() {
  const projectState = useProjectStore((s) => s);
  const currentPhase = projectState.currentPhase;

  const phases = Object.entries(PIPELINE_PHASES);

  return (
    <div className="pipeline">
      <div className="pipeline-track">
        {phases.map(([phaseKey, phase], phaseIdx) => {
          const isActivePhase = currentPhase === phaseKey;
          const phaseCompleted = phase.nodes.every((n) => {
            const st = getNodeStatus(n, projectState);
            return st === "completed" || st === "not_required";
          });
          const hasCompletedNode = phase.nodes.some((n) => {
            const st = getNodeStatus(n, projectState);
            return st === "completed";
          });

          let phaseClass = "phase--idle";
          if (phaseCompleted) phaseClass = "phase--done";
          else if (isActivePhase || hasCompletedNode) phaseClass = "phase--active";

          return (
            <div key={phaseKey} className="pipeline-segment">
              <div className={`phase-block ${phaseClass}`}>
                <div className="phase-top">
                  <span className="phase-num">{String(phaseIdx + 1).padStart(2, "0")}</span>
                  <span className="phase-name">{phase.label}</span>
                </div>
                <div className="phase-dots">
                  {phase.nodes.map((nodeName) => {
                    const st = getNodeStatus(nodeName, projectState);

                    let dotClass = "dot--idle";
                    if (st === "completed") dotClass = "dot--done";
                    else if (st === "running") dotClass = "dot--active";
                    else if (st === "not_required") dotClass = "dot--not_required";
                    else if (st === "failed") dotClass = "dot--failed";

                    const statusLabel =
                      st === "not_required"
                        ? "NOT REQUIRED"
                        : st.toUpperCase();

                    return (
                      <div
                        key={nodeName}
                        className={`phase-dot ${dotClass}`}
                        title={`${NODE_LABELS[nodeName] || nodeName}: ${statusLabel}`}
                      >
                        <span className="dot-pip" />
                      </div>
                    );
                  })}
                </div>
              </div>
              {phaseIdx < phases.length - 1 && (
                <div className={`phase-connector ${phaseCompleted ? "connector--done" : ""}`}>
                  <span className="connector-line" />
                  <span className="connector-arrow" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
