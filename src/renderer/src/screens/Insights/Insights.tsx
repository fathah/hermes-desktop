import { useEffect, useState } from "react";
import {
  type UsageAggregate,
  type RunLedgerEntry,
  toDaySeries,
  topModels,
  formatCost,
} from "../../../../shared/usage";

const RUN_CAP = 25;

function runLabel(entry: RunLedgerEntry): string {
  if (entry.title && entry.title.trim()) return entry.title.trim();
  return `Session ${entry.sessionId.slice(0, 8)}`;
}

function runDate(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/**
 * Usage / cost analytics dashboard (idea A2). Read-only view over the
 * desktop-owned usage store (captured from the live `chat-usage` SSE signal —
 * the gateway's state.db has no cost columns). Totals, per-day spend, and a
 * per-model breakdown. All aggregation is pure + shared (`shared/usage`).
 */
function Insights({
  profile,
  visible,
}: {
  profile: string;
  visible?: boolean;
}): React.JSX.Element {
  const [stats, setStats] = useState<UsageAggregate | null>(null);
  const [ledger, setLedger] = useState<RunLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      window.hermesAPI.getUsageStats(profile),
      window.hermesAPI.getRunLedger(profile),
    ])
      .then(([s, runs]) => {
        if (!cancelled) {
          setStats(s);
          setLedger(runs);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStats(null);
          setLedger([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile, visible]);

  const days = stats ? toDaySeries(stats.byDay) : [];
  const models = stats ? topModels(stats.byModel) : [];
  const maxDayCost = days.reduce((m, d) => Math.max(m, d.totals.cost), 0);
  const hasData = !!stats && stats.totals.turns > 0;

  return (
    <div className="insights-screen">
      <header className="insights-header">
        <h1>Insights</h1>
        <p className="insights-subtitle">
          Token usage and cost for this profile, captured per turn.
        </p>
      </header>

      {loading ? (
        <div className="insights-empty">Loading…</div>
      ) : !hasData ? (
        <div className="insights-empty">
          No usage recorded yet. Costs appear here after you chat with the
          agent.
        </div>
      ) : (
        <div className="insights-body">
          <section className="insights-cards">
            <StatCard
              label="Total cost"
              value={formatCost(stats!.totals.cost)}
            />
            <StatCard
              label="Turns"
              value={stats!.totals.turns.toLocaleString()}
            />
            <StatCard
              label="Total tokens"
              value={stats!.totals.totalTokens.toLocaleString()}
            />
            <StatCard
              label="Cache hit ratio"
              value={
                stats!.cacheHitRatio === undefined
                  ? "—"
                  : `${Math.round(stats!.cacheHitRatio * 100)}%`
              }
            />
          </section>

          <section className="insights-section">
            <h2>Cost by day</h2>
            <div className="insights-daybars">
              {days.map(({ day, totals }) => (
                <div key={day} className="insights-daybar-row">
                  <span className="insights-daybar-label">{day}</span>
                  <span className="insights-daybar-track">
                    <span
                      className="insights-daybar-fill"
                      style={{
                        width:
                          maxDayCost > 0
                            ? `${Math.max(2, (totals.cost / maxDayCost) * 100)}%`
                            : "0%",
                      }}
                    />
                  </span>
                  <span className="insights-daybar-value">
                    {formatCost(totals.cost)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="insights-section">
            <h2>By model</h2>
            <table className="insights-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Turns</th>
                  <th>Tokens</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {models.map(({ model, totals }) => (
                  <tr key={model}>
                    <td className="insights-model-name">{model}</td>
                    <td>{totals.turns.toLocaleString()}</td>
                    <td>{totals.totalTokens.toLocaleString()}</td>
                    <td>{formatCost(totals.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {ledger.length > 0 && (
            <section className="insights-section">
              <h2>Recent runs</h2>
              <table className="insights-table">
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Last active</th>
                    <th>Model</th>
                    <th>Turns</th>
                    <th>Tokens</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.slice(0, RUN_CAP).map((run) => (
                    <tr key={run.sessionId}>
                      <td>{runLabel(run)}</td>
                      <td>{runDate(run.lastTs)}</td>
                      <td className="insights-model-name">
                        {run.models.join(", ") || "—"}
                      </td>
                      <td>{run.turns.toLocaleString()}</td>
                      <td>{run.totalTokens.toLocaleString()}</td>
                      <td>{formatCost(run.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ledger.length > RUN_CAP && (
                <p className="insights-subtitle">
                  Showing the {RUN_CAP} most recent of {ledger.length} runs.
                </p>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="insights-card">
      <div className="insights-card-value">{value}</div>
      <div className="insights-card-label">{label}</div>
    </div>
  );
}

export default Insights;
