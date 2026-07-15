import { useCallback, useEffect, useMemo, useState } from "react";
import type { HccWarRoomSummary } from "../../types/hcc";

function toneClass(score: number): string {
  if (score >= 75) return "healthy";
  if (score >= 60) return "watch";
  return "risk";
}

interface WarRoomProps {
  onOpenProject: (projectId: string) => void;
  onOpenDomain: (domainId: string) => void;
  onOpenMemory: () => void;
}

function WarRoom({ onOpenProject, onOpenDomain, onOpenMemory }: WarRoomProps): React.JSX.Element {
  const [data, setData] = useState<HccWarRoomSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stagingId, setStagingId] = useState<string | null>(null);
  const [stageMessage, setStageMessage] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = (await window.hermesAPI.getHccWarRoomSummary()) as HccWarRoomSummary & { ok?: boolean };
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load War Room summary");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const recommendationCount = data?.recommendations.length ?? 0;
  const heroStats = useMemo(
    () => [
      { label: "Active projects", value: data?.hero.activeProjectCount ?? 0 },
      { label: "Domains", value: data?.hero.domainCount ?? 0 },
      { label: "Tools", value: data?.hero.toolCount ?? 0 },
      { label: "Integrity issues", value: data?.summary.integrityIssueCount ?? 0 },
      { label: "Recommendations", value: recommendationCount },
    ],
    [data, recommendationCount],
  );

  const selectRecommendation = (action: HccWarRoomSummary["recommendations"][number]["action"]): void => {
    if (action.project_id) {
      onOpenProject(action.project_id);
      return;
    }
    if (action.domain_id) {
      onOpenDomain(action.domain_id);
    }
  };

  const stageIntervention = async (interventionId: string): Promise<void> => {
    setStagingId(interventionId);
    setStageMessage(null);
    try {
      await window.hermesAPI.stageHccIntervention(interventionId, "desktop-operator");
      setStageMessage("Intervention staged for approval. No live state changed.");
      await loadSummary();
    } catch (err) {
      setStageMessage(err instanceof Error ? err.message : "Failed to stage intervention");
    } finally {
      setStagingId(null);
    }
  };

  if (loading) {
    return (
      <div className="war-room-screen">
        <div className="war-room-loading">Loading War Room…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="war-room-screen">
        <div className="war-room-error-card">
          <div className="war-room-card-kicker">War Room unavailable</div>
          <div className="war-room-error-copy">{error || "No War Room data returned."}</div>
          <button className="war-room-refresh-btn" onClick={() => void loadSummary()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="war-room-screen">
      <section className="war-room-hero-card">
        <div>
          <div className="war-room-card-kicker">HCC OS / War Room</div>
          <h1 className="war-room-title">{data.hero.title}</h1>
          <p className="war-room-subtitle">{data.hero.subtitle}</p>
        </div>
        <button className="war-room-refresh-btn" onClick={() => void loadSummary()}>
          Refresh
        </button>
      </section>

      <section className="war-room-hero-grid">
        {heroStats.map((item) => (
          <div key={item.label} className="war-room-stat-card">
            <div className="war-room-stat-label">{item.label}</div>
            <div className="war-room-stat-value">{item.value}</div>
          </div>
        ))}
      </section>

      <section className="war-room-panel hcc-graph-integrity-panel">
        <div>
          <div className="war-room-panel-title">Graph integrity</div>
          <div className="war-room-item-meta">
            {data.summary.integrityHealth} · {data.summary.integrityIssueCount} issue(s) · orphan {data.integrity.summary.orphanEdgeCount} · invalid rel {data.integrity.summary.invalidRelationshipCount} · duplicates {data.integrity.summary.semanticDuplicateCount}
          </div>
        </div>
      </section>

      <section className="war-room-grid">
        <div className="war-room-panel">
          <div className="war-room-panel-title">Reality and capacity</div>
          <div className="war-room-item-title">
            {data.reality.antiChaos.recommendedMode.replaceAll("_", " ")} · {Math.round(data.reality.capacity.loadRatio * 100)}% load
          </div>
          <div className="war-room-item-meta">
            Energy {data.reality.profile.energyState} · demand {data.reality.capacity.projectDemandMinutes}m · adjusted capacity {data.reality.capacity.energyAdjustedMinutes}m · remaining {data.reality.capacity.remainingMinutes}m
          </div>
          <div className="war-room-list">
            {data.reality.conflicts.map((conflict) => (
              <div key={conflict.id} className="war-room-list-item">
                <div>
                  <div className="war-room-item-title">{conflict.type.replaceAll("_", " ")}</div>
                  <div className="war-room-item-meta">{conflict.message}</div>
                </div>
                <div className="war-room-pill">{conflict.severity}</div>
              </div>
            ))}
            {data.reality.conflicts.length === 0 && <div className="war-room-item-meta">No current capacity or cross-domain conflicts.</div>}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Governed interventions</div>
          <div className="war-room-list">
            {data.reality.interventions.map((intervention) => (
              <div key={intervention.id} className="war-room-list-item war-room-list-item-stack">
                <div className="war-room-item-title">{intervention.label}</div>
                <div className="war-room-item-meta">{intervention.reason}</div>
                <button
                  className="war-room-refresh-btn"
                  disabled={stagingId === intervention.id}
                  onClick={() => void stageIntervention(intervention.id)}
                >
                  {stagingId === intervention.id ? "Staging…" : intervention.requiresApproval ? "Stage for approval" : "Stage action"}
                </button>
              </div>
            ))}
            {data.reality.interventions.length === 0 && <div className="war-room-item-meta">No intervention required.</div>}
          </div>
          {stageMessage && <div className="war-room-item-meta">{stageMessage}</div>}
        </div>
      </section>

      <section className="war-room-grid">
        <div className="war-room-panel">
          <div className="war-room-panel-title">Priority projects</div>
          <div className="war-room-list">
            {data.priorities.map((project) => (
              <button
                key={project.id}
                className="war-room-list-item war-room-list-button"
                onClick={() => onOpenProject(project.id)}
              >
                <div>
                  <div className="war-room-item-title">{project.name}</div>
                  <div className="war-room-item-meta">
                    {project.status} · relevance {project.strategic_relevance || "high"} · {project.dependencyCount ?? 0} links
                  </div>
                </div>
                <div className={`war-room-pill tone-${toneClass(100 - (project.propagatedRisk ?? 0))}`}>
                  graph {project.propagatedRisk ?? 0}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Risky domains</div>
          <div className="war-room-list">
            {data.riskyDomains.map((domain) => (
              <button
                key={domain.id}
                className="war-room-list-item war-room-list-button"
                onClick={() => onOpenDomain(domain.id)}
              >
                <div>
                  <div className="war-room-item-title">{domain.name}</div>
                  <div className="war-room-item-meta">
                    {domain.neglect_risk} risk · {domain.open_loops.length} open loops · {domain.dependencyCount ?? 0} links
                  </div>
                </div>
                <div className={`war-room-pill tone-${toneClass(100 - (domain.propagatedRisk ?? 0))}`}>
                  graph {domain.propagatedRisk ?? 0}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Due reviews</div>
          <div className="war-room-list">
            {data.dueReviews.map((review) => (
              <div key={`${review.scope_type}-${review.scope_id}`} className="war-room-list-item">
                <div>
                  <div className="war-room-item-title">{review.label}</div>
                  <div className="war-room-item-meta">{review.scope_type}</div>
                </div>
                <div className="war-room-pill">{review.review_cadence}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Open loops</div>
          <div className="war-room-list">
            {data.openLoops.map((loop, index) => (
              <div key={`${loop.type}-${index}`} className="war-room-list-item">
                <div>
                  <div className="war-room-item-title">{loop.label}</div>
                  <div className="war-room-item-meta">
                    {loop.project_name || loop.domain_name || loop.type}
                  </div>
                </div>
                <div className="war-room-pill">{loop.type}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="war-room-grid war-room-grid-bottom">
        <div className="war-room-panel">
          <div className="war-room-panel-title">Recommendations</div>
          <div className="war-room-list">
            {data.recommendations.map((rec) => (
              <button
                key={rec.id}
                className="war-room-list-item war-room-list-item-stack war-room-list-button"
                onClick={() => selectRecommendation(rec.action)}
                disabled={!rec.action.project_id && !rec.action.domain_id}
              >
                <div className="war-room-item-title">{rec.label}</div>
                <div className="war-room-item-meta">{rec.reason}</div>
                <div className="war-room-inline-action">action: {rec.action.type}</div>
              </button>
            ))}
          </div>
        </div>

        <button className="war-room-panel war-room-panel-button" onClick={onOpenMemory}>
          <div className="war-room-panel-title">Memory packets</div>
          <div className="war-room-memory-columns">
            <div>
              <div className="war-room-memory-title">Tiny packet</div>
              <div className="war-room-memory-meta">
                {data.memoryPackets.tiny.summary.count} items · {data.memoryPackets.tiny.summary.elapsedMs}ms
              </div>
              {data.memoryPackets.tiny.items.map((item) => (
                <div key={item.id} className="war-room-memory-item">
                  <div className="war-room-item-title">{item.summary}</div>
                  <div className="war-room-item-meta">
                    {item.kind} · {item.importance}
                  </div>
                </div>
              ))}
            </div>
            <div>
              <div className="war-room-memory-title">Review packet</div>
              <div className="war-room-memory-meta">
                {data.memoryPackets.review.summary.count} items · {data.memoryPackets.review.summary.elapsedMs}ms
              </div>
              {data.memoryPackets.review.items.map((item) => (
                <div key={item.id} className="war-room-memory-item">
                  <div className="war-room-item-title">{item.summary}</div>
                  <div className="war-room-item-meta">
                    {item.kind} · {item.promotion_state}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </button>
      </section>
    </div>
  );
}

export default WarRoom;
