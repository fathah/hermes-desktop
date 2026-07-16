import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Bot, GitCompareArrows, PanelRightOpen, Play, RefreshCw, Square, Workflow } from "lucide-react";
import ContextInspectorRail from "../../components/inspector/ContextInspectorRail";
import InlineApprovalCard from "../../components/approvals/InlineApprovalCard";
import RunComparison from "./RunComparison";
import type {
  HccControlPlaneData,
  HccMission,
} from "../../types/hcc";

type ControlTab = "missions" | "swarm" | "compare";

function ControlPlane(): React.JSX.Element {
  const [tab, setTab] = useState<ControlTab>("missions");
  const [data, setData] = useState<HccControlPlaneData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorMissionId, setInspectorMissionId] = useState<string | null>(null);
  const [goal, setGoal] = useState("");
  const [parallel, setParallel] = useState(3);
  const [supervised, setSupervised] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy("load");
    setError(null);
    try {
      const [jobsPayload, swarmPayload] = await Promise.all([
        window.hermesAPI.getHccConductorJobs(),
        window.hermesAPI.getHccSwarmOverview(),
      ]);
      const jobs = (jobsPayload as { jobs?: HccMission[] }).jobs ?? [];
      const next: HccControlPlaneData = {
        missions: jobs,
        swarm: swarmPayload as HccControlPlaneData["swarm"],
      };
      setData(next);
      setSelectedId((current) => current && jobs.some((job) => job.id === current) ? current : jobs[0]?.id ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Control Plane unavailable");
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(
    () => data?.missions.find((mission) => mission.id === selectedId) ?? null,
    [data, selectedId],
  );

  const startMission = async (): Promise<void> => {
    const trimmed = goal.trim();
    if (!trimmed) return;
    setBusy("spawn");
    setError(null);
    try {
      await window.hermesAPI.spawnHccConductor(trimmed, parallel, supervised);
      setGoal("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Mission failed to start");
    } finally {
      setBusy(null);
    }
  };

  const stopMission = async (mission: HccMission): Promise<void> => {
    if (!window.confirm(`Stop mission “${mission.name}”?`)) return;
    setBusy(`stop:${mission.id}`);
    try {
      await window.hermesAPI.stopHccConductor(mission.id);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Mission failed to stop");
    } finally {
      setBusy(null);
    }
  };

  const workers = data?.swarm.workers.workers ?? [];
  const runs = data?.swarm.runs.runs ?? [];
  const activeMissions = data?.missions.filter((mission) => ["running", "active"].includes(mission.status)).length ?? 0;

  return (
    <main className="control-plane-screen">
      <header className="control-plane-header">
        <div>
          <div className="control-plane-kicker">CONTROL PLANE</div>
          <h1>Conductor</h1>
          <p>Plan missions, inspect execution, and verify evidence.</p>
        </div>
        <button className="control-icon-button" onClick={() => void load()} disabled={busy === "load"} title="Refresh">
          <RefreshCw size={17} />
        </button>
      </header>

      <section className="control-status-strip" aria-label="Control plane status">
        <div><strong>{activeMissions}</strong><span>Active missions</span></div>
        <div><strong>{data?.missions.length ?? 0}</strong><span>Total missions</span></div>
        <div><strong>{workers.length}</strong><span>Workers</span></div>
        <div><strong>{data?.swarm.status.active_runs ?? 0}</strong><span>Active runs</span></div>
        <span className={`control-live-state ${data?.swarm.status.active ? "active" : "idle"}`}>
          {data?.swarm.status.status ?? "offline"}
        </span>
      </section>

      <nav className="control-tabs" aria-label="Control Plane sections">
        <button className={tab === "missions" ? "active" : ""} onClick={() => setTab("missions")}><Workflow size={16} />Missions</button>
        <button className={tab === "swarm" ? "active" : ""} onClick={() => setTab("swarm")}><Bot size={16} />Swarm</button>
        <button className={tab === "compare" ? "active" : ""} onClick={() => setTab("compare")}><GitCompareArrows size={16} />Compare</button>
      </nav>

      {error && <div className="control-error">{error}</div>}

      {tab === "missions" ? (
        <div className="control-mission-layout">
          <aside className="control-mission-list">
            <div className="control-section-title">Missions</div>
            {data?.missions.map((mission) => (
              <button key={mission.id} className={selectedId === mission.id ? "active" : ""} onClick={() => { setSelectedId(mission.id); setInspectorMissionId(null); }}>
                <span className={`mission-state state-${mission.status}`} />
                <span><strong>{mission.name}</strong><small>{mission.status} · {mission.workers.length} workers</small></span>
              </button>
            ))}
            {!data?.missions.length && <div className="control-empty">No missions recorded.</div>}
          </aside>

          <section className="control-mission-detail">
            <div className="control-launch-row">
              <input type="text" value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="What should the mission accomplish?" />
              <label>Workers<input type="number" min={1} max={12} value={parallel} onChange={(event) => setParallel(Number(event.target.value))} /></label>
              <label className="control-check"><input type="checkbox" checked={supervised} onChange={(event) => setSupervised(event.target.checked)} />Supervised</label>
              <button className="control-primary" disabled={!goal.trim() || busy === "spawn"} onClick={() => void startMission()}><Play size={15} />Start</button>
            </div>

            {selected ? (
              <div className="mission-detail-content">
                <div className="mission-detail-heading">
                  <div><span className={`mission-badge state-${selected.status}`}>{selected.status}</span><h2>{selected.name}</h2><p>{selected.goal || selected.description || "No goal recorded."}</p></div>
                  <div className="mission-actions">
                    <button onClick={() => setInspectorMissionId(selected.id)}><PanelRightOpen size={15} />Inspect context</button>
                    {["running", "active"].includes(selected.status) && <button className="danger" onClick={() => void stopMission(selected)}><Square size={14} />Stop</button>}
                  </div>
                </div>
                <dl className="mission-facts">
                  <div><dt>Mission ID</dt><dd>{selected.id}</dd></div>
                  <div><dt>Project</dt><dd>{selected.kanban_board || "Not linked"}</dd></div>
                  <div><dt>Workers</dt><dd>{selected.workers.join(", ") || "None"}</dd></div>
                </dl>
                <InlineApprovalCard missionId={selected.id} />

              </div>
            ) : <div className="control-empty large">Select a mission or start a new one.</div>}
          </section>
        </div>
      ) : tab === "swarm" ? (
        <div className="control-swarm-layout">
          <section><div className="control-section-title">Workers</div><div className="worker-table"><div className="table-head"><span>Worker</span><span>Role</span><span>Status</span><span>Current task</span></div>{workers.map((worker) => <div key={worker.id}><strong>{worker.profile || worker.id}</strong><span>{worker.role || "worker"}</span><span className={`worker-status state-${worker.status || "unknown"}`}>{worker.status || "unknown"}</span><span>{worker.current_task_id || "—"}</span></div>)}</div></section>
          <section><div className="control-section-title">Recent runs</div><div className="run-list">{runs.map((run) => <div key={run.id}><Activity size={15} /><span><strong>{run.task_title || run.id}</strong><small>{run.profile || "unassigned"}</small></span><em>{run.status || "unknown"}</em></div>)}{!runs.length && <div className="control-empty">No swarm runs.</div>}</div></section>
        </div>
      ) : (
        <RunComparison />
      )}

      {inspectorMissionId && (
        <ContextInspectorRail
          entityType="mission"
          entityId={inspectorMissionId}
          onClose={() => setInspectorMissionId(null)}
        />
      )}
    </main>
  );
}

export default ControlPlane;
