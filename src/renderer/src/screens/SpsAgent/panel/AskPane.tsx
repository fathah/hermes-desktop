// AskPane.tsx — the Personal-Agent "Ask" surface (Phase 3 / Notion's personal
// agent pattern). A conversational ask that searches across SPS pages AND past
// Hermes conversations, returning a cited answer. Distinct from the right-panel
// doc-editing Assistant: this one is for "find/ask across my workspace".
import { useState } from "react";
import { useStore } from "../store";
import { Icon } from "../components/Icon";
import { searchWorkspacePages, type PageHit } from "../lib/ask";
import type { SearchSummary } from "../../../../../shared/searchSummary";

export function AskPane() {
  const docs = useStore((s) => s.docs);
  const meta = useStore((s) => s.meta);
  const selectPage = useStore((s) => s.selectPage);
  const setSurface = useStore((s) => s.setSurface);

  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<SearchSummary | null>(null);
  const [pageHits, setPageHits] = useState<PageHit[]>([]);

  const run = async (): Promise<void> => {
    const q = query.trim();
    if (!q) return;
    setAsked(q);
    setPageHits(searchWorkspacePages(q, docs, meta));
    setSummary(null);
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

  const openPage = (pageId: string): void => {
    selectPage(pageId);
    setSurface("doc");
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
          placeholder="Ask across your pages and past conversations…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className="ask-send"
          type="submit"
          disabled={loading || !query.trim()}
        >
          {loading ? "…" : "Ask"}
        </button>
      </form>

      {asked && (
        <div className="ask-results">
          {loading && (
            <div className="ask-muted">Searching your workspace…</div>
          )}

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

          {summary && !summary.summary && !summary.error && !loading && (
            <div className="ask-muted">No matching past conversations.</div>
          )}

          {pageHits.length > 0 && (
            <div className="ask-pages">
              <div className="ask-sec">From your pages</div>
              {pageHits.map((h) => (
                <button
                  key={h.pageId}
                  className="ask-page"
                  onClick={() => openPage(h.pageId)}
                >
                  <span className="ask-page-title">{h.title}</span>
                  <span className="ask-page-snippet">{h.snippet}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
