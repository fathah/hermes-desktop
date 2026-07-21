import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  HccOpportunityCandidate,
  HccOpportunityIntervention,
  HccOpportunityRadar,
} from "../../types/hcc";

type OpportunityAction = "capture" | "dismiss" | "defer" | "promote";
type InterventionMode = "convert_project" | "create_tasks" | "stage_execution";
type CategoryFilter = "all" | HccOpportunityCandidate["category"];

function evidenceValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ") || "none";
  if (value === null || value === undefined || value === "") return "none";
  return String(value);
}

function OpportunityRadar(): React.JSX.Element {
  const [radar, setRadar] = useState<HccOpportunityRadar | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeDismissed, setIncludeDismissed] = useState(false);
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rationale, setRationale] = useState("");
  const [acting, setActing] = useState<string | null>(null);
  const [intervention, setIntervention] = useState<HccOpportunityIntervention | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const payload = await window.hermesAPI.getHccOpportunities(includeDismissed);
      setRadar(payload as HccOpportunityRadar);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load Opportunity Radar.");
    } finally {
      setLoading(false);
    }
  }, [includeDismissed]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = useMemo(
    () => (radar?.items || []).filter((item) => category === "all" || item.category === category),
    [category, radar],
  );

  const act = async (candidate: HccOpportunityCandidate, action: OpportunityAction): Promise<void> => {
    setActing(`${candidate.id}:${action}`);
    setError(null);
    try {
      await window.hermesAPI.actOnHccOpportunity(
        candidate.id,
        action,
        selectedId === candidate.id ? rationale.trim() : "",
      );
      setSelectedId(null);
      setRationale("");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Opportunity action failed.");
    } finally {
      setActing(null);
    }
  };

  const stage = async (candidate: HccOpportunityCandidate, mode: InterventionMode): Promise<void> => {
    setActing(`${candidate.id}:${mode}`);
    setError(null);
    setMessage(null);
    try {
      const result = await window.hermesAPI.stageHccOpportunityIntervention(
        candidate.id,
        mode,
        selectedId === candidate.id ? rationale.trim() : "",
        mode === "convert_project" ? { projectName: candidate.title } : {},
      );
      setIntervention(result as HccOpportunityIntervention);
      setMessage("Intervention staged. Canonical state unchanged until explicit approval.");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Intervention staging failed.");
    } finally {
      setActing(null);
    }
  };

  const approve = async (): Promise<void> => {
    if (!intervention) return;
    setActing(`approve:${intervention.id}`);
    setError(null);
    try {
      const result = await window.hermesAPI.approveHccOpportunityIntervention(intervention.id);
      setIntervention(result as HccOpportunityIntervention);
      setMessage("Intervention approved. Project/tasks or pending execution created with audit evidence.");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Intervention approval failed.");
    } finally {
      setActing(null);
    }
  };

  const recordOutcome = async (status: "positive" | "neutral" | "negative"): Promise<void> => {
    if (!intervention) return;
    setActing(`outcome:${intervention.id}`);
    setError(null);
    try {
      await window.hermesAPI.recordHccOpportunityOutcome(
        intervention.id,
        status,
        { operatorAssessment: status },
        { projectId: intervention.projectId, executionId: intervention.executionId },
      );
      setMessage("Outcome measured. Reflective lesson persisted into private HCC memory.");
      setIntervention({ ...intervention, status: "measured" });
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Outcome recording failed.");
    } finally {
      setActing(null);
    }
  };

  if (loading && !radar) {
    return <div className="war-room-loading">Scanning canonical HCC signals…</div>;
  }

  return (
    <div className="hcc-opportunity-screen">
      <section className="war-room-hero-card opportunity-hero">
        <div>
          <div className="war-room-card-kicker">Deep Advantage · M10</div>
          <h1 className="war-room-title">{radar?.hero.title || "Opportunity Radar"}</h1>
          <p className="war-room-subtitle">
            {radar?.hero.subtitle || "Evidence-backed leverage across domains, projects, and references."}
          </p>
        </div>
        <div className="war-room-action-row">
          <button className="war-room-refresh-btn" onClick={() => void load()} disabled={loading}>
            {loading ? "Scanning…" : "Rescan"}
          </button>
        </div>
      </section>

      {error && <div className="war-room-error-card"><div className="war-room-item-title">Radar error</div><div className="war-room-error-copy">{error}</div></div>}
      {message && <div className="war-room-panel opportunity-message">{message}</div>}
      {intervention && (
        <section className="war-room-panel opportunity-intervention-panel">
          <div>
            <div className="war-room-card-kicker">Human-gated intervention</div>
            <div className="war-room-panel-title">{intervention.mode.replaceAll("_", " ")} · {intervention.status}</div>
            <div className="war-room-subtitle">{intervention.plan.mutationPreview}</div>
            <div className="war-room-item-meta">{intervention.plan.rollbackHint}</div>
          </div>
          <div className="war-room-action-row">
            {intervention.status === "pending_approval" && <button className="war-room-refresh-btn opportunity-promote" disabled={Boolean(acting)} onClick={() => void approve()}>Approve intervention</button>}
            {intervention.status === "approved" && <>
              <button className="war-room-refresh-btn" disabled={Boolean(acting)} onClick={() => void recordOutcome("positive")}>Outcome positive</button>
              <button className="war-room-refresh-btn" disabled={Boolean(acting)} onClick={() => void recordOutcome("neutral")}>Outcome neutral</button>
              <button className="war-room-refresh-btn" disabled={Boolean(acting)} onClick={() => void recordOutcome("negative")}>Outcome negative</button>
            </>}
          </div>
        </section>
      )}

      <section className="war-room-hero-grid">
        <article className="war-room-stat-card"><div className="war-room-stat-label">Visible signals</div><div className="war-room-stat-value">{radar?.summary.total || 0}</div></article>
        <article className="war-room-stat-card"><div className="war-room-stat-label">High confidence</div><div className="war-room-stat-value">{radar?.summary.highConfidence || 0}</div></article>
        <article className="war-room-stat-card"><div className="war-room-stat-label">Captured</div><div className="war-room-stat-value">{radar?.summary.captured || 0}</div></article>
        <article className="war-room-stat-card"><div className="war-room-stat-label">Approval proposals</div><div className="war-room-stat-value">{radar?.summary.proposed || 0}</div></article>
      </section>

      <section className="war-room-panel opportunity-controls">
        <div className="hcc-memory-packet-tabs">
          {(["all", "domain_recovery", "project_acceleration", "reference_leverage"] as CategoryFilter[]).map((value) => (
            <button
              className={`war-room-refresh-btn ${category === value ? "active" : ""}`}
              key={value}
              onClick={() => setCategory(value)}
            >
              {value.replaceAll("_", " ")}
            </button>
          ))}
        </div>
        <label className="opportunity-toggle">
          <input
            type="checkbox"
            checked={includeDismissed}
            onChange={(event) => setIncludeDismissed(event.target.checked)}
          />
          Include dismissed
        </label>
      </section>

      <section className="opportunity-grid">
        {items.map((candidate) => {
          const selected = selectedId === candidate.id;
          return (
            <article className={`opportunity-card status-${candidate.status}`} key={candidate.id}>
              <div className="opportunity-card-head">
                <div>
                  <div className="war-room-card-kicker">{candidate.category.replaceAll("_", " ")}</div>
                  <h2>{candidate.title}</h2>
                </div>
                <div className="opportunity-score" aria-label={`Opportunity score ${candidate.score}`}>{candidate.score}</div>
              </div>
              <p className="war-room-subtitle">{candidate.summary}</p>

              <div className="opportunity-dimensions">
                {[
                  ["Fit", candidate.strategicFit],
                  ["Urgency", candidate.urgency],
                  ["Confidence", candidate.confidence],
                  ["Effort", candidate.effort],
                  ["Risk", candidate.risk],
                ].map(([label, value]) => (
                  <div className="opportunity-dimension" key={label}>
                    <span>{label}</span><strong>{value}</strong>
                    <div><i style={{ width: `${value}%` }} /></div>
                  </div>
                ))}
              </div>

              <div className="opportunity-evidence">
                {candidate.evidence.map((item) => (
                  <div key={item.signal}><span>{item.signal.replaceAll("_", " ")}</span><strong>{evidenceValue(item.value)}</strong></div>
                ))}
              </div>

              <div className="opportunity-recommendation">
                <span>Recommended</span>
                <strong>{candidate.recommendedAction}</strong>
              </div>
              <div className="opportunity-impact-grid">
                <div><span>Why now</span><strong>{candidate.whyNow}</strong></div>
                <div><span>Expected upside</span><strong>{candidate.expectedUpside}</strong></div>
                <div><span>Opportunity cost</span><strong>{candidate.opportunityCost}</strong></div>
                <div><span>Execution readiness</span><strong>{candidate.executionReadiness}%</strong></div>
              </div>

              {selected && (
                <textarea
                  className="war-room-input opportunity-rationale"
                  value={rationale}
                  onChange={(event) => setRationale(event.target.value)}
                  placeholder="Optional operator rationale. Stored in append-only audit evidence."
                  autoFocus
                />
              )}

              <div className="opportunity-card-footer">
                <span className={`war-room-pill tone-${candidate.status === "dismissed" ? "risk" : candidate.status === "proposed" ? "watch" : "healthy"}`}>
                  {candidate.status}
                </span>
                <div className="war-room-action-row">
                  <button className="war-room-refresh-btn" onClick={() => setSelectedId(selected ? null : candidate.id)}>Rationale</button>
                  <button className="war-room-refresh-btn" disabled={Boolean(acting)} onClick={() => void act(candidate, "capture")}>Capture</button>
                  <button className="war-room-refresh-btn" disabled={Boolean(acting)} onClick={() => void act(candidate, "defer")}>Defer</button>
                  <button className="war-room-refresh-btn" disabled={Boolean(acting)} onClick={() => void act(candidate, "dismiss")}>Dismiss</button>
                  <button className="war-room-refresh-btn" disabled={Boolean(acting)} onClick={() => void stage(candidate, candidate.target.type === "project" ? "create_tasks" : "convert_project")}>{candidate.target.type === "project" ? "Stage tasks" : "Stage project"}</button>
                  <button className="war-room-refresh-btn opportunity-promote" disabled={Boolean(acting)} onClick={() => void stage(candidate, "stage_execution")}>Stage execution</button>
                </div>
              </div>
            </article>
          );
        })}
        {!items.length && <div className="war-room-panel"><div className="war-room-panel-title">No matching opportunities</div><div className="war-room-subtitle">Change filters or rescan after canonical state changes.</div></div>}
      </section>

      <section className="war-room-panel opportunity-methodology">
        <div>
          <div className="war-room-card-kicker">Transparent ranking</div>
          <div className="war-room-panel-title">{radar?.methodology.formula}</div>
        </div>
        <span className="war-room-pill tone-healthy">Proposal-only mutation policy</span>
      </section>
    </div>
  );
}

export default OpportunityRadar;
