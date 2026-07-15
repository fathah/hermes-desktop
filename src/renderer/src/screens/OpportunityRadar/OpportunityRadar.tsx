import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  HccOpportunityCandidate,
  HccOpportunityRadar,
} from "../../types/hcc";

type OpportunityAction = "capture" | "dismiss" | "promote";
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
                  <button className="war-room-refresh-btn" disabled={Boolean(acting)} onClick={() => void act(candidate, "dismiss")}>Dismiss</button>
                  <button className="war-room-refresh-btn opportunity-promote" disabled={Boolean(acting)} onClick={() => void act(candidate, "promote")}>Promote for approval</button>
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
