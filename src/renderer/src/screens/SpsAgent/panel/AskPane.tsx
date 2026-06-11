// AskPane.tsx — the Personal-Agent "Ask" surface (Phase 3 / Notion's personal
// agent pattern). One query that reaches ALL the user's knowledge at once: a
// best-effort LLM "Answer" (over past Hermes conversations) PLUS a ranked,
// clickable FEDERATED result list across vault notes, imported external
// transcripts, and Hermes sessions (P4). Distinct from the right-panel
// doc-editing Assistant: this one is for "find/ask across my workspace".
import { useState } from "react";
import { useStore } from "../store";
import { Icon } from "../components/Icon";
import type { SearchSummary } from "../../../../../shared/searchSummary";
import type { FederatedHit } from "../../../../../shared/federated-search";
import { EXTERNAL_SOURCE_LABELS } from "../../../../../shared/external-context";

/** Vault page id from a note-index relative path (`projects/foo.md` → `foo`). */
function noteIdFromPath(path: string): string {
  const last = path.split("/").pop() ?? path;
  return last.replace(/\.md$/, "");
}

function kindLabel(hit: FederatedHit): string {
  if (hit.kind === "note") return "Note";
  if (hit.kind === "session") return "Session";
  return EXTERNAL_SOURCE_LABELS[hit.source];
}

export function AskPane() {
  const selectPage = useStore((s) => s.selectPage);
  const setSurface = useStore((s) => s.setSurface);
  const setActiveChatSession = useStore((s) => s.setActiveChatSession);
  const openExternalConversation = useStore((s) => s.openExternalConversation);

  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [summary, setSummary] = useState<SearchSummary | null>(null);
  const [hits, setHits] = useState<FederatedHit[]>([]);

  const run = async (): Promise<void> => {
    const q = query.trim();
    if (!q) return;
    setAsked(q);
    setSummary(null);
    setHits([]);

    // Federated search is fully local — it must render even if the gateway (and
    // thus the LLM "Answer") is unreachable. Fire both independently.
    setSearching(true);
    void window.hermesAPI
      .federatedSearch(q)
      .then(setHits)
      .catch(() => setHits([]))
      .finally(() => setSearching(false));

    setLoading(true);
    try {
      setSummary(await window.hermesAPI.summarizeSearch(q));
    } catch {
      setSummary({
        summary: "",
        sources: [],
        error: "Couldn't reach the assistant.",
      });
    } finally {
      setLoading(false);
    }
  };

  const openHit = (hit: FederatedHit): void => {
    if (hit.kind === "note") {
      selectPage(noteIdFromPath(hit.ref.path));
      setSurface("doc");
      return;
    }
    if (hit.kind === "session") {
      setActiveChatSession(hit.ref.sessionId, hit.title);
      setSurface("chats");
      return;
    }
    openExternalConversation({
      convId: hit.ref.convId,
      seq: hit.ref.seq,
      source: hit.source,
      title: hit.title,
      projectPath: hit.ref.projectPath,
      gitBranch: hit.ref.gitBranch,
    });
  };

  const hitKey = (hit: FederatedHit): string => {
    if (hit.kind === "note") return `note:${hit.ref.path}`;
    if (hit.kind === "session") return `session:${hit.ref.sessionId}`;
    return `transcript:${hit.ref.convId}:${hit.ref.seq}`;
  };

  return (
    <div className="ask-pane">
      <div className="ask-head">
        <Icon name="sparkle" size={18} />
        <span>Ask your workspace</span>
      </div>
      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <input
          className="ask-input"
          placeholder="Search pages, transcripts, and past conversations…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className="ask-send"
          type="submit"
          disabled={loading || searching || !query.trim()}
        >
          {loading || searching ? "…" : "Ask"}
        </button>
      </form>

      {asked && (
        <div className="ask-results">
          {loading && <div className="ask-muted">Asking the assistant…</div>}

          {summary?.error && <div className="ask-error">{summary.error}</div>}

          {summary?.summary && (
            <div className="ask-answer">
              <p className="ask-answer-text">{summary.summary}</p>
              {summary.sources.length > 0 && (
                <div className="ask-sources">
                  {summary.sources.map((s, i) => (
                    <span key={`${s.sessionId}-${i}`} className="ask-source">
                      [{i + 1}] {s.title || `Session ${s.sessionId.slice(-6)}`}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="ask-pages">
            <div className="ask-sec">Across everything</div>
            {searching && <div className="ask-muted">Searching…</div>}
            {!searching && hits.length === 0 && (
              <div className="ask-muted">No matches found.</div>
            )}
            {hits.map((hit) => (
              <button
                key={hitKey(hit)}
                className="ask-page"
                onClick={() => openHit(hit)}
              >
                <span className="ask-hit-head">
                  <span className={`ask-chip ask-chip-${hit.kind}`}>
                    {kindLabel(hit)}
                  </span>
                  <span className="ask-page-title">{hit.title}</span>
                </span>
                <span className="ask-page-snippet">{hit.snippet}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
