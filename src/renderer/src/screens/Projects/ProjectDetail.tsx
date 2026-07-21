import { useCallback, useEffect, useState } from "react";
import type { HccProject } from "../../types/hcc";

interface ProjectDetailProps {
  projectId: string | null;
}

const PROJECT_TRANSITIONS: Record<string, string[]> = {
  idea: ["planned", "archived"],
  planned: ["active", "paused", "archived"],
  active: ["blocked", "paused", "review", "archived"],
  blocked: ["active", "paused", "archived"],
  paused: ["active", "archived"],
  review: ["active", "completed"],
  completed: ["archived"],
  archived: [],
};

function ProjectDetail({ projectId }: ProjectDetailProps): React.JSX.Element {
  const [project, setProject] = useState<HccProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState<string | null>(null);

  const loadProject = useCallback(async () => {
    if (!projectId) {
      setProject(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payload = (await window.hermesAPI.getHccProjectDetail(projectId)) as HccProject;
      setProject(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load project detail");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  const transitionProject = async (toStatus: string): Promise<void> => {
    if (!projectId) return;
    setTransitioning(toStatus);
    setError(null);
    try {
      const payload = (await window.hermesAPI.transitionHccProject(
        projectId,
        toStatus,
        `Transitioned from native HCC Project Detail to ${toStatus}`,
      )) as { project?: HccProject };
      if (payload.project) setProject(payload.project);
      else await loadProject();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Project transition failed");
    } finally {
      setTransitioning(null);
    }
  };

  if (!projectId) {
    return (
      <div className="hcc-project-detail-screen">
        <div className="war-room-error-card">
          <div className="war-room-card-kicker">Project detail</div>
          <div className="war-room-error-copy">Select a project from Projects Index or War Room priorities.</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="hcc-project-detail-screen"><div className="war-room-loading">Loading project…</div></div>;
  }

  if (error || !project) {
    return (
      <div className="hcc-project-detail-screen">
        <div className="war-room-error-card">
          <div className="war-room-card-kicker">Project detail unavailable</div>
          <div className="war-room-error-copy">{error || "No project data returned."}</div>
          <button className="war-room-refresh-btn" onClick={() => void loadProject()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="hcc-project-detail-screen">
      <div className="war-room-hero-card">
        <div>
          <div className="war-room-card-kicker">HCC OS / Project Detail</div>
          <h1 className="war-room-title">{project.name}</h1>
          <p className="war-room-subtitle">{project.purpose || project.description || "No purpose yet."}</p>
        </div>
        <button className="war-room-refresh-btn" onClick={() => void loadProject()}>
          Refresh
        </button>
      </div>

      <div className="war-room-panel">
        <div className="war-room-panel-title">Lifecycle control</div>
        <div className="war-room-item-meta">Only valid transitions are exposed. Completion requires at least one recorded output.</div>
        <div className="war-room-action-row">
          {(PROJECT_TRANSITIONS[project.status] || []).map((status) => (
            <button
              key={status}
              className="war-room-refresh-btn"
              disabled={transitioning !== null}
              onClick={() => void transitionProject(status)}
            >
              {transitioning === status ? "Transitioning…" : `Move to ${status}`}
            </button>
          ))}
          {(PROJECT_TRANSITIONS[project.status] || []).length === 0 && (
            <span className="war-room-item-meta">No forward transitions available.</span>
          )}
        </div>
      </div>

      <div className="war-room-hero-grid">
        <div className="war-room-stat-card">
          <div className="war-room-stat-label">Status</div>
          <div className="war-room-stat-value">{project.status}</div>
        </div>
        <div className="war-room-stat-card">
          <div className="war-room-stat-label">Momentum</div>
          <div className="war-room-stat-value">{project.momentum_score ?? 0}</div>
        </div>
        <div className="war-room-stat-card">
          <div className="war-room-stat-label">Clarity</div>
          <div className="war-room-stat-value">{project.clarity_score ?? 0}</div>
        </div>
        <div className="war-room-stat-card">
          <div className="war-room-stat-label">Risk</div>
          <div className="war-room-stat-value">{project.risk_score ?? 0}</div>
        </div>
      </div>

      <div className="war-room-grid">
        <div className="war-room-panel">
          <div className="war-room-panel-title">Execution context</div>
          <div className="war-room-list">
            <div className="war-room-list-item"><span className="war-room-item-meta">Dependency health</span><strong>{project.dependency_health || "unknown"}</strong></div>
            <div className="war-room-list-item"><span className="war-room-item-meta">Strategic relevance</span><strong>{project.strategic_relevance || "unset"}</strong></div>
            <div className="war-room-list-item"><span className="war-room-item-meta">Review cadence</span><strong>{project.review_cadence || "unset"}</strong></div>
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Milestones</div>
          <div className="war-room-list">
            {(project.milestones || []).map((item) => (
              <div key={item} className="war-room-list-item"><div className="war-room-item-title">{item}</div></div>
            ))}
            {(project.milestones || []).length === 0 && <div className="war-room-item-meta">No milestones recorded.</div>}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Blockers</div>
          <div className="war-room-list">
            {(project.blockers || []).map((item) => (
              <div key={item} className="war-room-list-item"><div className="war-room-item-title">{item}</div><span className="war-room-pill tone-risk">blocked</span></div>
            ))}
            {(project.blockers || []).length === 0 && <div className="war-room-item-meta">No active blockers.</div>}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Linked domains</div>
          <div className="war-room-list">
            {(project.linked_domains || []).map((domain) => (
              <div key={domain.id} className="war-room-list-item">
                <div><div className="war-room-item-title">{domain.name}</div><div className="war-room-item-meta">{domain.neglect_risk} neglect risk</div></div>
                <span className="war-room-pill">health {domain.health_score}</span>
              </div>
            ))}
            {(project.linked_domains || []).length === 0 && <div className="war-room-item-meta">No canonical domains linked.</div>}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Operational lanes</div>
          <div className="war-room-list">
            {(project.linked_gateways || []).map((gateway) => (
              <div key={gateway.id} className="war-room-list-item"><div className="war-room-item-title">{gateway.displayName || gateway.display_name || gateway.name || gateway.id}</div><span className="war-room-pill">gateway</span></div>
            ))}
            {(project.linked_tools || []).map((tool) => (
              <div key={tool.id} className="war-room-list-item"><div className="war-room-item-title">{tool.label || tool.name || tool.id}</div><span className="war-room-pill">tool</span></div>
            ))}
            {(project.linked_gateways || []).length + (project.linked_tools || []).length === 0 && <div className="war-room-item-meta">No execution lanes linked.</div>}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Outputs</div>
          <div className="war-room-list">
            {(project.outputs || []).map((item) => (
              <div key={item} className="war-room-list-item"><div className="war-room-item-title">{item}</div></div>
            ))}
            {(project.outputs || []).length === 0 && <div className="war-room-item-meta">No outputs recorded. Completion remains gated.</div>}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">References</div>
          <div className="war-room-list">
            {(project.references || []).map((reference) => (
              <div key={reference.id} className="war-room-list-item war-room-list-item-stack">
                <div className="war-room-item-title">{reference.title || reference.name || reference.id}</div>
                {reference.summary && <div className="war-room-item-meta">{reference.summary}</div>}
              </div>
            ))}
            {(project.references || []).length === 0 && <div className="war-room-item-meta">No source references linked.</div>}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Project memory</div>
          <div className="war-room-list">
            {(project.memory_capsules || []).map((capsule) => (
              <div key={capsule.id} className="war-room-list-item war-room-list-item-stack">
                <div className="war-room-item-title">{capsule.summary}</div>
                <div className="war-room-item-meta">{capsule.kind} · {capsule.importance} · {capsule.promotion_state}</div>
              </div>
            ))}
            {(project.memory_capsules || []).length === 0 && <div className="war-room-item-meta">No scoped memory capsules linked.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProjectDetail;
