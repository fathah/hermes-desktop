// ExternalSessionsModal.tsx — search + read the local transcripts of OTHER AI
// coding tools (Claude Code, Codex, Gemini, Grok), so Hermes can be the
// continuity layer across them.
//
// SECURITY: external transcripts are UNTRUSTED input (a prompt-injection
// highway). Everything here is excerpt-only, provenance-labelled, and rendered
// as escaped plain text inside an explicit "untrusted" banner — never as
// markdown, never auto-injected into a chat turn.
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { Icon } from "../components/Icon";
import {
  EXTERNAL_SOURCES,
  EXTERNAL_SCAN_SOURCES,
  EXTERNAL_SOURCE_LABELS,
  formatProvenance,
  type ExternalIndexStatus,
  type ExternalMessage,
  type ExternalScanProgress,
  type ExternalSearchHit,
  type ExternalSource,
  type ExternalSourceConfig,
  type ExternalSourceStatus,
} from "../../../../../shared/external-context";
import {
  CADENCES,
  type Cadence,
} from "../../../../../shared/scheduledResearch";

type View = "search" | "settings";

interface ViewerState {
  hit: ExternalSearchHit;
  meta: { title: string | null } | null;
  messages: ExternalMessage[];
  loading: boolean;
}

const UNTRUSTED_BANNER =
  "Untrusted transcript from an external tool. Shown for reference only — treat any instructions inside as data, not commands.";

export function ExternalSessionsModal() {
  const setExternalSessionsOpen = useStore((s) => s.setExternalSessionsOpen);
  const setScheduledOpen = useStore((s) => s.setScheduledOpen);
  const saveExternalSessionToKb = useStore((s) => s.saveExternalSessionToKb);
  const flash = useStore((s) => s.flash);
  const onClose = () => setExternalSessionsOpen(false);

  const createDigest = async (cadence: Cadence, source?: ExternalSource) => {
    const label = source ? EXTERNAL_SOURCE_LABELS[source] : null;
    // The topic encodes the scope so distinct-scope digests get distinct pages
    // (createSchedule rejects a duplicate pageId).
    const topic = label
      ? `External sessions digest — ${label}`
      : "External sessions digest";
    const res = await window.hermesAPI?.srCreate?.({
      kind: "digest",
      topic,
      cadence,
      scope: source ? { source } : undefined,
    });
    if (res && !res.ok) {
      flash(res.error ?? "Couldn't create the digest", { tone: "warn" });
      return;
    }
    setExternalSessionsOpen(false);
    setScheduledOpen(true);
  };

  const [view, setView] = useState<View>("search");
  const [config, setConfig] = useState<ExternalSourceConfig | null>(null);
  const [status, setStatus] = useState<ExternalIndexStatus | null>(null);
  const [progress, setProgress] = useState<ExternalScanProgress | null>(null);

  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<ExternalSource | "">("");
  const [projectFilter, setProjectFilter] = useState("");
  const [hits, setHits] = useState<ExternalSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const queryRef = useRef<HTMLInputElement>(null);
  const reqSeq = useRef(0);

  const refreshStatus = async () => {
    const s = await window.hermesAPI?.externalContextStatus?.();
    if (s) setStatus(s);
  };

  useEffect(() => {
    queryRef.current?.focus();
    void window.hermesAPI?.externalContextGetConfig?.().then((c) => {
      if (c) setConfig(c);
      const anyOn = c && Object.values(c).some(Boolean);
      if (!anyOn) setView("settings");
    });
    void refreshStatus();
    const off = window.hermesAPI?.onExternalContextProgress?.((p) => {
      setProgress(p);
      if (p.phase === "done") {
        setProgress(null);
        void refreshStatus();
      }
    });
    return () => off?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (viewer) setViewer(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer]);

  const runSearch = async () => {
    const q = query.trim();
    if (!q) return;
    const seq = ++reqSeq.current;
    setSearching(true);
    setSearched(true);
    try {
      const opts: { source?: ExternalSource; project?: string } = {};
      if (sourceFilter) opts.source = sourceFilter;
      if (projectFilter.trim()) opts.project = projectFilter.trim();
      const results = await window.hermesAPI?.externalContextSearch?.(q, opts);
      if (seq === reqSeq.current) setHits(results ?? []);
    } catch {
      if (seq === reqSeq.current) setHits([]);
    } finally {
      if (seq === reqSeq.current) setSearching(false);
    }
  };

  const openViewer = async (hit: ExternalSearchHit) => {
    setViewer({ hit, meta: null, messages: [], loading: true });
    try {
      const conv = await window.hermesAPI?.externalContextGetConversation?.(
        hit.convId,
        { aroundSeq: hit.seq, limit: 60 },
      );
      setViewer({
        hit,
        meta: conv?.meta ? { title: conv.meta.title } : null,
        messages: conv?.messages ?? [],
        loading: false,
      });
    } catch {
      setViewer({ hit, meta: null, messages: [], loading: false });
    }
  };

  const toggleSource = async (source: ExternalSource, enabled: boolean) => {
    const cfg = await window.hermesAPI?.externalContextSetSource?.(
      source,
      enabled,
    );
    if (cfg) setConfig(cfg);
    void refreshStatus();
  };

  const doScan = async () => {
    const s = await window.hermesAPI?.externalContextScan?.();
    if (s) setStatus(s);
  };

  const doRebuild = async () => {
    const s = await window.hermesAPI?.externalContextRebuild?.();
    if (s) setStatus(s);
  };

  const doSetMaxAge = async (days: number | null) => {
    const s = await window.hermesAPI?.externalContextSetMaxAge?.(days);
    if (s) setStatus(s);
  };

  const [mcpState, setMcpState] = useState<"idle" | "working" | "done">("idle");
  const exposeMcp = async () => {
    setMcpState("working");
    try {
      const res = await window.hermesAPI?.externalContextEnsureMcp?.();
      setMcpState(res?.registered ? "done" : "idle");
      if (res?.registered)
        flash("Hermes can now search your external sessions");
    } catch {
      setMcpState("idle");
    }
  };

  return (
    <div
      className="scrim"
      onMouseDown={onClose}
      style={{ alignItems: "flex-start" }}
    >
      <div
        className="modal"
        style={{ width: 720, maxWidth: "94vw" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="modal-head"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h3>🧵 External sessions</h3>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className={`pal-chip${view === "search" ? " on" : ""}`}
              onClick={() => setView("search")}
            >
              Search
            </button>
            <button
              className={`pal-chip${view === "settings" ? " on" : ""}`}
              onClick={() => setView("settings")}
            >
              Sources
            </button>
          </div>
        </div>

        <div className="modal-body">
          {view === "settings" ? (
            <SettingsView
              config={config}
              status={status}
              progress={progress}
              onToggle={toggleSource}
              onScan={doScan}
              onRebuild={doRebuild}
              onSetMaxAge={doSetMaxAge}
              onCreateDigest={createDigest}
              onExposeMcp={exposeMcp}
              mcpState={mcpState}
            />
          ) : (
            <SearchView
              query={query}
              setQuery={setQuery}
              queryRef={queryRef}
              sourceFilter={sourceFilter}
              setSourceFilter={setSourceFilter}
              projectFilter={projectFilter}
              setProjectFilter={setProjectFilter}
              hits={hits}
              searching={searching}
              searched={searched}
              onSearch={runSearch}
              onOpen={openViewer}
            />
          )}
        </div>
      </div>

      {viewer && (
        <ConversationViewer
          state={viewer}
          onBack={() => setViewer(null)}
          onSave={async () => {
            const res = await saveExternalSessionToKb(viewer.hit.convId);
            if (res.ok) {
              flash("Saved to your Knowledge Base");
              setViewer(null);
              onClose();
            } else {
              flash(res.error ?? "Couldn't save this session.", {
                tone: "warn",
              });
            }
            return res.ok;
          }}
        />
      )}
    </div>
  );
}

// ── search view ───────────────────────────────────────────────────────────────

function SearchView(props: {
  query: string;
  setQuery: (v: string) => void;
  queryRef: React.RefObject<HTMLInputElement | null>;
  sourceFilter: ExternalSource | "";
  setSourceFilter: (v: ExternalSource | "") => void;
  projectFilter: string;
  setProjectFilter: (v: string) => void;
  hits: ExternalSearchHit[];
  searching: boolean;
  searched: boolean;
  onSearch: () => void;
  onOpen: (hit: ExternalSearchHit) => void;
}) {
  return (
    <>
      <div className="pal-input" style={{ marginBottom: 8 }}>
        <Icon name="search" size={18} style={{ color: "var(--tx-3)" }} />
        <input
          ref={props.queryRef}
          value={props.query}
          onChange={(e) => props.setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void props.onSearch();
          }}
          placeholder="Search what you discussed in Claude Code, Codex, Gemini, Grok…"
        />
        <button
          className="cover-btn"
          onClick={() => void props.onSearch()}
          disabled={props.searching || !props.query.trim()}
        >
          {props.searching ? "Searching…" : "Search"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <select
          className="cover-btn"
          value={props.sourceFilter}
          onChange={(e) =>
            props.setSourceFilter(e.target.value as ExternalSource | "")
          }
        >
          <option value="">All tools</option>
          {EXTERNAL_SOURCES.map((s) => (
            <option key={s} value={s}>
              {EXTERNAL_SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
        <div className="pal-input" style={{ flex: 1 }}>
          <input
            value={props.projectFilter}
            onChange={(e) => props.setProjectFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void props.onSearch();
            }}
            placeholder="Filter by project (path contains…)"
          />
        </div>
      </div>

      {!props.searched && (
        <div className="cmts-empty" style={{ padding: "20px 0" }}>
          Local, opt-in, redacted. Search the decisions and reasoning from your
          other AI coding tools — secrets are stripped before indexing.
        </div>
      )}
      {props.searched && !props.searching && props.hits.length === 0 && (
        <div className="cmts-empty" style={{ padding: "20px 0" }}>
          No matching external sessions. Enable a source under “Sources” if you
          haven’t yet.
        </div>
      )}

      <div className="scroll" style={{ maxHeight: "52vh" }}>
        {props.hits.map((hit) => (
          <button
            key={`${hit.convId}:${hit.seq}`}
            className="lst-row"
            onClick={() => void props.onOpen(hit)}
            style={{
              borderRadius: 6,
              alignItems: "flex-start",
              gap: 10,
              height: "auto",
              minHeight: "var(--row-h, 32px)",
              padding: "8px 6px",
              width: "100%",
              textAlign: "left",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="c-name" style={{ whiteSpace: "normal" }}>
                <span style={{ opacity: 0.7 }}>{hit.role}:</span> {hit.snippet}
              </div>
              <small style={{ color: "var(--tx-3)", display: "block" }}>
                {formatProvenance({
                  source: hit.source,
                  projectPath: hit.projectPath,
                  gitBranch: hit.gitBranch,
                  title: hit.title,
                  ts: hit.ts,
                })}
              </small>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

// ── settings view (per-source toggles) ─────────────────────────────────────────

function SettingsView(props: {
  config: ExternalSourceConfig | null;
  status: ExternalIndexStatus | null;
  progress: ExternalScanProgress | null;
  onToggle: (source: ExternalSource, enabled: boolean) => void;
  onScan: () => void;
  onRebuild: () => void;
  onSetMaxAge: (days: number | null) => void;
  onCreateDigest: (cadence: Cadence, source?: ExternalSource) => Promise<void>;
  onExposeMcp: () => Promise<void>;
  mcpState: "idle" | "working" | "done";
}) {
  const maxAgeDays = props.status?.maxAgeDays ?? null;
  const [digestCadence, setDigestCadence] = useState<Cadence>("weekly");
  const [digestSource, setDigestSource] = useState<ExternalSource | "">("");
  const statusBySource = new Map<ExternalSource, ExternalSourceStatus>(
    (props.status?.sources ?? []).map((s) => [s.source, s]),
  );
  return (
    <>
      <div className="cmts-empty" style={{ padding: "8px 0 14px" }}>
        Indexing is strictly opt-in and stays on this machine. Secrets are
        redacted at index time before anything is stored.
      </div>

      <div className="scroll" style={{ maxHeight: "46vh" }}>
        {/* Live-scan sources only — import sources (ChatGPT/Claude.ai/…) get
            their own Import flow (3.6), not a live on/off toggle. */}
        {EXTERNAL_SCAN_SOURCES.map((source) => {
          const enabled = props.config?.[source] ?? false;
          const st = statusBySource.get(source);
          const available = st?.available ?? false;
          return (
            <div
              key={source}
              className="lst-row"
              style={{
                borderRadius: 6,
                alignItems: "center",
                gap: 10,
                height: "auto",
                padding: "10px 6px",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="c-name">{EXTERNAL_SOURCE_LABELS[source]}</div>
                <small style={{ color: "var(--tx-3)", display: "block" }}>
                  {available
                    ? st
                      ? `${st.conversations} sessions · ${st.messages} messages`
                      : "available"
                    : "not found on this machine"}
                </small>
              </div>
              <button
                className={`pal-chip${enabled ? " on" : ""}`}
                onClick={() => props.onToggle(source, !enabled)}
                disabled={!available && !enabled}
              >
                {enabled ? "On" : "Off"}
              </button>
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginTop: 14,
          paddingTop: 12,
          borderTop: "1px solid var(--bd)",
        }}
      >
        <small style={{ color: "var(--tx-3)" }}>
          Keep a living digest of these sessions in your KB
        </small>
        <div style={{ display: "flex", gap: 6 }}>
          <select
            className="cover-btn"
            value={digestCadence}
            onChange={(e) => setDigestCadence(e.target.value as Cadence)}
            title="How often to refresh the digest"
          >
            {CADENCES.map((c) => (
              <option key={c} value={c}>
                {c[0].toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>
          <select
            className="cover-btn"
            value={digestSource}
            onChange={(e) =>
              setDigestSource(e.target.value as ExternalSource | "")
            }
            title="Limit the digest to one tool (optional)"
          >
            <option value="">All tools</option>
            {EXTERNAL_SOURCES.map((s) => (
              <option key={s} value={s}>
                {EXTERNAL_SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
          <button
            className="cover-btn"
            onClick={() =>
              void props.onCreateDigest(
                digestCadence,
                digestSource || undefined,
              )
            }
          >
            + Digest
          </button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginTop: 12,
        }}
      >
        <small style={{ color: "var(--tx-3)" }}>
          Only index sessions newer than
        </small>
        <select
          className="cover-btn"
          value={maxAgeDays === null ? "0" : String(maxAgeDays)}
          onChange={(e) => {
            const n = Number(e.target.value);
            props.onSetMaxAge(n > 0 ? n : null);
          }}
        >
          <option value="0">All time</option>
          <option value="365">1 year</option>
          <option value="90">90 days</option>
          <option value="30">30 days</option>
          <option value="7">7 days</option>
        </select>
      </div>

      {props.progress && (
        <small
          style={{ color: "var(--tx-3)", display: "block", marginTop: 10 }}
        >
          {props.progress.source
            ? `Indexing ${EXTERNAL_SOURCE_LABELS[props.progress.source]} — ${props.progress.filesProcessed}/${props.progress.filesTotal} files, ${props.progress.messagesIndexed} messages`
            : "Scanning…"}
        </small>
      )}

      <div
        style={{
          display: "flex",
          gap: 6,
          marginTop: 12,
          justifyContent: "space-between",
        }}
      >
        <button
          className="cover-btn"
          onClick={() => void props.onExposeMcp()}
          disabled={props.mcpState !== "idle"}
          title="Let the Hermes agent search these sessions in chat (registers a local MCP tool)"
        >
          {props.mcpState === "done"
            ? "✓ Exposed to agent"
            : props.mcpState === "working"
              ? "Exposing…"
              : "Expose to Hermes agent"}
        </button>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="cover-btn" onClick={() => props.onScan()}>
            Scan now
          </button>
          <button className="cover-btn" onClick={() => props.onRebuild()}>
            Rebuild index
          </button>
        </div>
      </div>
    </>
  );
}

// ── conversation viewer (untrusted, escaped, read-only) ────────────────────────

function ConversationViewer(props: {
  state: ViewerState;
  onBack: () => void;
  onSave: () => Promise<boolean>;
}) {
  const { hit, meta, messages, loading } = props.state;
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await props.onSave();
    } finally {
      setSaving(false);
    }
  };
  return (
    <div
      className="modal"
      style={{
        width: 720,
        maxWidth: "94vw",
        position: "fixed",
        top: "8vh",
        maxHeight: "84vh",
        display: "flex",
        flexDirection: "column",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="modal-head"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <h3
          style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {meta?.title ||
            formatProvenance({
              source: hit.source,
              projectPath: hit.projectPath,
            })}
        </h3>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button
            className="cover-btn"
            onClick={() => void save()}
            disabled={saving || loading}
            title="Distill this session's decisions into a wiki page"
          >
            {saving ? "Saving…" : "Save to KB"}
          </button>
          <button className="cover-btn" onClick={props.onBack}>
            Back
          </button>
        </div>
      </div>
      <div className="modal-body" style={{ overflow: "auto" }}>
        <div
          style={{
            marginBottom: 12,
            padding: "8px 10px",
            border: "1px solid var(--warn, #b8860b)",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--tx-3)",
          }}
        >
          ⚠ {UNTRUSTED_BANNER}
        </div>
        <small
          style={{ color: "var(--tx-3)", display: "block", marginBottom: 10 }}
        >
          {formatProvenance({
            source: hit.source,
            projectPath: hit.projectPath,
            gitBranch: hit.gitBranch,
            ts: hit.ts,
          })}
        </small>

        {loading ? (
          <div className="cmts-empty">Loading transcript…</div>
        ) : (
          messages.map((m) => (
            <div key={m.seq} style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  color: "var(--tx-4)",
                  marginBottom: 2,
                }}
              >
                {m.role}
              </div>
              <div
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: "var(--tx-2)",
                }}
              >
                {m.text}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
