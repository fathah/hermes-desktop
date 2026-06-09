// ResearchModal.tsx — research ANY topic and file it into the Knowledge Base.
//
// Primary mode ("Any topic"): the user types any subject; the Hermes agent
// researches it on the live web (streaming, tool-using turn via runResearch),
// then a synthesized, cited page is auto-committed into the wiki (Wiki/) with a
// one-click Undo. Citations are mandatory — a sourceless result is treated as
// "no web access" and is NOT saved (it would otherwise pollute the KB with
// unverified synthesis).
//
// Secondary mode ("Academic papers"): the original OpenAlex scholarly search —
// type a topic, pick a paper, and Hermes saves a plain-language summary under
// Sources/Research. Preserved so the scholar workflow doesn't regress.
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { Icon } from "../components/Icon";
import { research, type WorkSummary } from "../research";

type Mode = "research" | "papers";
type Phase = "idle" | "running" | "done" | "warn" | "error";

export function ResearchModal() {
  const setResearchOpen = useStore((s) => s.setResearchOpen);
  const importResearchWork = useStore((s) => s.importResearchWork);
  const runResearch = useStore((s) => s.runResearch);
  const flash = useStore((s) => s.flash);
  const onClose = () => setResearchOpen(false);

  const [mode, setMode] = useState<Mode>("research");

  // ── general topic research ──
  const [topic, setTopic] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(""); // streamed markdown preview
  const [toolNote, setToolNote] = useState<string | null>(null);
  const [resultSummary, setResultSummary] = useState("");
  const [resultMsg, setResultMsg] = useState(""); // warn / error text
  const undoRef = useRef<null | (() => void)>(null);
  const topicRef = useRef<HTMLInputElement>(null);

  // ── web-tool preflight (the load-bearing capability) ──
  // null = unknown (don't block); true/false = known state.
  const [webEnabled, setWebEnabled] = useState<boolean | null>(null);
  const [enabling, setEnabling] = useState(false);

  // ── OpenAlex paper search (secondary "Academic papers" mode) ──
  const [q, setQ] = useState("");
  const [results, setResults] = useState<WorkSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mailto, setMailto] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);
  // Guards against an earlier slow search overwriting a later one.
  const reqSeq = useRef(0);

  useEffect(() => {
    topicRef.current?.focus();
    // Make OpenAlex callable by the Hermes agent (idempotent) — it's one of the
    // sources the research turn can use.
    void window.hermesAPI?.spsResearchEnsureAgentTool?.();
    // Preflight: is the `web` toolset enabled? If the call fails or the toolset
    // is unknown, don't block (treat as enabled) — the no-sources guard still
    // catches a genuinely web-less run after the fact.
    void window.hermesAPI
      ?.getToolsets?.()
      .then((ts) => {
        const web = ts?.find((t) => t.key === "web");
        setWebEnabled(web ? web.enabled : true);
      })
      .catch(() => setWebEnabled(true));
    // OpenAlex polite-pool / api-key config (key never round-trips — only a flag).
    void window.hermesAPI?.spsResearchGetConfig?.().then((cfg) => {
      if (!cfg) return;
      setMailto(cfg.mailto || "");
      setHasApiKey(!!cfg.hasApiKey);
    });
  }, []);

  // Global Escape closes the modal regardless of focus, unless a research run is
  // in flight (don't yank the modal out from under a streaming run).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "running") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const enableWeb = async () => {
    setEnabling(true);
    try {
      await window.hermesAPI?.setToolsetEnabled?.("web", true);
      // browser too — richer page fetching for the same research turn.
      await window.hermesAPI?.setToolsetEnabled?.("browser", true);
      setWebEnabled(true);
    } finally {
      setEnabling(false);
    }
  };

  const doResearch = async () => {
    const t = topic.trim();
    if (!t || phase === "running") return;
    setPhase("running");
    setProgress("");
    setToolNote(null);
    setResultMsg("");
    setResultSummary("");
    undoRef.current = null;
    const res = await runResearch(t, {
      onChunk: (md) => setProgress(md),
      onTool: (tool) => setToolNote(tool),
    });
    if (res.ok) {
      setPhase("done");
      setResultSummary(res.summary || t);
      undoRef.current = res.undo ?? null;
      flash("Saved to your Knowledge Base");
    } else if (res.error === "no-sources" || res.error === "no-result") {
      setPhase("warn");
      setResultMsg(
        "The agent couldn't gather web sources for this topic, so nothing was saved. " +
          "Check that a web-search-capable provider is configured for the gateway, then try again.",
      );
    } else {
      setPhase("error");
      setResultMsg(res.error || "Research failed.");
    }
  };

  const undo = () => {
    undoRef.current?.();
    undoRef.current = null;
    setPhase("idle");
    setProgress("");
    setResultSummary("");
    flash("Removed from Knowledge Base");
  };

  const resetResearch = () => {
    setPhase("idle");
    setProgress("");
    setToolNote(null);
    setResultMsg("");
    setResultSummary("");
    undoRef.current = null;
  };

  const saveConfig = async () => {
    setSavingCfg(true);
    try {
      const apiKeyArg = apiKeyInput.trim() ? apiKeyInput.trim() : undefined;
      const cfg = await window.hermesAPI?.spsResearchSetConfig?.(
        mailto.trim(),
        apiKeyArg,
      );
      if (cfg) {
        setMailto(cfg.mailto || "");
        setHasApiKey(!!cfg.hasApiKey);
      }
      setApiKeyInput("");
      setSettingsOpen(false);
    } finally {
      setSavingCfg(false);
    }
  };

  const runSearch = async () => {
    const query = q.trim();
    if (!query) return;
    const seq = ++reqSeq.current;
    setLoading(true);
    setSearched(true);
    try {
      const hits = await research.searchWorks(query, { perPage: 20 });
      if (seq === reqSeq.current) setResults(hits);
    } catch {
      if (seq === reqSeq.current) setResults([]);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  };

  const savePaper = async (w: WorkSummary) => {
    setSavingId(w.id);
    try {
      const detail = await research.getWork(w.id);
      await importResearchWork(detail);
      onClose();
    } finally {
      setSavingId(null);
    }
  };

  const busy = phase === "running";

  return (
    <div
      className="scrim"
      onMouseDown={() => phase !== "running" && onClose()}
      style={{ alignItems: "flex-start" }}
    >
      <div
        className="modal"
        style={{ width: 640, maxWidth: "92vw" }}
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
          <h3>🔬 Research</h3>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className={`pal-chip${mode === "research" ? " on" : ""}`}
              onClick={() => setMode("research")}
              disabled={busy}
            >
              Any topic
            </button>
            <button
              className={`pal-chip${mode === "papers" ? " on" : ""}`}
              onClick={() => setMode("papers")}
              disabled={busy}
            >
              Academic papers
            </button>
          </div>
        </div>

        <div className="modal-body">
          {mode === "research" ? (
            <>
              {webEnabled === false && (
                <div
                  style={{
                    marginBottom: 12,
                    padding: 12,
                    border: "1px solid var(--bd)",
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <small style={{ color: "var(--tx-3)" }}>
                    Web research is off. Enable the agent&apos;s web tools to
                    research live topics.
                  </small>
                  <button
                    className="cover-btn"
                    onClick={() => void enableWeb()}
                    disabled={enabling}
                    style={{ flexShrink: 0 }}
                  >
                    {enabling ? "Enabling…" : "Enable web research"}
                  </button>
                </div>
              )}

              <div className="pal-input" style={{ marginBottom: 12 }}>
                <Icon
                  name="search"
                  size={18}
                  style={{ color: "var(--tx-3)" }}
                />
                <input
                  ref={topicRef}
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void doResearch();
                  }}
                  placeholder="Research any topic — a market, a regulation, a vendor, “how do I…”"
                  disabled={busy}
                />
                <button
                  className="cover-btn"
                  onClick={() => void doResearch()}
                  disabled={busy || !topic.trim() || webEnabled === false}
                >
                  {busy ? "Researching…" : "Research"}
                </button>
              </div>

              {phase === "idle" && (
                <div className="cmts-empty" style={{ padding: "20px 0" }}>
                  Hermes researches the topic on the live web, then saves a
                  synthesized, cited page into your Knowledge Base — with one
                  click to undo.
                </div>
              )}

              {(busy || (phase !== "idle" && !!progress)) && (
                <>
                  {busy && (
                    <small
                      style={{
                        color: "var(--tx-3)",
                        display: "block",
                        marginBottom: 6,
                      }}
                    >
                      {toolNote
                        ? `Researching · ${toolNote}…`
                        : "Researching the web…"}
                    </small>
                  )}
                  {!!progress && (
                    <div
                      className="scroll"
                      style={{
                        maxHeight: "40vh",
                        whiteSpace: "pre-wrap",
                        fontSize: 13,
                        lineHeight: 1.5,
                        color: "var(--tx-2)",
                        border: "1px solid var(--bd)",
                        borderRadius: 8,
                        padding: 12,
                      }}
                    >
                      {progress}
                    </div>
                  )}
                </>
              )}

              {phase === "done" && (
                <div
                  style={{
                    marginTop: 12,
                    padding: 12,
                    border: "1px solid var(--bd)",
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div className="c-name">✓ Saved to your Knowledge Base</div>
                    {resultSummary && (
                      <small style={{ color: "var(--tx-3)", display: "block" }}>
                        {resultSummary}
                      </small>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button className="cover-btn" onClick={() => undo()}>
                      Undo
                    </button>
                    <button className="cover-btn" onClick={onClose}>
                      Open
                    </button>
                  </div>
                </div>
              )}

              {(phase === "warn" || phase === "error") && (
                <div
                  style={{
                    marginTop: 12,
                    padding: 12,
                    border: "1px solid var(--bd)",
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <small style={{ color: "var(--tx-3)" }}>{resultMsg}</small>
                  <button
                    className="cover-btn"
                    onClick={resetResearch}
                    style={{ flexShrink: 0 }}
                  >
                    Try again
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  marginBottom: 8,
                }}
              >
                <button
                  className="cover-btn"
                  onClick={() => setSettingsOpen((v) => !v)}
                  title="Polite pool email & API key"
                >
                  ⚙ Settings
                </button>
              </div>

              {settingsOpen && (
                <div
                  style={{
                    marginBottom: 12,
                    padding: 12,
                    border: "1px solid var(--bd)",
                    borderRadius: 8,
                    display: "grid",
                    gap: 10,
                  }}
                >
                  <label style={{ fontSize: 12, color: "var(--tx-3)" }}>
                    Contact email — opts into OpenAlex&apos;s faster “polite
                    pool”
                    <div className="pal-input" style={{ marginTop: 4 }}>
                      <input
                        type="email"
                        value={mailto}
                        onChange={(e) => setMailto(e.target.value)}
                        placeholder="you@example.com"
                      />
                    </div>
                  </label>
                  <label style={{ fontSize: 12, color: "var(--tx-3)" }}>
                    API key (optional) — raises the free daily allowance
                    <div className="pal-input" style={{ marginTop: 4 }}>
                      <input
                        type="password"
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        placeholder={
                          hasApiKey
                            ? "•••••••• set — leave blank to keep"
                            : "OpenAlex API key"
                        }
                      />
                    </div>
                  </label>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      className="cover-btn"
                      onClick={() => void saveConfig()}
                      disabled={savingCfg}
                    >
                      {savingCfg ? "Saving…" : "Save"}
                    </button>
                  </div>
                  <small style={{ color: "var(--tx-4)", fontSize: 11 }}>
                    Stored locally on this machine. Both are optional — search
                    works without them.
                  </small>
                </div>
              )}

              <div className="pal-input" style={{ marginBottom: 12 }}>
                <Icon
                  name="search"
                  size={18}
                  style={{ color: "var(--tx-3)" }}
                />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void runSearch();
                  }}
                  placeholder="Search OpenAlex — topic, title, author…"
                />
                <button
                  className="cover-btn"
                  onClick={() => void runSearch()}
                  disabled={loading || !q.trim()}
                >
                  {loading ? "Searching…" : "Search"}
                </button>
              </div>

              {!searched && (
                <div className="cmts-empty" style={{ padding: "20px 0" }}>
                  Search the open catalog of 250M+ scholarly works. Pick a paper
                  and Hermes saves a plain-language summary into your workspace.
                </div>
              )}
              {searched && !loading && results.length === 0 && (
                <div className="cmts-empty" style={{ padding: "20px 0" }}>
                  No papers found for “{q}”.
                </div>
              )}

              <div className="scroll" style={{ maxHeight: "52vh" }}>
                {results.map((w) => (
                  <div
                    key={w.id}
                    className="lst-row"
                    style={{
                      borderRadius: 6,
                      alignItems: "flex-start",
                      gap: 10,
                      height: "auto",
                      minHeight: "var(--row-h, 32px)",
                      padding: "8px 6px",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="c-name" style={{ whiteSpace: "normal" }}>
                        {w.title}
                      </div>
                      <small style={{ color: "var(--tx-3)", display: "block" }}>
                        {formatByline(w)}
                      </small>
                    </div>
                    {w.isOA && (
                      <span
                        className="pal-chip on"
                        style={{ pointerEvents: "none" }}
                      >
                        OA
                      </span>
                    )}
                    <button
                      className="cover-btn"
                      onClick={() => void savePaper(w)}
                      disabled={savingId !== null}
                    >
                      {savingId === w.id ? "Saving…" : "Save"}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** "Authors (3 + et al.) · Year · Venue · N citations" */
function formatByline(w: WorkSummary): string {
  const names = w.authors.slice(0, 3).join(", ");
  const authors = w.authors.length > 3 ? `${names} et al.` : names;
  const citations = `${w.citedByCount} citation${w.citedByCount === 1 ? "" : "s"}`;
  return [authors, w.year ? String(w.year) : null, w.venue, citations]
    .filter(Boolean)
    .join(" · ");
}
