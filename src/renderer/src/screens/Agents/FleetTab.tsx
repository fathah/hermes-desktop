/** Phase 6B — Fleet All Agents Tab.
 *  Consumes FleetSnapshot via useFleetSnapshot hook.
 *  Desktop MUST NOT re-compute online/idle/offline, working, error,
 *  24h recency, agent assignment, or today stats.
 */
import React from "react";
import StatusDot from "../../components/StatusDot";
import type { FleetSnapshot, FleetAgentStatus } from "../../../../shared/types/fleet";

interface FleetTabProps {
  snapshot: FleetSnapshot | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  onRefresh: () => void;
}

function relativeTime(iso: string): string {
  const delta = (Date.now() - new Date(iso).getTime()) / 1000;
  if (delta < 60) return "just now";
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

function costDisplay(cost: number | null): string {
  if (cost === null) return "$—";
  if (cost === 0) return "$0.00";
  return `$${cost.toFixed(2)}`;
}

function sortAgents(agents: FleetAgentStatus[]): FleetAgentStatus[] {
  const order = { online: 0, idle: 1, offline: 2 } as const;
  return [...agents].sort((a, b) =>
    order[a.status] - order[b.status] || a.fleet_agent_id.localeCompare(b.fleet_agent_id)
  );
}

function FleetTab({ snapshot, loading, error, stale, onRefresh }: FleetTabProps): React.JSX.Element {
  if (loading) {
    return <div className="fleet-loading">Loading fleet status…</div>;
  }
  if (error && !snapshot) {
    return (
      <div className="fleet-error">
        <p>Fleet data unavailable</p>
        <p className="fleet-error-detail">{error}</p>
        <button onClick={onRefresh}>Retry</button>
      </div>
    );
  }
  if (!snapshot) {
    return (
      <div className="fleet-empty">
        <p>No managed agents configured.</p>
        <p className="fleet-hint">Add agents in managed-agents.yaml</p>
      </div>
    );
  }

  const agents = sortAgents(snapshot.agents);
  const s = snapshot.summary;

  return (
    <div className="fleet-tab">
      {stale && (
        <div className="fleet-stale-banner">
          Data may be stale — last updated {snapshot.observed_at ? relativeTime(snapshot.observed_at) : "unknown"}
        </div>
      )}
      {snapshot.diagnostics.length > 0 && (
        <div className="fleet-diag-banner">
          {snapshot.diagnostics.map((d, i) => (
            <span key={i} title={d.message}>[{d.code}]</span>
          ))}
        </div>
      )}

      <table className="fleet-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Agent</th>
            <th>Role</th>
            <th>Tasks</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.fleet_agent_id}>
              <td>
                <StatusDot
                  status={a.status}
                  working={a.working}
                  error={a.error}
                  diagnostics={a.diagnostics.length}
                />
              </td>
              <td className="fleet-agent-name">{a.display_name}</td>
              <td className="fleet-agent-role">{a.role}</td>
              <td className="fleet-agent-tasks">{a.today_task_count}</td>
              <td className="fleet-agent-cost">{costDisplay(a.today_cost_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {(snapshot.unassigned.unassigned_delegate_runs > 0 ||
        snapshot.unassigned.unassigned_kanban_assignees.length > 0) && (
        <div className="fleet-unassigned">
          <strong>Unassigned:</strong>{" "}
          {snapshot.unassigned.unassigned_delegate_runs > 0 && (
            <span>{snapshot.unassigned.unassigned_delegate_runs} delegate runs</span>
          )}
          {snapshot.unassigned.unassigned_kanban_assignees.length > 0 && (
            <span>
              {" "}{snapshot.unassigned.unassigned_kanban_assignees.join(", ")}
            </span>
          )}
        </div>
      )}

      <div className="fleet-footer">
        <span>● {s.online} online</span>
        <span>◉ {s.idle} idle</span>
        <span>○ {s.offline} offline</span>
        {s.working > 0 && <span>⚡ {s.working} working</span>}
        {s.error > 0 && <span>✕ {s.error} error</span>}
        <span className="fleet-updated">Updated: {snapshot.observed_at ? relativeTime(snapshot.observed_at) : "unknown"}</span>
        <button onClick={onRefresh} className="fleet-refresh-btn" title="Refresh">↻</button>
      </div>
    </div>
  );
}

export default FleetTab;
