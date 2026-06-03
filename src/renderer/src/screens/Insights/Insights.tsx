import { useEffect, useState } from "react";
import {
  type UsageAggregate,
  toDaySeries,
  topModels,
  formatCost,
} from "../../../../shared/usage";

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    window.hermesAPI
      .getUsageStats(profile)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
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
