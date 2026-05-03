import { useEffect, useState, useCallback, useMemo } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { Refresh, BarChart3 } from "../../assets/icons";

interface DailyTokens {
  day: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  sessions: number;
  cost: number;
}

interface BySource {
  source: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

interface BudgetTotals {
  windowDays: number;
  totalSessions: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalReasoningTokens: number;
  totalCost: number;
  cacheHitRatio: number;
}

const WINDOWS = [7, 30, 90] as const;
type Window = (typeof WINDOWS)[number];

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function fmtUSD(n: number): string {
  return `$${n.toFixed(2)}`;
}

function shortDay(day: string): string {
  // YYYY-MM-DD → MM-DD
  return day.length >= 10 ? day.slice(5) : day;
}

function Analytics(): React.JSX.Element {
  const [days, setDays] = useState<Window>(30);
  const [daily, setDaily] = useState<DailyTokens[]>([]);
  const [sources, setSources] = useState<BySource[]>([]);
  const [totals, setTotals] = useState<BudgetTotals | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, s, t] = await Promise.all([
        window.hermesAPI.dailyTokens(days),
        window.hermesAPI.bySource(),
        window.hermesAPI.budgetTotals(days),
      ]);
      setDaily(d);
      setSources(s);
      setTotals(t);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto refresh every 30s
  useEffect(() => {
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const chartData = useMemo(
    () =>
      daily.map((d) => ({
        day: shortDay(d.day),
        input: d.inputTokens,
        output: d.outputTokens,
        cacheR: d.cacheReadTokens,
        cost: d.cost,
      })),
    [daily],
  );

  const sortedSources = useMemo(
    () => [...sources].sort((a, b) => b.sessions - a.sessions),
    [sources],
  );

  return (
    <div className="settings-container">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h1 className="settings-header" style={{ margin: 0 }}>
          <BarChart3
            size={20}
            style={{ verticalAlign: "-3px", marginRight: 8 }}
          />
          Analytics
        </h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setDays(w)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  border: "1px solid var(--border, #2a2a2a)",
                  background:
                    w === days ? "#d97757" : "rgba(255,255,255,0.04)",
                  color: w === days ? "#1c1410" : "var(--text, #ddd)",
                  fontWeight: w === days ? 700 : 500,
                  fontSize: 12,
                  fontFamily: "monospace",
                  cursor: "pointer",
                }}
              >
                {w}d
              </button>
            ))}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={load}>
            <Refresh size={14} /> Refresh
          </button>
        </div>
      </div>

      {totals && (
        <div className="settings-section">
          <div className="settings-section-title">
            Window: last {totals.windowDays} day{totals.windowDays > 1 ? "s" : ""}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 14,
            }}
          >
            <StatCard label="Sessions" value={fmtNum(totals.totalSessions)} />
            <StatCard
              label="Input tokens"
              value={fmtNum(totals.totalInputTokens)}
            />
            <StatCard
              label="Output tokens"
              value={fmtNum(totals.totalOutputTokens)}
            />
            <StatCard label="Cost (USD)" value={fmtUSD(totals.totalCost)} />
          </div>
        </div>
      )}

      <div className="settings-section">
        <div className="settings-section-title">Tokens per day</div>
        {loading && chartData.length === 0 ? (
          <div className="settings-field-hint">Loading…</div>
        ) : chartData.length === 0 ? (
          <div className="settings-field-hint">No data in this window.</div>
        ) : (
          <div style={{ height: 280 }}>
            <ResponsiveContainer>
              <AreaChart
                data={chartData}
                margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d97757" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="#d97757" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#c084fc" stopOpacity={0.55} />
                    <stop offset="100%" stopColor="#c084fc" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gCache" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34d399" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#2a2438" strokeDasharray="3 3" />
                <XAxis dataKey="day" stroke="#7a7468" fontSize={11} />
                <YAxis
                  stroke="#7a7468"
                  fontSize={11}
                  tickFormatter={(v: number) => fmtNum(v)}
                />
                <Tooltip
                  contentStyle={{
                    background: "#14111f",
                    border: "1px solid #2a2438",
                    borderRadius: 8,
                    color: "#efe9e1",
                    fontSize: 12,
                  }}
                  formatter={(v) => fmtNum(Number(v ?? 0))}
                />
                <Legend
                  wrapperStyle={{ fontSize: 12, color: "#b8b0a4" }}
                />
                <Area
                  type="monotone"
                  dataKey="input"
                  name="Input"
                  stroke="#d97757"
                  fill="url(#gIn)"
                  strokeWidth={1.5}
                />
                <Area
                  type="monotone"
                  dataKey="output"
                  name="Output"
                  stroke="#c084fc"
                  fill="url(#gOut)"
                  strokeWidth={1.5}
                />
                <Area
                  type="monotone"
                  dataKey="cacheR"
                  name="Cache read"
                  stroke="#34d399"
                  fill="url(#gCache)"
                  strokeWidth={1.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Cost per day</div>
        {chartData.length === 0 ? (
          <div className="settings-field-hint">No data.</div>
        ) : (
          <div style={{ height: 200 }}>
            <ResponsiveContainer>
              <BarChart
                data={chartData}
                margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
              >
                <CartesianGrid stroke="#2a2438" strokeDasharray="3 3" />
                <XAxis dataKey="day" stroke="#7a7468" fontSize={11} />
                <YAxis
                  stroke="#7a7468"
                  fontSize={11}
                  tickFormatter={(v: number) => fmtUSD(v)}
                />
                <Tooltip
                  contentStyle={{
                    background: "#14111f",
                    border: "1px solid #2a2438",
                    borderRadius: 8,
                    color: "#efe9e1",
                    fontSize: 12,
                  }}
                  formatter={(v) => fmtUSD(Number(v ?? 0))}
                />
                <Bar
                  dataKey="cost"
                  fill="#d97757"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-section-title">By source</div>
        {sortedSources.length === 0 ? (
          <div className="settings-field-hint">No sessions yet.</div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "minmax(140px, 1fr) 90px 110px 100px",
              gap: 10,
              fontSize: 13,
            }}
          >
            <div className="settings-field-hint">Source</div>
            <div className="settings-field-hint" style={{ textAlign: "right" }}>
              Sessions
            </div>
            <div className="settings-field-hint" style={{ textAlign: "right" }}>
              Output tok
            </div>
            <div className="settings-field-hint" style={{ textAlign: "right" }}>
              Cost
            </div>
            {sortedSources.map((s) => (
              <Row4
                key={s.source}
                a={s.source}
                b={fmtNum(s.sessions)}
                c={fmtNum(s.outputTokens)}
                d={fmtUSD(s.cost)}
              />
            ))}
          </div>
        )}
      </div>
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
    <div
      style={{
        border: "1px solid var(--border, #2a2a2a)",
        borderRadius: 10,
        padding: "12px 14px",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "var(--muted, #888)",
          textTransform: "uppercase",
          letterSpacing: ".1em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          marginTop: 6,
          color: "#d97757",
          fontFamily: "monospace",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Row4({
  a,
  b,
  c,
  d,
}: {
  a: string;
  b: string;
  c: string;
  d: string;
}): React.JSX.Element {
  return (
    <>
      <div style={{ fontFamily: "monospace", fontSize: 13 }}>{a}</div>
      <div
        style={{
          textAlign: "right",
          fontSize: 13,
          fontFamily: "monospace",
        }}
      >
        {b}
      </div>
      <div
        style={{
          textAlign: "right",
          fontSize: 13,
          fontFamily: "monospace",
        }}
      >
        {c}
      </div>
      <div
        style={{
          textAlign: "right",
          fontSize: 13,
          color: "#d97757",
          fontFamily: "monospace",
        }}
      >
        {d}
      </div>
    </>
  );
}

export default Analytics;
