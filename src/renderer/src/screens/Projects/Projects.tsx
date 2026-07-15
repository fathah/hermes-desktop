import { useCallback, useEffect, useMemo, useState } from "react";
import type { HccProject } from "../../types/hcc";

interface ProjectsProps {
  selectedProjectId: string | null;
  onSelectProject: (projectId: string) => void;
}

function Projects({ selectedProjectId, onSelectProject }: ProjectsProps): React.JSX.Element {
  const [projects, setProjects] = useState<HccProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = (await window.hermesAPI.getHccProjects()) as {
        ok?: boolean;
        items?: HccProject[];
      };
      setProjects(Array.isArray(payload.items) ? payload.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load HCC projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const sortedProjects = useMemo(
    () =>
      [...projects].sort(
        (a, b) =>
          (b.momentum_score ?? 0) - (a.momentum_score ?? 0) ||
          (b.clarity_score ?? 0) - (a.clarity_score ?? 0),
      ),
    [projects],
  );

  if (loading) {
    return <div className="hcc-projects-screen"><div className="war-room-loading">Loading projects…</div></div>;
  }

  if (error) {
    return (
      <div className="hcc-projects-screen">
        <div className="war-room-error-card">
          <div className="war-room-card-kicker">Projects unavailable</div>
          <div className="war-room-error-copy">{error}</div>
          <button className="war-room-refresh-btn" onClick={() => void loadProjects()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="hcc-projects-screen">
      <div className="war-room-hero-card">
        <div>
          <div className="war-room-card-kicker">HCC OS / Projects</div>
          <h1 className="war-room-title">Projects Index</h1>
          <p className="war-room-subtitle">
            Project-first execution lane. Pick a project to inspect purpose, momentum, blockers, and outputs.
          </p>
        </div>
        <button className="war-room-refresh-btn" onClick={() => void loadProjects()}>
          Refresh
        </button>
      </div>

      <div className="hcc-projects-grid">
        {sortedProjects.map((project) => (
          <button
            key={project.id}
            className={`hcc-project-card ${selectedProjectId === project.id ? "active" : ""}`}
            onClick={() => onSelectProject(project.id)}
          >
            <div className="war-room-card-kicker">{project.type || "project"}</div>
            <div className="war-room-item-title hcc-project-title">{project.name}</div>
            <div className="war-room-item-meta">{project.purpose || project.description || "No purpose yet."}</div>
            <div className="hcc-project-card-row">
              <span className="war-room-pill">{project.status}</span>
              <span className="war-room-pill">momentum {project.momentum_score ?? 0}</span>
              <span className="war-room-pill">risk {project.risk_score ?? 0}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default Projects;
