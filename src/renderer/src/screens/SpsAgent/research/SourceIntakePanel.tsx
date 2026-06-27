import { useEffect, useMemo, useState } from "react";
import type {
  SourceIntakeResult,
  SourceIntakeStatus,
} from "../../../../../shared/source-intake";
import {
  buildContentIdeaFromSources,
  parseContentSourceUrls,
  type ContentIdeaSourceRecord,
} from "../../../lib/content-studio";
import { hasCuratedBriefSources } from "../../../../../shared/curatedBrief";
import { buildDeckInputFromResearch } from "../../../../../shared/deck-studio";
import { Icon } from "../components/Icon";
import { SubstackRadarPanel } from "./SubstackRadarPanel";
import { saveContentIdea } from "../content/contentStudioStorage";
import { useStore } from "../store";
import { assetUrl, prettySize } from "../lib/assets";
import { ocrImageBlobToText } from "../lib/ocr";
import type {
  SpsRecentScreenshotCandidate,
  SpsRecentScreenshotImportResult,
} from "../../../../../shared/recent-screenshots";
import {
  appendScreenshotOcr,
  buildScreenshotStudyCorpus,
} from "./screenshotOcr";

type SourceTab = "find" | "add" | "screenshot" | "study" | "review";

interface SourceIntakePanelProps {
  onFeedsChanged?: () => Promise<void> | void;
}

function isFeedResult(result: SourceIntakeResult | null): boolean {
  return result?.ok === true && result.engine === "rss";
}

function feedCategory(result: SourceIntakeResult): string {
  return result.canonicalUrl.includes("substack.com") ? "Substack" : "Sources";
}

function extractChatReply(res: unknown): string {
  if (!res || typeof res !== "object") return "";
  const record = res as {
    kind?: string;
    reply?: unknown;
    response?: unknown;
    run?: { resultText?: unknown };
  };
  if (Array.isArray(record.reply)) return record.reply.map(String).join("\n");
  if (typeof record.response === "string") return record.response;
  if (typeof record.run?.resultText === "string") return record.run.resultText;
  return "";
}

export function SourceIntakePanel({
  onFeedsChanged,
}: SourceIntakePanelProps): React.JSX.Element {
  const openContentStudioIdea = useStore((s) => s.openContentStudioIdea);
  const openDeckStudioInput = useStore((s) => s.openDeckStudioInput);
  const setSurface = useStore((s) => s.setSurface);
  const [tab, setTab] = useState<SourceTab>("add");
  const [status, setStatus] = useState<SourceIntakeStatus | null>(null);
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<SourceIntakeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [setup, setSetup] = useState("");
  const [ideaSources, setIdeaSources] = useState<ContentIdeaSourceRecord[]>([]);
  const [ideaTitle, setIdeaTitle] = useState("");
  const [studyFocus, setStudyFocus] = useState("");
  const [studyCorpus, setStudyCorpus] = useState("");
  const [studyBusy, setStudyBusy] = useState(false);
  const [studyResult, setStudyResult] = useState("");
  const [studyResultKind, setStudyResultKind] = useState<"study" | "brief">(
    "study",
  );
  const [screenshotCandidates, setScreenshotCandidates] = useState<
    SpsRecentScreenshotCandidate[]
  >([]);
  const [screenshotBusy, setScreenshotBusy] = useState(false);
  const [screenshotsLoading, setScreenshotsLoading] = useState(false);
  const [screenshotNote, setScreenshotNote] = useState("");
  const [ocrBusy, setOcrBusy] = useState(false);
  const [screenshotResult, setScreenshotResult] =
    useState<SpsRecentScreenshotImportResult | null>(null);

  useEffect(() => {
    void window.hermesAPI
      ?.sourceIntakeStatus?.()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    if (tab !== "screenshot") return;
    let cancelled = false;
    setScreenshotsLoading(true);
    void window.hermesAPI
      ?.spsListRecentScreenshots?.()
      .then((candidates) => {
        if (!cancelled) setScreenshotCandidates(candidates ?? []);
      })
      .catch(() => {
        if (!cancelled) setScreenshotCandidates([]);
      })
      .finally(() => {
        if (!cancelled) setScreenshotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

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

  async function saveAsContentIdea(): Promise<void> {
    if (!result?.ok) return;
    const idea = buildContentIdeaFromSources({
      id: `idea-${Date.now().toString(36)}`,
      title: result.title,
      sources: [
        {
          url: result.canonicalUrl,
          title: result.title,
          excerpt: result.excerpt,
        },
      ],
      capturedFrom: "source-preview",
      rubric: { proof: result.links.length ? 1 : 0 },
    });
    await saveContentIdea(idea);
    openContentStudioIdea(idea);
    setMessage("Saved as content idea.");
  }

  function openPreviewDeck(): void {
    if (!result?.ok) return;
    openDeckStudioInput(
      buildDeckInputFromResearch({
        title: result.title,
        markdown: result.markdown,
        locator: result.canonicalUrl,
      }),
    );
    setMessage("Opened Deck Studio with this source.");
  }

  function addResultToIdeaSources(): void {
    if (!result?.ok) return;
    const nextSource = {
      url: result.canonicalUrl,
      title: result.title,
      excerpt: result.excerpt,
    };
    setIdeaSources((current) => {
      if (current.some((source) => source.url === nextSource.url)) {
        return current;
      }
      return [...current, nextSource];
    });
    setIdeaTitle((current) => current || result.title);
    setMessage("Added to idea sources.");
  }

  async function createContentIdeaFromSources(): Promise<void> {
    if (ideaSources.length === 0 || saving) return;
    setSaving(true);
    setMessage("");
    try {
      const idea = buildContentIdeaFromSources({
        id: `idea-sources-${Date.now().toString(36)}`,
        title: ideaTitle.trim() || ideaSources[0]?.title,
        sources: ideaSources,
        capturedFrom: "sources",
      });
      await saveContentIdea(idea);
      openContentStudioIdea(idea);
      setMessage("Created Content Studio idea.");
    } finally {
      setSaving(false);
    }
  }

  async function runStudy(): Promise<void> {
    const focus = studyFocus.trim();
    if (!focus || studyBusy) return;
    setStudyBusy(true);
    setStudyResult("");
    setStudyResultKind("study");
    setMessage("");
    try {
      const res = await window.hermesAPI.spsSourceStudy?.(
        focus,
        studyCorpus.trim() || undefined,
      );
      setStudyResult(extractChatReply(res) || "No study result returned.");
    } catch {
      setStudyResult("Source study failed.");
    } finally {
      setStudyBusy(false);
    }
  }

  function prepareScreenshotStudy(
    imported: Extract<SpsRecentScreenshotImportResult, { ok: true }>,
    ocrText?: string,
  ): void {
    setStudyFocus("Study this screenshot capture");
    setStudyCorpus(buildScreenshotStudyCorpus(imported, ocrText));
    setTab("study");
  }

  function openScreenshotDeck(
    imported: Extract<SpsRecentScreenshotImportResult, { ok: true }>,
  ): void {
    openDeckStudioInput(
      buildDeckInputFromResearch(
        {
          title: `Screenshot: ${imported.originalName}`,
          markdown: buildScreenshotStudyCorpus(imported, imported.ocrText),
          locator: `Inbox capture ${imported.captureId}`,
        },
        {
          goal: "turn this screenshot capture into a deck brief",
        },
      ),
    );
    setMessage("Opened Deck Studio with this screenshot.");
  }

  async function importScreenshot(
    candidateId?: string,
    action: "inbox" | "study" | "deck" = "inbox",
  ): Promise<void> {
    if (screenshotBusy) return;
    setScreenshotBusy(true);
    setMessage("");
    setScreenshotResult(null);
    try {
      const imported = await window.hermesAPI.spsImportRecentScreenshot?.({
        ...(candidateId ? { candidateId } : {}),
        note: screenshotNote.trim(),
      });
      if (!imported) {
        setMessage("Could not import that screenshot.");
        return;
      }
      setScreenshotResult(imported);
      setMessage(imported.ok ? "Imported to Inbox." : imported.error);
      if (imported.ok && action === "study") {
        prepareScreenshotStudy(imported, imported.ocrText);
      } else if (imported.ok && action === "deck") {
        openScreenshotDeck(imported);
      }
    } catch {
      setMessage("Could not import that screenshot.");
    } finally {
      setScreenshotBusy(false);
    }
  }

  async function importClipboardScreenshot(): Promise<void> {
    if (screenshotBusy) return;
    setScreenshotBusy(true);
    setMessage("");
    setScreenshotResult(null);
    try {
      const imported = await window.hermesAPI.spsImportClipboardScreenshot?.({
        note: screenshotNote.trim(),
      });
      if (!imported) {
        setMessage("Could not import from the clipboard.");
        return;
      }
      setScreenshotResult(imported);
      setMessage(imported.ok ? "Imported to Inbox." : imported.error);
    } catch {
      setMessage("Could not import from the clipboard.");
    } finally {
      setScreenshotBusy(false);
    }
  }

  async function extractScreenshotText(
    imported: Extract<SpsRecentScreenshotImportResult, { ok: true }>,
  ): Promise<void> {
    if (ocrBusy) return;
    const api = window.hermesAPI;
    if (!api?.spsReadRow || !api?.spsExportRow) {
      setMessage("Could not update the Inbox capture.");
      return;
    }
    setOcrBusy(true);
    setMessage("");
    try {
      const response = await fetch(assetUrl(imported.assetPath));
      const blob = await response.blob();
      const ocrText = await ocrImageBlobToText(blob);
      const current = await api.spsReadRow("_inbox", imported.captureId);
      const next = appendScreenshotOcr(current || "", ocrText);
      await api.spsExportRow("_inbox", imported.captureId, next);
      prepareScreenshotStudy(imported, ocrText);
      setMessage("OCR text added to Inbox capture.");
    } catch {
      setMessage("Could not extract text from that screenshot.");
    } finally {
      setOcrBusy(false);
    }
  }

  async function runCuratedBrief(): Promise<void> {
    const focus = studyFocus.trim();
    if (!focus || studyBusy) return;
    setStudyBusy(true);
    setStudyResult("");
    setStudyResultKind("brief");
    setMessage("");
    try {
      const res = await window.hermesAPI.spsCuratedBrief?.(
        focus,
        studyCorpus.trim() || undefined,
      );
      setStudyResult(extractChatReply(res) || "No curated brief returned.");
    } catch {
      setStudyResult("Curated brief failed.");
    } finally {
      setStudyBusy(false);
    }
  }

  async function saveBriefToKb(): Promise<void> {
    if (!studyFocus.trim() || !studyResult.trim() || saving) return;
    if (!hasCuratedBriefSources(studyResult)) {
      setMessage("Could not find usable source links, so nothing was saved.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const saved = await window.hermesAPI.spsFileResearch(
        studyFocus.trim(),
        studyResult,
      );
      setMessage(
        saved.ok
          ? "Saved brief to Knowledge Base."
          : saved.error || "Save failed.",
      );
    } catch {
      setMessage("Could not save that brief.");
    } finally {
      setSaving(false);
    }
  }

  async function saveStudyAsContentIdea(): Promise<void> {
    if (!studyFocus.trim() || !studyResult.trim() || saving) return;
    const urls = parseContentSourceUrls(`${studyCorpus}\n${studyResult}`);
    setSaving(true);
    setMessage("");
    try {
      const idea = buildContentIdeaFromSources({
        id: `idea-study-${Date.now().toString(36)}`,
        title: studyFocus.trim(),
        sources: urls.map((sourceUrl) => ({ url: sourceUrl })),
        angle: studyResult,
        capturedFrom:
          studyResultKind === "brief" ? "curated-brief" : "source-study",
        rubric: { proof: urls.length ? 1 : 0, originality: 1 },
      });
      await saveContentIdea(idea);
      openContentStudioIdea(idea);
      setMessage(
        studyResultKind === "brief"
          ? "Saved brief as content idea."
          : "Saved study as content idea.",
      );
    } finally {
      setSaving(false);
    }
  }

  function openStudyDeck(): void {
    if (!studyFocus.trim() || !studyResult.trim()) return;
    openDeckStudioInput(
      buildDeckInputFromResearch({
        title: studyFocus.trim(),
        markdown: `${studyCorpus}\n\n${studyResult}`.trim(),
        locator:
          studyResultKind === "brief"
            ? "Sources / Curated Brief"
            : "Sources / Study",
      }),
    );
    setMessage(
      studyResultKind === "brief"
        ? "Opened Deck Studio with this brief."
        : "Opened Deck Studio with this study.",
    );
  }

  async function showSetup(): Promise<void> {
    setSetup(await window.hermesAPI.sourceIntakeInstallInstructions());
  }

  return (
    <section className="source-intake-panel" aria-label="Capture">
      <div className="source-intake-header">
        <div>
          <h3>Capture</h3>
          <div className="source-intake-status">
            {crawlReady ? "Public page extraction ready" : "RSS ready"}
          </div>
        </div>
        <div className="source-intake-tabs" role="tablist">
          {(["find", "add", "screenshot", "study", "review"] as const).map(
            (nextTab) => (
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
                    : nextTab === "screenshot"
                      ? "Screenshot"
                      : nextTab === "study"
                        ? "Study"
                        : "Review"}
              </button>
            ),
          )}
        </div>
      </div>

      {ideaSources.length > 0 && (
        <div className="source-intake-idea-set">
          <label className="log-input-group">
            <span>Content idea title</span>
            <input
              aria-label="Content idea title"
              type="text"
              value={ideaTitle}
              onChange={(event) => setIdeaTitle(event.target.value)}
              placeholder="One idea from these sources"
            />
          </label>
          <div className="source-intake-source-list">
            {ideaSources.map((source) => (
              <span key={source.url}>{source.title || source.url}</span>
            ))}
          </div>
          <button
            type="button"
            className="log-submit-btn save-journal-entry-btn"
            disabled={saving}
            onClick={() => void createContentIdeaFromSources()}
          >
            Create content idea
          </button>
        </div>
      )}

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
                <button
                  type="button"
                  className="log-submit-btn protocol-record-btn"
                  disabled={saving}
                  onClick={addResultToIdeaSources}
                >
                  Add to idea sources
                </button>
                <button
                  type="button"
                  className="log-submit-btn protocol-record-btn"
                  disabled={saving}
                  onClick={() => void saveAsContentIdea()}
                >
                  Save as content idea
                </button>
                <button
                  type="button"
                  className="log-submit-btn protocol-record-btn"
                  onClick={openPreviewDeck}
                >
                  Deck from source
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

      {tab === "screenshot" && (
        <div className="source-intake-review">
          <label className="log-input-group">
            <span>Screenshot note</span>
            <input
              aria-label="Screenshot note"
              type="text"
              value={screenshotNote}
              onChange={(event) => setScreenshotNote(event.target.value)}
              placeholder="Optional context for the Inbox capture"
            />
          </label>
          <button
            type="button"
            className="log-submit-btn save-journal-entry-btn"
            disabled={screenshotBusy}
            onClick={() => void importClipboardScreenshot()}
          >
            <Icon name="file" size={13} className="refresh-icon-style" />
            {screenshotBusy ? "Importing..." : "Import from clipboard"}
          </button>
          {screenshotsLoading && (
            <div className="source-intake-empty">
              Looking for screenshots...
            </div>
          )}
          {!screenshotsLoading && screenshotCandidates.length === 0 && (
            <div className="source-intake-empty">
              No recent screenshots found.
            </div>
          )}
          {screenshotCandidates.length > 0 && (
            <div className="source-intake-source-list">
              {screenshotCandidates.map((candidate) => (
                <div className="source-intake-preview" key={candidate.id}>
                  {candidate.previewDataUrl ? (
                    <img
                      src={candidate.previewDataUrl}
                      alt=""
                      className="source-intake-screenshot-preview"
                    />
                  ) : (
                    <div className="source-intake-empty">No thumbnail</div>
                  )}
                  <div className="source-intake-preview-title">
                    {candidate.originalName}
                  </div>
                  <div className="source-intake-preview-url">
                    {new Date(candidate.modifiedAt).toLocaleString()} ·{" "}
                    {prettySize(candidate.size)}
                  </div>
                  <div className="source-intake-actions">
                    <button
                      type="button"
                      className="log-submit-btn save-journal-entry-btn"
                      disabled={screenshotBusy}
                      onClick={() =>
                        void importScreenshot(candidate.id, "inbox")
                      }
                    >
                      Import to Inbox
                    </button>
                    <button
                      type="button"
                      className="log-submit-btn protocol-record-btn"
                      disabled={screenshotBusy}
                      onClick={() =>
                        void importScreenshot(candidate.id, "study")
                      }
                    >
                      Study
                    </button>
                    <button
                      type="button"
                      className="log-submit-btn protocol-record-btn"
                      disabled={screenshotBusy}
                      onClick={() =>
                        void importScreenshot(candidate.id, "deck")
                      }
                    >
                      Deck
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {screenshotResult?.ok && (
            <div className="source-intake-preview">
              <div className="source-intake-preview-title">
                {screenshotResult.originalName}
              </div>
              <div className="source-intake-preview-url">
                Saved as Inbox capture {screenshotResult.captureId}
              </div>
              <button
                type="button"
                className="log-submit-btn protocol-record-btn"
                onClick={() => setSurface("inbox")}
              >
                Open Inbox
              </button>
              <button
                type="button"
                className="log-submit-btn protocol-record-btn"
                disabled={ocrBusy}
                onClick={() => void extractScreenshotText(screenshotResult)}
              >
                {ocrBusy ? "Extracting..." : "Extract text"}
              </button>
              <button
                type="button"
                className="log-submit-btn protocol-record-btn"
                onClick={() => openScreenshotDeck(screenshotResult)}
              >
                Deck
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "study" && (
        <div className="source-intake-study">
          <label className="log-input-group">
            <span>Study focus</span>
            <input
              aria-label="Study focus"
              type="text"
              value={studyFocus}
              onChange={(event) => setStudyFocus(event.target.value)}
              placeholder="Question or learning goal"
            />
          </label>
          <label className="log-input-group">
            <span>Corpus description</span>
            <textarea
              aria-label="Corpus description"
              className="substack-radar-input"
              value={studyCorpus}
              onChange={(event) => setStudyCorpus(event.target.value)}
              placeholder="Name the URLs, PDFs, articles, wiki pages, or NotebookLM sources to study."
              rows={3}
            />
          </label>
          <button
            type="button"
            className="log-submit-btn save-journal-entry-btn"
            disabled={studyBusy || !studyFocus.trim()}
            onClick={() => void runStudy()}
          >
            {studyBusy ? "Studying..." : "Study"}
          </button>
          <button
            type="button"
            className="log-submit-btn protocol-record-btn"
            disabled={studyBusy || !studyFocus.trim()}
            onClick={() => void runCuratedBrief()}
          >
            {studyBusy ? "Working..." : "Curated Brief"}
          </button>
          {studyResult && (
            <>
              <pre className="source-intake-markdown">{studyResult}</pre>
              {studyResultKind === "brief" && (
                <button
                  type="button"
                  className="log-submit-btn save-journal-entry-btn"
                  disabled={saving}
                  onClick={() => void saveBriefToKb()}
                >
                  {saving ? "Saving..." : "Save brief to KB"}
                </button>
              )}
              <button
                type="button"
                className="log-submit-btn protocol-record-btn"
                disabled={saving}
                onClick={() => void saveStudyAsContentIdea()}
              >
                {studyResultKind === "brief"
                  ? "Save brief as content idea"
                  : "Save study as content idea"}
              </button>
              <button
                type="button"
                className="log-submit-btn protocol-record-btn"
                onClick={openStudyDeck}
              >
                {studyResultKind === "brief"
                  ? "Deck from brief"
                  : "Deck from study"}
              </button>
            </>
          )}
        </div>
      )}

      {message && result?.ok && (
        <div className="source-intake-message">{message}</div>
      )}
      {message && tab === "screenshot" && (
        <div className="source-intake-message">{message}</div>
      )}
      {message && tab === "study" && (
        <div className="source-intake-message">{message}</div>
      )}
      {setup && <pre className="source-intake-setup">{setup}</pre>}
    </section>
  );
}
