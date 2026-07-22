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

interface IdentityDraft {
  currentSeason: string;
  ambitionHorizon: string;
  riskTolerance: "conservative" | "balanced" | "aggressive";
  energyState: "high" | "normal" | "low" | "depleted";
  weeklyFocusMinutes: string;
  weeklyRecoveryMinutes: string;
  maxActiveProjects: string;
  values: string;
  principles: string;
  antiGoals: string;
  strategicPriorityOrder: string;
  hardConstraints: string;
  softPreferences: string;
}

function joinStringList(items: Array<string | Record<string, unknown>> | undefined): string {
  return (items || []).filter((item): item is string => typeof item === "string").join("\n");
}

function splitStringList(value: string): string[] {
  return value.split(/\n|,/).map((item) => item.trim()).filter(Boolean);
}

function toLocalInputValue(timestamp: number): string {
  const date = new Date(timestamp);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(timestamp - offset).toISOString().slice(0, 16);
}

function nextTimeBlockDraft(): { title: string; startAt: string; endAt: string; energyRequirement: "high" | "normal" | "low" } {
  const start = Math.ceil((Date.now() + 30 * 60_000) / 3_600_000) * 3_600_000;
  return { title: "", startAt: toLocalInputValue(start), endAt: toLocalInputValue(start + 60 * 60_000), energyRequirement: "normal" };
}

function identityDraftFrom(profile: HccWarRoomSummary["reality"]["profile"]): IdentityDraft {
  return {
    currentSeason: profile.currentSeason || "",
    ambitionHorizon: profile.ambitionHorizon || "",
    riskTolerance: profile.riskTolerance || "balanced",
    energyState: profile.energyState,
    weeklyFocusMinutes: String(profile.weeklyFocusMinutes ?? 0),
    weeklyRecoveryMinutes: String(profile.weeklyRecoveryMinutes ?? 0),
    maxActiveProjects: String(profile.maxActiveProjects),
    values: joinStringList(profile.values),
    principles: joinStringList(profile.principles),
    antiGoals: joinStringList(profile.antiGoals),
    strategicPriorityOrder: joinStringList(profile.strategicPriorityOrder),
    hardConstraints: joinStringList(profile.hardConstraints),
    softPreferences: joinStringList(profile.softPreferences),
  };
}

function WarRoom({ onOpenProject, onOpenDomain, onOpenMemory }: WarRoomProps): React.JSX.Element {
  const [data, setData] = useState<HccWarRoomSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stagingId, setStagingId] = useState<string | null>(null);
  const [stageMessage, setStageMessage] = useState<string | null>(null);
  const [identityDraft, setIdentityDraft] = useState<IdentityDraft | null>(null);
  const [identitySaving, setIdentitySaving] = useState(false);
  const [identityMessage, setIdentityMessage] = useState<string | null>(null);
  const [timeBlockDraft, setTimeBlockDraft] = useState(nextTimeBlockDraft);
  const [timeBlockBusy, setTimeBlockBusy] = useState<string | null>(null);
  const [timeMessage, setTimeMessage] = useState<string | null>(null);
  const [tradeoffRationale, setTradeoffRationale] = useState<Record<string, string>>({});
  const [strategicBusy, setStrategicBusy] = useState<string | null>(null);
  const [strategicMessage, setStrategicMessage] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = (await window.hermesAPI.getHccWarRoomSummary()) as HccWarRoomSummary & { ok?: boolean };
      setData(payload);
      setIdentityDraft((current) => current || identityDraftFrom(payload.reality.profile));
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

  const saveIdentityProfile = async (): Promise<void> => {
    if (!identityDraft) return;
    setIdentitySaving(true);
    setIdentityMessage(null);
    try {
      const payload = {
        actor: "desktop-operator",
        currentSeason: identityDraft.currentSeason.trim(),
        ambitionHorizon: identityDraft.ambitionHorizon.trim(),
        riskTolerance: identityDraft.riskTolerance,
        energyState: identityDraft.energyState,
        weeklyFocusMinutes: Number(identityDraft.weeklyFocusMinutes),
        weeklyRecoveryMinutes: Number(identityDraft.weeklyRecoveryMinutes),
        maxActiveProjects: Number(identityDraft.maxActiveProjects),
        values: splitStringList(identityDraft.values),
        principles: splitStringList(identityDraft.principles),
        antiGoals: splitStringList(identityDraft.antiGoals),
        strategicPriorityOrder: splitStringList(identityDraft.strategicPriorityOrder),
        hardConstraints: splitStringList(identityDraft.hardConstraints),
        softPreferences: splitStringList(identityDraft.softPreferences),
      };
      const updated = await window.hermesAPI.updateHccOperatingProfile(payload) as HccWarRoomSummary["reality"]["profile"];
      setIdentityDraft(identityDraftFrom(updated));
      setIdentityMessage("Operating model saved with actor-attributed audit history.");
      await loadSummary();
    } catch (err) {
      setIdentityMessage(err instanceof Error ? err.message : "Failed to save operating model");
    } finally {
      setIdentitySaving(false);
    }
  };

  const createTimeBlock = async (): Promise<void> => {
    setTimeBlockBusy("create");
    setTimeMessage(null);
    try {
      await window.hermesAPI.createHccTimeBlock({
        title: timeBlockDraft.title.trim(),
        startAt: new Date(timeBlockDraft.startAt).getTime() / 1000,
        endAt: new Date(timeBlockDraft.endAt).getTime() / 1000,
        energyRequirement: timeBlockDraft.energyRequirement,
      });
      setTimeBlockDraft(nextTimeBlockDraft());
      setTimeMessage("Time block scheduled against real weekly capacity.");
      await loadSummary();
    } catch (err) {
      setTimeMessage(err instanceof Error ? err.message : "Failed to schedule time block");
    } finally {
      setTimeBlockBusy(null);
    }
  };

  const cancelTimeBlock = async (blockId: string): Promise<void> => {
    setTimeBlockBusy(blockId);
    setTimeMessage(null);
    try {
      await window.hermesAPI.cancelHccTimeBlock(blockId);
      setTimeMessage("Time block cancelled.");
      await loadSummary();
    } catch (err) {
      setTimeMessage(err instanceof Error ? err.message : "Failed to cancel time block");
    } finally {
      setTimeBlockBusy(null);
    }
  };

  const acceptTradeoff = async (conflictId: string, optionId: string): Promise<void> => {
    const rationale = (tradeoffRationale[conflictId] || "").trim();
    if (!rationale) {
      setStrategicMessage("Tradeoff acceptance requires explicit rationale.");
      return;
    }
    setStrategicBusy(conflictId);
    setStrategicMessage(null);
    try {
      await window.hermesAPI.decideHccTradeoff(conflictId, optionId, rationale);
      setStrategicMessage("Tradeoff decision recorded with evidence and rationale.");
      await loadSummary();
    } catch (err) {
      setStrategicMessage(err instanceof Error ? err.message : "Failed to record tradeoff");
    } finally {
      setStrategicBusy(null);
    }
  };

  const stageRecoveryAction = async (actionId: string): Promise<void> => {
    setStrategicBusy(actionId);
    setStrategicMessage(null);
    try {
      await window.hermesAPI.stageHccRecoveryAction(actionId);
      setStrategicMessage("Recovery action staged. Approval required before mutation.");
      await loadSummary();
    } catch (err) {
      setStrategicMessage(err instanceof Error ? err.message : "Failed to stage recovery action");
    } finally {
      setStrategicBusy(null);
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

      <section className={`war-room-panel war-room-observability tone-${data.observability.status}`}>
        <div className="war-room-panel-title">System observability</div>
        <div className="war-room-item-meta">Formal operating metrics · {data.observability.status} · generated {new Date(data.observability.generatedAt * 1000).toLocaleTimeString()}</div>
        <div className="war-room-observability-grid">
          <div><span>Domain stability</span><strong>{data.observability.domains.stable}/{data.observability.domains.total}</strong><small>average {data.observability.domains.averageHealth}</small></div>
          <div><span>Project throughput</span><strong>{Math.round(data.observability.projects.throughputRate * 100)}%</strong><small>{data.observability.projects.blocked} blocked</small></div>
          <div><span>Queue overload</span><strong>{data.observability.execution.runs.queued ?? 0}</strong><small>{data.observability.execution.active} active</small></div>
          <div><span>Memory health</span><strong>{data.observability.memory.healthScore ?? 0}</strong><small>{data.observability.memory.sensitiveWarnings} privacy warning</small></div>
          <div><span>Review compliance</span><strong>{data.observability.reviews.highUrgency ?? 0}</strong><small>high urgency</small></div>
          <div><span>Gateway availability</span><strong>{data.observability.gateways.running}/{data.observability.gateways.total}</strong><small>{data.observability.gateways.unavailable} unavailable</small></div>
          <div><span>Privacy enforcement</span><strong>{data.observability.privacy.policyCount}</strong><small>{data.observability.privacy.accessDeniedCount} denied · {data.observability.privacy.retentionPolicyCount} retention</small></div>
          <div><span>Capacity</span><strong>{Math.round(data.observability.capacity.loadRatio * 100)}%</strong><small>{data.observability.capacity.recommendedMode.replaceAll("_", " ")}</small></div>
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

      <section className="war-room-grid war-room-strategic-grid">
        <div className="war-room-panel">
          <div className="war-room-panel-title">Conflict and tradeoff engine</div>
          <div className="war-room-item-meta">Scores benefit, feasibility, and risk. Human rationale required for acceptance.</div>
          <div className="war-room-list">
            {data.tradeoffs.map((tradeoff) => {
              const recommended = tradeoff.options.find((option) => option.id === tradeoff.recommendedOption);
              return (
                <div key={tradeoff.id} className="war-room-list-item war-room-list-item-stack">
                  <div className="war-room-item-title">{tradeoff.conflict.type.replaceAll("_", " ")} · {tradeoff.conflict.severity}</div>
                  <div className="war-room-item-meta">{tradeoff.conflict.message}</div>
                  {recommended && <div className="war-room-item-meta">Recommended: {recommended.label} · score {recommended.score}</div>}
                  <input className="war-room-input" aria-label={`Rationale for ${tradeoff.id}`} placeholder="Why is this tradeoff acceptable?" value={tradeoffRationale[tradeoff.id] || ""} onChange={(event) => setTradeoffRationale({ ...tradeoffRationale, [tradeoff.id]: event.target.value })} />
                  {recommended && <button className="war-room-refresh-btn" disabled={strategicBusy === tradeoff.id} onClick={() => void acceptTradeoff(tradeoff.id, recommended.id)}>{strategicBusy === tradeoff.id ? "Recording…" : "Accept recommended tradeoff"}</button>}
                </div>
              );
            })}
            {data.tradeoffs.length === 0 && <div className="war-room-item-meta">No active conflicts require arbitration.</div>}
          </div>
        </div>

        <div className="war-room-panel">
          <div className="war-room-panel-title">Recovery and anti-chaos</div>
          <div className="war-room-item-title">{data.recovery.recommendedMode.replaceAll("_", " ")} · energy {data.recovery.signals.energy}</div>
          <div className="war-room-item-meta">{data.recovery.signals.critical} critical · {data.recovery.signals.high} high signal(s). Scope reduction stays approval-gated.</div>
          <div className="war-room-list">
            {data.recovery.actions.map((action) => (
              <div key={action.id} className="war-room-list-item war-room-list-item-stack">
                <div className="war-room-item-title">{action.label}</div>
                <div className="war-room-item-meta">{action.reason}</div>
                <button className="war-room-refresh-btn" disabled={strategicBusy === action.id} onClick={() => void stageRecoveryAction(action.id)}>{strategicBusy === action.id ? "Staging…" : "Stage recovery approval"}</button>
              </div>
            ))}
            {data.recovery.actions.length === 0 && <div className="war-room-item-meta">Recovery plan requires no mode change.</div>}
          </div>
          {strategicMessage && <div className="war-room-item-meta">{strategicMessage}</div>}
        </div>
      </section>

      {identityDraft && (
        <section className="war-room-grid war-room-strategic-grid">
          <div className="war-room-panel">
            <div className="war-room-panel-title">Identity operating model</div>
            <div className="war-room-item-meta">Explicit values and constraints guide future recommendations. Changes are actor-audited.</div>
            <div className="war-room-form-grid">
              <label><span>Current season</span><input className="war-room-input" value={identityDraft.currentSeason} onChange={(event) => setIdentityDraft({ ...identityDraft, currentSeason: event.target.value })} /></label>
              <label><span>Ambition horizon</span><input className="war-room-input" value={identityDraft.ambitionHorizon} onChange={(event) => setIdentityDraft({ ...identityDraft, ambitionHorizon: event.target.value })} /></label>
              <label><span>Risk tolerance</span><select className="war-room-input" value={identityDraft.riskTolerance} onChange={(event) => setIdentityDraft({ ...identityDraft, riskTolerance: event.target.value as IdentityDraft["riskTolerance"] })}><option value="conservative">conservative</option><option value="balanced">balanced</option><option value="aggressive">aggressive</option></select></label>
              <label><span>Energy state</span><select className="war-room-input" value={identityDraft.energyState} onChange={(event) => setIdentityDraft({ ...identityDraft, energyState: event.target.value as IdentityDraft["energyState"] })}><option value="high">high</option><option value="normal">normal</option><option value="low">low</option><option value="depleted">depleted</option></select></label>
              <label><span>Weekly focus minutes</span><input className="war-room-input" type="number" min="0" value={identityDraft.weeklyFocusMinutes} onChange={(event) => setIdentityDraft({ ...identityDraft, weeklyFocusMinutes: event.target.value })} /></label>
              <label><span>Weekly recovery minutes</span><input className="war-room-input" type="number" min="0" value={identityDraft.weeklyRecoveryMinutes} onChange={(event) => setIdentityDraft({ ...identityDraft, weeklyRecoveryMinutes: event.target.value })} /></label>
              <label><span>Max active projects</span><input className="war-room-input" type="number" min="0" value={identityDraft.maxActiveProjects} onChange={(event) => setIdentityDraft({ ...identityDraft, maxActiveProjects: event.target.value })} /></label>
            </div>
            <div className="war-room-form-grid textareas">
              {([
                ["values", "Values"], ["principles", "Principles"], ["antiGoals", "Anti-goals"],
                ["strategicPriorityOrder", "Strategic priority order"], ["hardConstraints", "Hard constraints"], ["softPreferences", "Soft preferences"],
              ] as Array<[keyof IdentityDraft, string]>).map(([field, label]) => (
                <label key={field}><span>{label}</span><textarea className="war-room-input" rows={3} value={identityDraft[field]} onChange={(event) => setIdentityDraft({ ...identityDraft, [field]: event.target.value })} placeholder="One item per line" /></label>
              ))}
            </div>
            <div className="war-room-action-row"><button className="war-room-refresh-btn" disabled={identitySaving} onClick={() => void saveIdentityProfile()}>{identitySaving ? "Saving…" : "Save operating model"}</button></div>
            {identityMessage && <div className="war-room-item-meta">{identityMessage}</div>}
          </div>

          <div className="war-room-panel">
            <div className="war-room-panel-title">Time architecture</div>
            <div className="war-room-item-meta">Focus {data.reality.capacity.weeklyFocusMinutes}m · recovery {data.reality.profile.weeklyRecoveryMinutes ?? 0}m · scheduled {data.reality.schedule.scheduledMinutes}m · remaining {data.reality.capacity.remainingMinutes}m</div>
            <div className="war-room-time-form">
              <input className="war-room-input" aria-label="Time block title" placeholder="Focus block title" value={timeBlockDraft.title} onChange={(event) => setTimeBlockDraft({ ...timeBlockDraft, title: event.target.value })} />
              <label><span>Start</span><input className="war-room-input" type="datetime-local" value={timeBlockDraft.startAt} onChange={(event) => setTimeBlockDraft({ ...timeBlockDraft, startAt: event.target.value })} /></label>
              <label><span>End</span><input className="war-room-input" type="datetime-local" value={timeBlockDraft.endAt} onChange={(event) => setTimeBlockDraft({ ...timeBlockDraft, endAt: event.target.value })} /></label>
              <label><span>Energy</span><select className="war-room-input" value={timeBlockDraft.energyRequirement} onChange={(event) => setTimeBlockDraft({ ...timeBlockDraft, energyRequirement: event.target.value as typeof timeBlockDraft.energyRequirement })}><option value="high">high</option><option value="normal">normal</option><option value="low">low</option></select></label>
              <button className="war-room-refresh-btn" disabled={timeBlockBusy !== null || !timeBlockDraft.title.trim()} onClick={() => void createTimeBlock()}>{timeBlockBusy === "create" ? "Scheduling…" : "Schedule block"}</button>
            </div>
            <div className="war-room-list">
              {data.reality.schedule.blocks.map((block) => (
                <div key={block.id} className="war-room-list-item">
                  <div><div className="war-room-item-title">{block.title}</div><div className="war-room-item-meta">{new Date(block.startAt * 1000).toLocaleString()} · {block.durationMinutes}m · {block.energyRequirement} energy</div></div>
                  <button className="war-room-refresh-btn compact" disabled={timeBlockBusy === block.id} onClick={() => void cancelTimeBlock(block.id)}>{timeBlockBusy === block.id ? "Cancelling…" : "Cancel"}</button>
                </div>
              ))}
              {data.reality.schedule.blocks.length === 0 && <div className="war-room-item-meta">No focus blocks scheduled in next seven days.</div>}
            </div>
            {timeMessage && <div className="war-room-item-meta">{timeMessage}</div>}
          </div>
        </section>
      )}

      <section className="war-room-grid">
        <div className="war-room-panel">
          <div className="war-room-panel-title">Execution pressure</div>
          <div className="war-room-execution-stats">
            <div className="war-room-stat-card compact">
              <div className="war-room-stat-label">Running</div>
              <div className="war-room-stat-value">{data.execution.summary.running ?? 0}</div>
            </div>
            <div className="war-room-stat-card compact">
              <div className="war-room-stat-label">Blocked</div>
              <div className="war-room-stat-value">{data.summary.blockedRunCount ?? data.execution.blockedRuns.length}</div>
            </div>
            <div className="war-room-stat-card compact">
              <div className="war-room-stat-label">Queued</div>
              <div className="war-room-stat-value">{data.execution.summary.queued ?? 0}</div>
            </div>
            <div className="war-room-stat-card compact">
              <div className="war-room-stat-label">Failed</div>
              <div className="war-room-stat-value">{data.execution.summary.failed ?? 0}</div>
            </div>
          </div>
          <div className="war-room-list">
            {data.execution.blockedRuns.map((run) => (
              <div key={run.id} className="war-room-list-item">
                <div>
                  <div className="war-room-item-title">{run.task_title || run.id}</div>
                  <div className="war-room-item-meta">{run.worker_id || "unassigned"} · {run.status || "blocked"}</div>
                </div>
                <div className="war-room-pill">blocked</div>
              </div>
            ))}
            {data.execution.blockedRuns.length === 0 && (
              <div className="war-room-item-meta">No blocked runs. Execution lane is clear.</div>
            )}
          </div>
          <div className="war-room-worker-summary">
            {data.execution.workers.map((worker) => (
              <div key={worker.worker_id} className="war-room-worker-chip">
                <span>{worker.worker_id}</span>
                <strong>{worker.runCount}</strong>
              </div>
            ))}
          </div>
        </div>

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
