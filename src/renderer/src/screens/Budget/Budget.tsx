import { useEffect, useMemo, useState, useCallback } from "react";
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import { Refresh, Wallet, Alert, Download } from "../../assets/icons";

interface BudgetByModel {
  model: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  cost: number;
  pricingKnown: boolean;
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
const LIMIT_KEY = "hermes-desktop:budget:monthly-limit";

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function fmtUSD(n: number): string {
  return `$${n.toFixed(2)}`;
}

// Lerp clay (#d97757) → purple (#c084fc) based on 0..1
function colorFromCost(ratio: number): string {
  const r = Math.round(0xd9 + (0xc0 - 0xd9) * ratio);
  const g = Math.round(0x77 + (0x84 - 0x77) * ratio);
  const b = Math.round(0x57 + (0xfc - 0x57) * ratio);
  const hex = (n: number): string => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCSV(rows: BudgetByModel[]): void {
  const header = [
    "model",
    "sessions",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "reasoning_tokens",
    "cost_usd",
    "pricing_known",
  ];
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [
        r.model,
        r.sessions,
        r.inputTokens,
        r.outputTokens,
        r.cacheReadTokens,
        r.cacheWriteTokens,
        r.reasoningTokens,
        r.cost.toFixed(4),
        r.pricingKnown ? "yes" : "no",
      ]
        .map(csvEscape)
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hermes-budget-by-model-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function Budget(): React.JSX.Element {
  const [days, setDays] = useState<Window>(30);
  const [models, setModels] = useState<BudgetByModel[]>([]);
  const [totals, setTotals] = useState<BudgetTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState<number>(() => {
    const v = localStorage.getItem(LIMIT_KEY);
    return v ? Number(v) : 0;
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, t] = await Promise.all([
        window.hermesAPI.budgetByModel(days),
        window.hermesAPI.budgetTotals(days),
      ]);
      setModels(m);
      setTotals(t);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto refresh every 60s
  useEffect(() => {
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  function persistLimit(n: number): void {
    setLimit(n);
    if (n > 0) localStorage.setItem(LIMIT_KEY, String(n));
    else localStorage.removeItem(LIMIT_KEY);
  }

  const sortedModels = useMemo(
    () =>
      [...models].sort((a, b) => {
        if (b.cost !== a.cost) return b.cost - a.cost;
        return (
          b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens)
        );
      }),
    [models],
  );

  const chartModels = useMemo(
    () => sortedModels.filter((m) => m.cost > 0),
    [sortedModels],
  );

  const maxCost = chartModels[0]?.cost ?? 0;
  const chartData = chartModels.map((m, i, arr) => ({
    model: m.model,
    cost: m.cost,
    fill: colorFromCost(arr.length > 1 ? i / (arr.length - 1) : 0),
  }));

  const limitState: "ok" | "warn" | "over" = !limit
    ? "ok"
    : totals && totals.totalCost >= limit
      ? "over"
      : totals && totals.totalCost >= 0.8 * limit
        ? "warn"
        : "ok";

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
          <Wallet
            size={20}
            style={{ verticalAlign: "-3px", marginRight: 8 }}
          />
          Budget
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
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => downloadCSV(sortedModels)}
            disabled={!sortedModels.length}
          >
            <Download size={14} /> CSV
          </button>
          <button className="btn btn-secondary btn-sm" onClick={load}>
            <Refresh size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Monthly limit + status banner */}
      <div className="settings-section">
        <div className="settings-section-title">Monthly limit</div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <input
            className="input"
            type="number"
            min={0}
            step={1}
            value={limit || ""}
            placeholder="e.g. 50"
            onChange={(e) => persistLimit(Number(e.target.value) || 0)}
            style={{ width: 160 }}
          />
          <span className="settings-field-hint">USD across all models · stored locally</span>
        </div>
        {limitState === "over" && totals && (
          <div
            style={{
              marginTop: 12,
              padding: "10px 14px",
              borderRadius: 10,
              background: "rgba(248,113,113,.12)",
              border: "1px solid rgba(248,113,113,.4)",
              color: "#fecaca",
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 14,
            }}
          >
            <Alert size={16} />
            <span>
              Over budget — {fmtUSD(totals.totalCost)} / {fmtUSD(limit)} on the
              last {totals.windowDays} day window.
            </span>
          </div>
        )}
        {limitState === "warn" && totals && (
          <div
            style={{
              marginTop: 12,
              padding: "10px 14px",
              borderRadius: 10,
              background: "rgba(251,191,36,.12)",
              border: "1px solid rgba(251,191,36,.4)",
              color: "#fde68a",
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 14,
            }}
          >
            <Alert size={16} />
            <span>
              Heads up — {fmtUSD(totals.totalCost)} of {fmtUSD(limit)} used (
              {Math.round((totals.totalCost / limit) * 100)}%).
            </span>
          </div>
        )}
      </div>

      {/* KPI cards */}
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
            <StatCard
              label="Total cost"
              value={fmtUSD(totals.totalCost)}
              accent
            />
            <StatCard label="Sessions" value={fmtNum(totals.totalSessions)} />
            <StatCard
              label="Tokens (in + out)"
              value={fmtNum(totals.totalInputTokens + totals.totalOutputTokens)}
            />
            <StatCard
              label="Cache hit ratio"
              value={`${(totals.cacheHitRatio * 100).toFixed(1)}%`}
            />
          </div>
        </div>
      )}

      {/* Cost by model bar chart */}
      <div className="settings-section">
        <div className="settings-section-title">Cost by model</div>
        {loading && chartData.length === 0 ? (
          <div className="settings-field-hint">Loading…</div>
        ) : chartData.length === 0 ? (
          <div className="settings-field-hint">
            No metered cost in this window — only open-weights models or no traffic.
          </div>
        ) : (
          <div
            style={{
              height: Math.max(200, chartData.length * 28 + 40),
            }}
          >
            <ResponsiveContainer>
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 8, right: 16, left: 12, bottom: 0 }}
              >
                <CartesianGrid stroke="#2a2438" strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  stroke="#7a7468"
                  fontSize={11}
                  tickFormatter={(v: number) => fmtUSD(v)}
                />
                <YAxis
                  type="category"
                  dataKey="model"
                  stroke="#b8b0a4"
                  fontSize={12}
                  width={170}
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
                <Bar dataKey="cost" radius={[0, 6, 6, 0]}>
                  {chartData.map((d, i) => (
                    <Cell key={d.model + i} fill={d.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div
              className="settings-field-hint"
              style={{ fontSize: 11, marginTop: 4 }}
            >
              max model cost · {fmtUSD(maxCost)}
            </div>
          </div>
        )}
      </div>

      {/* Detailed model table */}
      <div className="settings-section">
        <div className="settings-section-title">
          Per-model breakdown ({sortedModels.length})
        </div>
        {sortedModels.length === 0 ? (
          <div className="settings-field-hint">No sessions in this window.</div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "minmax(180px, 1.2fr) 70px 90px 90px 90px 90px 90px 100px",
              gap: 8,
              fontSize: 13,
            }}
          >
            <H>Model</H>
            <H right>Sess.</H>
            <H right>In</H>
            <H right>Out</H>
            <H right>Cache R</H>
            <H right>Cache W</H>
            <H right>Reason.</H>
            <H right>Cost</H>
            {sortedModels.map((m) => (
              <ModelRow key={m.model} m={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function H({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: boolean;
}): React.JSX.Element {
  return (
    <div
      className="settings-field-hint"
      style={{ textAlign: right ? "right" : "left", fontSize: 11 }}
    >
      {children}
    </div>
  );
}

function ModelRow({ m }: { m: BudgetByModel }): React.JSX.Element {
  const mono: React.CSSProperties = {
    fontFamily: "monospace",
    fontSize: 13,
    textAlign: "right",
  };
  return (
    <>
      <div style={{ fontFamily: "monospace", fontSize: 13 }}>{m.model}</div>
      <div style={mono}>{fmtNum(m.sessions)}</div>
      <div style={mono}>{fmtNum(m.inputTokens)}</div>
      <div style={mono}>{fmtNum(m.outputTokens)}</div>
      <div style={mono}>{fmtNum(m.cacheReadTokens)}</div>
      <div style={mono}>{fmtNum(m.cacheWriteTokens)}</div>
      <div style={mono}>{fmtNum(m.reasoningTokens)}</div>
      <div
        style={{
          ...mono,
          color: m.pricingKnown ? "#d97757" : "var(--muted, #888)",
        }}
      >
        {m.pricingKnown ? (
          fmtUSD(m.cost)
        ) : (
          <span
            style={{
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid var(--border, #2a2a2a)",
              color: "var(--muted, #888)",
            }}
          >
            open weights
          </span>
        )}
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}): React.JSX.Element {
  return (
    <div
      style={{
        border: accent
          ? "1px solid rgba(217,119,87,.45)"
          : "1px solid var(--border, #2a2a2a)",
        borderRadius: 10,
        padding: "12px 14px",
        background: accent
          ? "rgba(217,119,87,.08)"
          : "rgba(255,255,255,0.02)",
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

export default Budget;
