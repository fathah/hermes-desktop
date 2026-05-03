import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Activity, Refresh, Pause, Play, Trash, Copy } from "../../assets/icons";

type LogChannel = "agent" | "gateway" | "errors";
const CHANNELS: LogChannel[] = ["agent", "gateway", "errors"];
const MAX_LINES = 5000;
const ERROR_RE = /\b(error|exception|traceback|warning|fail|failed|critical)\b/i;
const TS_RE = /^\[?(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:[+-]\d{2}:?\d{2})?)\]?\s+/;
const BRACKET_PREFIX_RE = /^\[(.*?)\]\s/;

interface ParsedLine {
  raw: string;
  level: "info" | "warn" | "error" | "debug" | null;
}

function classifyLevel(line: string): ParsedLine["level"] {
  if (/\b(ERROR|CRITICAL|Exception|Traceback)\b/.test(line)) return "error";
  if (/\b(WARN|WARNING)\b/i.test(line)) return "warn";
  if (/\bDEBUG\b/.test(line)) return "debug";
  if (/\bINFO\b/.test(line)) return "info";
  return null;
}

function colorForLevel(level: ParsedLine["level"]): string {
  switch (level) {
    case "error":
      return "#f87171";
    case "warn":
      return "#fbbf24";
    case "debug":
      return "#9ca3af";
    case "info":
      return "#cbd5e1";
    default:
      return "#cbd5e1";
  }
}

function clipBuffer(lines: string[]): string[] {
  if (lines.length <= MAX_LINES) return lines;
  return lines.slice(lines.length - MAX_LINES);
}

function Live(): React.JSX.Element {
  const [channel, setChannel] = useState<LogChannel>("agent");
  const [lines, setLines] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [loading, setLoading] = useState(true);

  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Append helper that respects pause
  const appendChunk = useCallback((chunk: string) => {
    if (pausedRef.current) return;
    const parts = chunk.split(/\r?\n/).filter((l) => l.length > 0);
    if (parts.length === 0) return;
    setLines((cur) => clipBuffer([...cur, ...parts]));
  }, []);

  // Load snapshot + subscribe whenever channel changes
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    setLoading(true);
    setLines([]);
    (async () => {
      const snapshot = await window.hermesAPI.readLogTail(channel, 65_536);
      if (cancelled) return;
      const parts = snapshot.split(/\r?\n/).filter((l) => l.length > 0);
      setLines(clipBuffer(parts));
      setLoading(false);
      const off = await window.hermesAPI.startLogTail(channel, appendChunk);
      if (cancelled) {
        off();
      } else {
        unsub = off;
      }
    })();
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [channel, appendChunk]);

  // Auto-scroll to bottom on new lines unless user scrolled up
  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, autoScroll]);

  // Detect manual scroll-up to disable autoScroll, scroll-to-bottom to re-enable
  function onScroll(): void {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
    setAutoScroll(atBottom);
  }

  function jumpToLatest(): void {
    setAutoScroll(true);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  function clearBuffer(): void {
    setLines([]);
  }

  async function refreshSnapshot(): Promise<void> {
    setLoading(true);
    const snapshot = await window.hermesAPI.readLogTail(channel, 65_536);
    const parts = snapshot.split(/\r?\n/).filter((l) => l.length > 0);
    setLines(clipBuffer(parts));
    setLoading(false);
  }

  async function copyAll(): Promise<void> {
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
    } catch {
      // noop — clipboard may not be available in some contexts
    }
  }

  const filteredLines = useMemo(() => {
    const lc = filter.trim().toLowerCase();
    return lines.filter((l) => {
      if (lc && !l.toLowerCase().includes(lc)) return false;
      if (errorsOnly && !ERROR_RE.test(l)) return false;
      return true;
    });
  }, [lines, filter, errorsOnly]);

  return (
    <div
      className="settings-container"
      style={{ display: "flex", flexDirection: "column", height: "100%" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h1 className="settings-header" style={{ margin: 0 }}>
          <Activity
            size={20}
            style={{ verticalAlign: "-3px", marginRight: 8 }}
          />
          Live log
        </h1>
        <div style={{ display: "flex", gap: 6 }}>
          {CHANNELS.map((c) => (
            <button
              key={c}
              onClick={() => setChannel(c)}
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                border: "1px solid var(--border, #2a2a2a)",
                background: c === channel ? "#d97757" : "rgba(255,255,255,0.04)",
                color: c === channel ? "#1c1410" : "var(--text, #ddd)",
                fontWeight: c === channel ? 700 : 500,
                fontSize: 12,
                fontFamily: "monospace",
                cursor: "pointer",
              }}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <input
          className="input"
          type="text"
          placeholder="filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: "1 1 220px", minWidth: 180 }}
        />
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: "var(--muted, #888)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={errorsOnly}
            onChange={(e) => setErrorsOnly(e.target.checked)}
          />
          Errors only
        </label>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setPaused((p) => !p)}
          title={paused ? "Resume tail" : "Pause tail"}
        >
          {paused ? (
            <>
              <Play size={14} /> Resume
            </>
          ) : (
            <>
              <Pause size={14} /> Pause
            </>
          )}
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={clearBuffer}
          title="Clear local buffer"
        >
          <Trash size={14} /> Clear
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={copyAll}
          title="Copy all visible lines"
        >
          <Copy size={14} /> Copy
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={refreshSnapshot}
          title="Reload last 64 KB"
        >
          <Refresh size={14} /> Reload
        </button>
        <span
          className="settings-field-hint"
          style={{ marginLeft: "auto", fontSize: 11, fontFamily: "monospace" }}
        >
          {filteredLines.length}/{lines.length} · {channel} · {paused ? "PAUSED" : "LIVE"}
        </span>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{
          flex: 1,
          minHeight: 320,
          background: "#050407",
          border: "1px solid var(--border, #2a2a2a)",
          borderRadius: 8,
          padding: "10px 12px",
          overflow: "auto",
          fontFamily: "JetBrains Mono, ui-monospace, Menlo, monospace",
          fontSize: 12,
          lineHeight: 1.5,
          color: "#cbd5e1",
          position: "relative",
        }}
      >
        {loading && lines.length === 0 ? (
          <div className="settings-field-hint">Loading…</div>
        ) : filteredLines.length === 0 ? (
          <div className="settings-field-hint">
            {lines.length === 0
              ? "No log content yet."
              : "No lines match your filter."}
          </div>
        ) : (
          filteredLines.map((line, i) => (
            <LogLine key={i} line={line} />
          ))
        )}
        {!autoScroll && (
          <button
            onClick={jumpToLatest}
            style={{
              position: "sticky",
              bottom: 6,
              left: "50%",
              transform: "translateX(-50%)",
              display: "block",
              padding: "6px 14px",
              borderRadius: 999,
              border: "1px solid rgba(217,119,87,.5)",
              background: "rgba(217,119,87,.18)",
              color: "#d97757",
              fontFamily: "monospace",
              fontSize: 12,
              cursor: "pointer",
              backdropFilter: "blur(6px)",
            }}
          >
            ↓ Jump to latest
          </button>
        )}
      </div>
    </div>
  );
}

function LogLine({ line }: { line: string }): React.JSX.Element {
  const level = classifyLevel(line);
  const color = colorForLevel(level);

  // Extract a leading timestamp or [Bracket] prefix to dim it
  let prefix = "";
  let body = line;
  const tsMatch = line.match(TS_RE);
  if (tsMatch) {
    prefix = tsMatch[0];
    body = line.slice(prefix.length);
  } else {
    const brMatch = line.match(BRACKET_PREFIX_RE);
    if (brMatch) {
      prefix = brMatch[0];
      body = line.slice(prefix.length);
    }
  }

  return (
    <div style={{ whiteSpace: "pre-wrap", color }}>
      {prefix && (
        <span style={{ color: "#6b7280" }}>{prefix}</span>
      )}
      <span>{body}</span>
    </div>
  );
}

export default Live;
