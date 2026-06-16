import { useEffect, useMemo, useState } from "react";
import type {
  SourceIntakeResult,
  SourceIntakeStatus,
} from "../../../../../shared/source-intake";
import { Icon } from "../components/Icon";
import { SubstackRadarPanel } from "./SubstackRadarPanel";

type SourceTab = "find" | "add" | "review";

interface SourceIntakePanelProps {
  onFeedsChanged?: () => Promise<void> | void;
}

function isFeedResult(result: SourceIntakeResult | null): boolean {
  return result?.ok === true && result.engine === "rss";
}

function feedCategory(result: SourceIntakeResult): string {
  return result.canonicalUrl.includes("substack.com") ? "Substack" : "Sources";
}

export function SourceIntakePanel({
  onFeedsChanged,
}: SourceIntakePanelProps): React.JSX.Element {
  const [tab, setTab] = useState<SourceTab>("add");
  const [status, setStatus] = useState<SourceIntakeStatus | null>(null);
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<SourceIntakeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [setup, setSetup] = useState("");

  useEffect(() => {
    void window.hermesAPI
      ?.sourceIntakeStatus?.()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const crawlReady = useMemo(
    () =>
      status?.capabilities.some(
        (capability) => capability.key === "crawl4ai" && capability.ready,
      ) ?? false,
    [status],
  );

  async function preview(): Promise<void> {
    const trimmed = url.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setMessage("");
    setResult(null);
    try {
      const next = await window.hermesAPI.sourceIntakePreviewUrl(trimmed);
      setResult(next);
      setTab("review");
      if (!next.ok && next.error) setMessage(next.error);
    } catch {
      setMessage("Could not preview that source.");
    } finally {
      setBusy(false);
    }
  }

  async function addFeed(): Promise<void> {
    if (!result?.ok || !isFeedResult(result)) return;
    setSaving(true);
    setMessage("");
    try {
      await window.hermesAPI.spsRssAddFeed({
        url: result.canonicalUrl,
        site_url:
          result.links.find((link) => link !== result.canonicalUrl) || "",
        title: result.title,
        description: result.excerpt,
        category: feedCategory(result),
      });
      await window.hermesAPI.spsRssSyncFeeds();
      await onFeedsChanged?.();
      setMessage("Feed added and synced.");
    } catch {
      setMessage("Could not add and sync that feed.");
    } finally {
      setSaving(false);
    }
  }

  async function saveToKb(): Promise<void> {
    if (!result?.ok) return;
    setSaving(true);
    setMessage("");
    try {
      const saved = await window.hermesAPI.spsFileResearch(
        result.title,
        result.markdown,
      );
      setMessage(
        saved.ok ? "Saved to Knowledge Base." : saved.error || "Save failed.",
      );
    } catch {
      setMessage("Could not save that source.");
    } finally {
      setSaving(false);
    }
  }

  async function showSetup(): Promise<void> {
    setSetup(await window.hermesAPI.sourceIntakeInstallInstructions());
  }

  return (
    <section className="source-intake-panel" aria-label="Sources">
      <div className="source-intake-header">
        <div>
          <h3>Sources</h3>
          <div className="source-intake-status">
            {crawlReady ? "Public page extraction ready" : "RSS ready"}
          </div>
        </div>
        <div className="source-intake-tabs" role="tablist">
          {(["find", "add", "review"] as const).map((nextTab) => (
            <button
              key={nextTab}
              type="button"
              role="tab"
              aria-selected={tab === nextTab}
              className={`source-intake-tab ${tab === nextTab ? "active" : ""}`}
              onClick={() => setTab(nextTab)}
            >
              {nextTab === "find"
                ? "Find"
                : nextTab === "add"
                  ? "Add URL"
                  : "Review"}
            </button>
          ))}
        </div>
      </div>

      {tab === "find" && <SubstackRadarPanel />}

      {tab === "add" && (
        <div className="source-intake-add">
          <div className="log-input-group source-intake-url">
            <label htmlFor="source-url">Source URL</label>
            <input
              id="source-url"
              type="text"
              value={url}
              placeholder="https://example.com/article"
              title="Source URL"
              onChange={(event) => {
                setUrl(event.target.value);
                setMessage("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") void preview();
              }}
            />
          </div>
          <button
            type="button"
            className="log-submit-btn save-journal-entry-btn"
            disabled={busy || !url.trim()}
            onClick={() => void preview()}
          >
            <Icon name="search" size={13} className="refresh-icon-style" />
            {busy ? "Reading..." : "Read Source"}
          </button>
          {!crawlReady && (
            <button
              type="button"
              className="log-submit-btn protocol-record-btn"
              onClick={() => void showSetup()}
            >
              Show setup
            </button>
          )}
        </div>
      )}

      {tab === "review" && (
        <div className="source-intake-review">
          {result?.ok ? (
            <>
              <div className="source-intake-preview">
                <div className="source-intake-preview-title">
                  {result.title}
                </div>
                <div className="source-intake-preview-url">
                  {result.canonicalUrl}
                </div>
                {result.excerpt && (
                  <div className="source-intake-preview-excerpt">
                    {result.excerpt}
                  </div>
                )}
                <pre className="source-intake-markdown">{result.markdown}</pre>
              </div>
              <div className="source-intake-actions">
                {isFeedResult(result) && (
                  <button
                    type="button"
                    className="log-submit-btn protocol-record-btn"
                    disabled={saving}
                    onClick={() => void addFeed()}
                  >
                    {saving ? "Syncing..." : "Add Feed"}
                  </button>
                )}
                <button
                  type="button"
                  className="log-submit-btn save-journal-entry-btn"
                  disabled={saving}
                  onClick={() => void saveToKb()}
                >
                  {saving ? "Saving..." : "Save to KB"}
                </button>
              </div>
            </>
          ) : (
            <div className="source-intake-empty">
              {message || "Add a source URL to review it here."}
            </div>
          )}
        </div>
      )}

      {message && result?.ok && (
        <div className="source-intake-message">{message}</div>
      )}
      {setup && <pre className="source-intake-setup">{setup}</pre>}
    </section>
  );
}
