// ResearchModal.tsx — search OpenAlex for scholarly papers and save any result
// as a curated, plain-language page under Sources/Research. The "demystify"
// surface: the user types a topic, picks a paper, and Hermes writes a readable
// summary (TL;DR + abstract + citations + open-access PDF + topic tags) — they
// never touch raw OpenAlex JSON.
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { Icon } from "../components/Icon";
import { research, type WorkSummary } from "../research";

export function ResearchModal() {
  const setResearchOpen = useStore((s) => s.setResearchOpen);
  const importResearchWork = useStore((s) => s.importResearchWork);
  const onClose = () => setResearchOpen(false);

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
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards against an earlier slow search overwriting a later one.
  const reqSeq = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
    // Best-effort: make OpenAlex callable by the Hermes agent in chat the first
    // time the user opens Research (idempotent; the gateway loads it on restart).
    void window.hermesAPI?.spsResearchEnsureAgentTool?.();
    // Load the current polite-pool / api-key config (the key is never returned —
    // only whether one is set, mirroring the connection-config pattern).
    void window.hermesAPI?.spsResearchGetConfig?.().then((cfg) => {
      if (!cfg) return;
      setMailto(cfg.mailto || "");
      setHasApiKey(!!cfg.hasApiKey);
    });
  }, []);

  const saveConfig = async () => {
    setSavingCfg(true);
    try {
      // Blank api-key field = keep the existing key (pass undefined); a typed
      // value replaces it. The stored key never round-trips to the renderer.
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

  // Global Escape closes the modal regardless of where focus is (the input may
  // have lost focus to a result button), so the scrim never gets stuck open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const save = async (w: WorkSummary) => {
    setSavingId(w.id);
    try {
      // Search returns summaries; fetch the full record (abstract, references)
      // before writing the curated page.
      const detail = await research.getWork(w.id);
      await importResearchWork(detail);
      onClose();
    } finally {
      setSavingId(null);
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
          <h3>📚 Research papers</h3>
          <button
            className="cover-btn"
            onClick={() => setSettingsOpen((v) => !v)}
            title="Polite pool email & API key"
          >
            ⚙ Settings
          </button>
        </div>
        <div className="modal-body">
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
                Contact email — opts into OpenAlex&apos;s faster “polite pool”
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
                Stored locally on this machine. Both are optional — search works
                without them.
              </small>
            </div>
          )}

          <div className="pal-input" style={{ marginBottom: 12 }}>
            <Icon name="search" size={18} style={{ color: "var(--tx-3)" }} />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runSearch();
                else if (e.key === "Escape") onClose();
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
              Search the open catalog of 250M+ scholarly works. Pick a paper and
              Hermes saves a plain-language summary into your workspace.
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
                  onClick={() => void save(w)}
                  disabled={savingId !== null}
                >
                  {savingId === w.id ? "Saving…" : "Save"}
                </button>
              </div>
            ))}
          </div>
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
