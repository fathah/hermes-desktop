import { useEffect, useState, useCallback } from "react";
import { Refresh, Lightbulb } from "../../assets/icons";

interface ReasoningEntry {
  id: number;
  sessionId: string;
  source: string;
  model: string | null;
  timestamp: number;
  reasoning: string;
  reasoningTokens: number;
  preview: string;
}

interface Stats {
  totalEntries: number;
  totalTokens: number;
  byModel: Array<{ model: string; entries: number; tokens: number }>;
}

function timeAgo(ts: number | null): string {
  if (!ts) return "";
  const now = Date.now() / 1000;
  // timestamp can be unix seconds or ms — normalize
  const t = ts > 1e12 ? ts / 1000 : ts;
  const diff = Math.floor(now - t);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function Reasoning(): React.JSX.Element {
  const [entries, setEntries] = useState<ReasoningEntry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [items, s] = await Promise.all([
        window.hermesAPI.listReasoning(80, 0),
        window.hermesAPI.reasoningStats(),
      ]);
      setEntries(items);
      setStats(s);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="settings-container">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <h1 className="settings-header" style={{ margin: 0 }}>
          <Lightbulb
            size={20}
            style={{ verticalAlign: "-3px", marginRight: 8 }}
          />
          Reasoning
        </h1>
        <button className="btn btn-secondary btn-sm" onClick={load}>
          <Refresh size={14} /> Refresh
        </button>
      </div>

      {stats && (
        <div className="settings-section">
          <div className="settings-section-title">Overview</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 14,
              marginBottom: 14,
            }}
          >
            <StatCard
              label="Total reasoning entries"
              value={fmtNum(stats.totalEntries)}
            />
            <StatCard
              label="Reasoning tokens (all-time)"
              value={fmtNum(stats.totalTokens)}
            />
            <StatCard
              label="Models with reasoning"
              value={String(stats.byModel.length)}
            />
          </div>
          {stats.byModel.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "minmax(180px, 1fr) 80px 100px",
                gap: 10,
                fontSize: 13,
              }}
            >
              <div className="settings-field-hint">Model</div>
              <div className="settings-field-hint" style={{ textAlign: "right" }}>
                Sessions
              </div>
              <div className="settings-field-hint" style={{ textAlign: "right" }}>
                Tokens
              </div>
              {stats.byModel.map((m) => (
                <Row3
                  key={m.model}
                  a={m.model}
                  b={fmtNum(m.entries)}
                  c={fmtNum(m.tokens)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="settings-section">
        <div className="settings-section-title">
          Latest reasoning traces ({entries.length})
        </div>
        {loading && entries.length === 0 ? (
          <div className="settings-field-hint">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="settings-field-hint">
            No reasoning traces yet. Models that emit thinking tokens (Claude
            with extended thinking, OpenAI o-series, etc.) will appear here.
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {entries.map((e) => (
              <div
                key={e.id}
                style={{
                  border: "1px solid var(--border, #2a2a2a)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  background:
                    "rgba(255,255,255,0.02)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: 12,
                    color: "var(--muted, #888)",
                    marginBottom: 6,
                    cursor: "pointer",
                  }}
                  onClick={() =>
                    setOpenId((cur) => (cur === e.id ? null : e.id))
                  }
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span
                      style={{
                        fontFamily: "monospace",
                        background: "rgba(217,119,87,0.12)",
                        padding: "2px 8px",
                        borderRadius: 999,
                        color: "#d97757",
                      }}
                    >
                      {e.model || "?"}
                    </span>
                    <span>{e.source}</span>
                    <span>· {timeAgo(e.timestamp)}</span>
                  </div>
                  <span style={{ fontFamily: "monospace" }}>
                    {fmtNum(e.reasoningTokens)} tok
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 14,
                    lineHeight: 1.55,
                    color: "var(--text, #ddd)",
                    fontFamily: openId === e.id ? "monospace" : undefined,
                    whiteSpace: openId === e.id ? "pre-wrap" : "normal",
                  }}
                >
                  {openId === e.id ? e.reasoning : e.preview}
                  {openId !== e.id && e.reasoning.length > e.preview.length
                    ? "…"
                    : ""}
                </div>
              </div>
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
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Row3({
  a,
  b,
  c,
}: {
  a: string;
  b: string;
  c: string;
}): React.JSX.Element {
  return (
    <>
      <div style={{ fontFamily: "monospace", fontSize: 13 }}>{a}</div>
      <div style={{ textAlign: "right", fontSize: 13 }}>{b}</div>
      <div style={{ textAlign: "right", fontSize: 13, color: "#d97757" }}>
        {c}
      </div>
    </>
  );
}

export default Reasoning;
