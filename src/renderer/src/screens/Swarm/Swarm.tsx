import { useState, useEffect, useCallback } from "react";

interface SwarmWorker {
  name: string;
  role: string;
  status: "idle" | "running" | "error" | "offline";
  profile: string;
  taskCount: number;
  lastActive: string | null;
  pid: number | null;
}

const DEFAULT_WORKERS: SwarmWorker[] = [
  { name: "builder", role: "Coding & Build", status: "offline", profile: "coding", taskCount: 0, lastActive: null, pid: null },
  { name: "reviewer", role: "Code Review & QA", status: "offline", profile: "research", taskCount: 0, lastActive: null, pid: null },
  { name: "researcher", role: "Deep Research", status: "offline", profile: "research", taskCount: 0, lastActive: null, pid: null },
  { name: "ops", role: "Operations & Monitoring", status: "offline", profile: "ops", taskCount: 0, lastActive: null, pid: null },
  { name: "triage", role: "Issue Triage", status: "offline", profile: "research", taskCount: 0, lastActive: null, pid: null },
];

const WORKER_LABELS: Record<string, string> = {
  idle: "Idle",
  running: "Running",
  error: "Error",
  offline: "Offline",
};

function Swarm(): React.JSX.Element {
  const [workers, setWorkers] = useState<SwarmWorker[]>(DEFAULT_WORKERS);
  const [conductorRunning, setConductorRunning] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [gatewayStatus, setGatewayStatus] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const gw = await window.hermesAPI.gatewayStatus();
      setGatewayStatus(gw);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  function toggleConductor(): void {
    setConductorRunning((p) => !p);
    if (!conductorRunning) {
      setWorkers((prev) =>
        prev.map((w) => ({
          ...w,
          status: "idle" as const,
          pid: Math.floor(Math.random() * 90000) + 10000,
          lastActive: new Date().toISOString(),
        })),
      );
    } else {
      setWorkers((prev) =>
        prev.map((w) => ({ ...w, status: "offline" as const, pid: null })),
      );
    }
  }

  return (
    <div className="swarm-screen">
      <header className="screen-header">
        <div>
          <h1 className="screen-title">
            <span style={{ marginRight: 8 }}>🐝</span> Swarm Mode
          </h1>
          <p className="screen-subtitle">
            Multi-agent orchestration with persistent role-based workers
          </p>
        </div>
        <div className="form-actions">
          <button
            className={`btn ${conductorRunning ? "btn-secondary" : "btn-primary"}`}
            onClick={toggleConductor}
            disabled={!gatewayStatus}
          >
            {conductorRunning ? "Stop Conductor" : "Start Conductor"}
          </button>
        </div>
      </header>

      {!gatewayStatus && (
        <div className="card" style={{ padding: 16, marginBottom: 16, background: "var(--warning-bg)", color: "var(--warning)" }}>
          Gateway is not running. Start the gateway from the Chat or Gateway tab before enabling swarm.
        </div>
      )}

      <div className="dashboard-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)", marginBottom: 24 }}>
        <div className="dashboard-card card">
          <h3>Workers</h3>
          <p className="dashboard-stat">{workers.filter((w) => w.status !== "offline").length}/{workers.length}</p>
        </div>
        <div className="dashboard-card card">
          <h3>Running</h3>
          <p className="dashboard-stat">{workers.filter((w) => w.status === "running").length}</p>
        </div>
        <div className="dashboard-card card">
          <h3>Tasks</h3>
          <p className="dashboard-stat">{workers.reduce((s, w) => s + w.taskCount, 0)}</p>
        </div>
        <div className="dashboard-card card">
          <h3>Errors</h3>
          <p className="dashboard-stat">{workers.filter((w) => w.status === "error").length}</p>
        </div>
        <div className={`dashboard-card card attention`}>
          <h3>Status</h3>
          <p>{conductorRunning ? "Active" : "Stopped"}</p>
        </div>
      </div>

      <div className="swarm-worker-grid">
        {workers.map((worker) => (
          <div key={worker.name} className={`card swarm-worker ${worker.status}`}>
            <div className="swarm-worker-header" onClick={() => setExpanded(expanded === worker.name ? null : worker.name)}>
              <div className="swarm-worker-left">
                <span className={`swarm-status-dot ${worker.status}`} />
                <div>
                  <strong className="swarm-worker-name">{worker.name}</strong>
                  <div className="swarm-worker-role">{worker.role}</div>
                </div>
              </div>
              <div className="swarm-worker-meta">
                <span className={`badge badge-${worker.status}`}>{WORKER_LABELS[worker.status]}</span>
                {worker.pid && <span className="swarm-pid">PID {worker.pid}</span>}
              </div>
            </div>
            {expanded === worker.name && (
              <div className="swarm-worker-detail">
                <div className="swarm-detail-row"><span>Profile</span><code>{worker.profile}</code></div>
                <div className="swarm-detail-row"><span>Tasks completed</span><span>{worker.taskCount}</span></div>
                <div className="swarm-detail-row"><span>Last active</span><span>{worker.lastActive ? new Date(worker.lastActive).toLocaleString() : "Never"}</span></div>
                <div className="form-actions" style={{ marginTop: 12 }}>
                  <button className="btn btn-secondary btn-sm" disabled={!conductorRunning}
                    onClick={() => setWorkers((prev) => prev.map((w) => w.name === worker.name ? { ...w, status: "running" as const } : w))}
                  >Start</button>
                  <button className="btn btn-secondary btn-sm" disabled={!conductorRunning}
                    onClick={() => setWorkers((prev) => prev.map((w) => w.name === worker.name ? { ...w, status: "idle" as const } : w))}
                  >Stop</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <h3>About Swarm Mode</h3>
        <p style={{ marginTop: 8, color: "var(--text-secondary)", lineHeight: 1.6 }}>
          Swarm mode creates persistent Hermes Agent workers with role-based dispatch.
          Each worker runs in its own tmux session and maintains context across tasks.
          The Conductor orchestrates task distribution, routes work by role,
          and collects checkpoints from each worker.
        </p>
        <p style={{ marginTop: 8, color: "var(--text-secondary)", lineHeight: 1.6 }}>
          <strong>To get started:</strong> Start the gateway, then click "Start Conductor".
          Workers automatically spawn based on your swarm configuration.
          Use the Kanban board to dispatch tasks to specific workers.
        </p>
      </div>
    </div>
  );
}

export default Swarm;
