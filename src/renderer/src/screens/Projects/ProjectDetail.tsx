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
          <div className="war-room-panel-title">Milestones</div>
          <div className="war-room-list">
            {(project.milestones || []).map((item) => (
              <div key={item} className="war-room-list-item">
                <div className="war-room-item-title">{item}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Blockers</div>
          <div className="war-room-list">
            {(project.blockers || []).map((item) => (
              <div key={item} className="war-room-list-item">
                <div className="war-room-item-title">{item}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Linked domains</div>
          <div className="war-room-list">
            {(project.linked_domain_ids || []).map((item) => (
              <div key={item} className="war-room-list-item">
                <div className="war-room-item-title">{item}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Outputs</div>
          <div className="war-room-list">
            {(project.outputs || []).map((item) => (
              <div key={item} className="war-room-list-item">
                <div className="war-room-item-title">{item}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProjectDetail;
