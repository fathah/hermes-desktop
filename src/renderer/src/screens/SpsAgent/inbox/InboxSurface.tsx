// InboxSurface.tsx — the capture inbox + ingest review queue (second-brain loop) + curation settings.
//
// The inbox is the "Raw Sources" layer: quick notes and web-clips land here as
// immutable markdown rows under vault/_inbox/, awaiting agent ingest. Writes go
// through the existing folder-backed-row path (spsExportRow) — no new IPC — and
// the note-index makes them queryable.
//
// "Process inbox" runs the read-only ingest agent (spsIngestInbox), which
// PROPOSES a changeset of wiki pages. The proposal is shown in a review queue;
// the user applies it, and the desktop COMMITS each page through the store
// (ingestCommitPage) so it appears in both storage modes — the propose-then-
// commit keystone. Nothing the agent proposes lands until you approve it.
import { useCallback, useState, useEffect } from "react";
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import { useVaultQuery, type VaultRow } from "../hooks/useNoteIndex";
import {
  buildCapture,
  withStatus,
  INBOX_FOLDER,
  type CaptureStatus,
} from "./capture";
import { commitChangeset } from "./ingestApply";
import type { VaultProposalInput } from "../../../../../shared/sps-types";
import type {
  SpsCaptureKind,
  SpsPageSchemaKey,
} from "../../../../../shared/sps-types";
import {
  getAutoApply,
  setAutoApply,
  getIngestIntervalMin,
  setIngestIntervalMin,
} from "./ingestPrefs";
import { installVaultSkill } from "./vaultSkill";
import { blk } from "../lib/ids";
import { pageIdFromPath } from "../lib/pageId";
import { pageFromMarkdown } from "../editor/pageMarkdown";
import { DEFAULT_WIKI_SCHEMA } from "../../../../../shared/wikiSchema";

interface InboxSurfaceProps {
  profile?: string;
}

type Mode = "note" | "web" | "pdf";
type Tab = "inbox" | "settings";

const CAPTURE_KINDS: SpsCaptureKind[] = [
  "note",
  "source",
  "project",
  "person",
  "decision",
  "meeting",
  "task",
  "journal",
];

function schemaForCaptureKind(
  kind: SpsCaptureKind,
): SpsPageSchemaKey | undefined {
  return kind === "note" ? undefined : kind;
}

interface ProposedPage {
  op: "create" | "update";
  pageId: string;
  title: string;
  markdown: string;
}
interface Changeset {
  summary: string;
  pages: ProposedPage[];
  captures: Array<{ id: string; status: "processed" | "discarded" }>;
  memory: string[];
}

function changesetToProposal(
  changeset: Changeset,
  source: VaultProposalInput["source"],
  title: string,
): VaultProposalInput {
  return {
    source,
    title,
    summary: changeset.summary,
    operations: [
      ...changeset.pages.map((page) => ({
        id: `page-${page.pageId}`,
        kind: "upsert-page" as const,
        pageId: page.pageId,
        title: page.title,
        markdown: page.markdown,
      })),
      ...changeset.captures.map((capture) => ({
        id: `capture-${capture.id}`,
        kind: "mark-capture" as const,
        captureId: capture.id,
        status: capture.status,
      })),
      ...changeset.memory.map((body, index) => ({
        id: `memory-${index}`,
        kind: "add-memory" as const,
        body,
      })),
    ],
  };
}

function timeLabel(capturedAt: unknown): string {
  if (typeof capturedAt !== "number") return "";
  try {
    return new Date(capturedAt).toLocaleString();
  } catch {
    return "";
  }
}

export function InboxSurface({
  profile = "default",
}: InboxSurfaceProps): React.JSX.Element {
  const { rows, refetch } = useVaultQuery(INBOX_FOLDER, [
    { prop: "status", op: "eq", value: "unprocessed" },
  ]);
  // Optimistically hide rows we just acted on — the chokidar re-index that backs
  // useVaultQuery lands a beat after the write, so we reconcile on refetch.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>("note");
  const [activeTab, setActiveTab] = useState<Tab>("inbox");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [noteKind, setNoteKind] = useState<SpsCaptureKind>("note");
  const [webKind, setWebKind] = useState<SpsCaptureKind>("source");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Ingest review queue.
  const ingestCommitPage = useStore((s) => s.ingestCommitPage);
  const flash = useStore((s) => s.flash);
  const setSurface = useStore((s) => s.setSurface);
  const importPdf = useStore((s) => s.importPdf);
  const [ingesting, setIngesting] = useState(false);
  const [changeset, setChangeset] = useState<Changeset | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [skipMem, setSkipMem] = useState<Set<number>>(new Set());
  const [autoApply, setAutoApplyState] = useState(() => getAutoApply());
  const [intervalMin, setIntervalMin] = useState(() => getIngestIntervalMin());

  // Curation settings fields
  const [threshold, setThreshold] = useState(0.45);
  const [model, setModel] = useState("hermes-agent");
  const [voice, setVoice] = useState("en-US-AriaNeural");
  const [topics, setTopics] = useState<string[]>([]);
  const [ignoredTopics, setIgnoredTopics] = useState<string[]>([]);
  const [digestPath, setDigestPath] = useState("daily-digests");
  const [flashcardPath, setFlashcardPath] = useState(
    "flashcards/daily_news_flashcards.md",
  );
  const [audioPath, setAudioPath] = useState("audio");
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [settingsSaved, setSettingsSaved] = useState(false);

  // Load curator settings from vault
  useEffect(() => {
    async function loadSettings() {
      try {
        const content = await window.hermesAPI.readObsidianFile(
          "curator-settings.md",
          profile,
        );
        if (content) {
          const match = /```json\s*([\s\S]*?)\s*```/.exec(content);
          if (match) {
            const parsed = JSON.parse(match[1]);
            if (typeof parsed.threshold === "number")
              setThreshold(parsed.threshold);
            if (typeof parsed.model === "string") setModel(parsed.model);
            if (typeof parsed.voice === "string") setVoice(parsed.voice);
            if (Array.isArray(parsed.topics)) setTopics(parsed.topics);
            if (Array.isArray(parsed.ignored_topics))
              setIgnoredTopics(parsed.ignored_topics);
            if (typeof parsed.digest_path === "string")
              setDigestPath(parsed.digest_path);
            if (typeof parsed.flashcard_path === "string")
              setFlashcardPath(parsed.flashcard_path);
            if (typeof parsed.audio_path === "string")
              setAudioPath(parsed.audio_path);
          }
        }
      } catch (e) {
        console.warn(
          "Could not load curator settings (file may not exist yet):",
          e,
        );
      }
    }
    loadSettings();
  }, [profile]);

  const saveSettings = async (): Promise<void> => {
    setSavingSettings(true);
    setSettingsError("");
    setSettingsSaved(false);
    try {
      const configObj = {
        threshold,
        model,
        voice,
        topics,
        ignored_topics: ignoredTopics,
        digest_path: digestPath,
        flashcard_path: flashcardPath,
        audio_path: audioPath,
      };
      const markdown = `# Newsroom Curator Settings\n\nThis file is managed by SPS. It controls the local \`newsroom-curator\` skill execution parameters.\n\n\`\`\`json\n${JSON.stringify(configObj, null, 2)}\n\`\`\`\n`;
      await window.hermesAPI.writeObsidianFile(
        "curator-settings.md",
        markdown,
        profile,
      );
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSettings(false);
    }
  };

  const visible = rows.filter((r) => !hidden.has(r.path));

  const reconcile = useCallback(() => {
    // Give the watcher time to re-index, then refetch and clear optimistic state.
    setTimeout(() => {
      refetch();
      setHidden(new Set());
    }, 500);
  }, [refetch]);

  const writeCapture = useCallback(
    async (markdown: string, id: string) => {
      const api = window.hermesAPI;
      if (!api?.spsExportRow) throw new Error("Vault is unavailable offline.");
      const ok = await api.spsExportRow(INBOX_FOLDER, id, markdown, profile);
      if (!ok) throw new Error("Could not write the capture to the vault.");
    },
    [profile],
  );

  const captureNote = useCallback(async () => {
    if (!body.trim()) return;
    setBusy(true);
    setError("");
    try {
      const { id, markdown } = buildCapture({
        source: "quick-note",
        body,
        title,
        via: "user",
        capturedAt: Date.now(),
        captureKind: noteKind,
        schema: schemaForCaptureKind(noteKind),
        provenance: "SPS inbox",
      });
      await writeCapture(markdown, id);
      setTitle("");
      setBody("");
      reconcile();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [body, title, noteKind, writeCapture, reconcile]);

  const captureWeb = useCallback(async () => {
    const target = url.trim();
    if (!target) return;
    setBusy(true);
    setError("");
    try {
      // Reuse the SSRF-hardened unfurl (IP-pinned, redirect-revalidating).
      const meta = await window.hermesAPI.spsUnfurl(target);
      const lines = [meta.title, meta.desc, meta.url].filter(Boolean);
      const { id, markdown } = buildCapture({
        source: "web",
        title: title || meta.title,
        body: lines.join("\n\n"),
        url: meta.url || target,
        via: "user",
        capturedAt: Date.now(),
        captureKind: webKind,
        schema: schemaForCaptureKind(webKind),
        links: meta.url ? [meta.url] : [target],
        provenance: "SPS web clip",
      });
      await writeCapture(markdown, id);
      setTitle("");
      setUrl("");
      reconcile();
    } catch (e) {
      setError(
        e instanceof Error
          ? `Couldn't clip that link: ${e.message}`
          : String(e),
      );
    } finally {
      setBusy(false);
    }
  }, [url, title, webKind, writeCapture, reconcile]);

  const setStatus = useCallback(
    async (row: VaultRow, status: CaptureStatus) => {
      const api = window.hermesAPI;
      if (!api?.spsReadRow || !api?.spsExportRow) return;
      const id = pageIdFromPath(row.path);
      setHidden((prev) => new Set(prev).add(row.path));
      try {
        const current = await api.spsReadRow(INBOX_FOLDER, id, profile);
        if (current == null) return;
        await api.spsExportRow(
          INBOX_FOLDER,
          id,
          withStatus(current, status),
          profile,
        );
        reconcile();
      } catch {
        // Un-hide on failure so the row isn't silently lost from the view.
        setHidden((prev) => {
          const next = new Set(prev);
          next.delete(row.path);
          return next;
        });
      }
    },
    [profile, reconcile],
  );

  const processInbox = useCallback(async (): Promise<void> => {
    setIngesting(true);
    setError("");
    try {
      const res = await window.hermesAPI.spsIngestInbox?.(profile);
      if (!res) throw new Error("Ingest is unavailable.");
      if (!res.ok || !res.changeset) {
        throw new Error(res.error || "Ingest failed.");
      }
      const cs = res.changeset;
      if (cs.pages.length === 0 && cs.captures.length === 0) {
        setError("My Assistant found nothing to file from these captures.");
        return;
      }
      // Auto-apply: commit immediately (full audit/undo still apply); otherwise
      // stage the changeset for manual review.
      if (autoApply) {
        const { pages, memory } = await commitChangeset(cs, ingestCommitPage, {
          profile,
        });
        await window.hermesAPI.spsAppendWikiLog?.(
          "ingest",
          cs.summary,
          profile,
        );
        flash(
          `Filed ${pages} page${pages === 1 ? "" : "s"}` +
            (memory ? ` · ${memory} memory` : ""),
        );
        reconcile();
      } else {
        await window.hermesAPI.spsCreateVaultProposal?.(
          changesetToProposal(cs, "inbox", "Process inbox"),
          profile,
        );
        flash("Queued inbox changes for review");
        setSurface("review");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIngesting(false);
    }
  }, [profile, autoApply, ingestCommitPage, flash, reconcile, setSurface]);

  const applyChangeset = useCallback(async (): Promise<void> => {
    if (!changeset) return;
    setIngesting(true);
    try {
      await commitChangeset(changeset, ingestCommitPage, {
        profile,
        skipPages: skip,
        skipMemory: skipMem,
      });
      await window.hermesAPI.spsAppendWikiLog?.(
        "ingest",
        changeset.summary,
        profile,
      );
      setChangeset(null);
      setSkip(new Set());
      setSkipMem(new Set());
      reconcile();
    } finally {
      setIngesting(false);
    }
  }, [changeset, skip, skipMem, profile, ingestCommitPage, reconcile]);

  const toggleSkip = (pageId: string): void =>
    setSkip((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });

  // Open the editable "Wiki schema" page (seed from the default if absent).
  const editWikiSchema = useCallback((): void => {
    const st = useStore.getState();
    if (!st.meta["WIKI"]) {
      const { blocks } = pageFromMarkdown(DEFAULT_WIKI_SCHEMA);
      st.makePageWithId(
        "WIKI",
        { icon: "🧠", title: "Wiki schema" },
        blocks.length ? blocks : [blk("p", "")],
        st.ensureWikiFolder(),
      );
    }
    st.selectPage("WIKI");
    st.setSurface("doc");
  }, []);

  const installSkill = useCallback(async (): Promise<void> => {
    const res = await installVaultSkill(profile);
    flash(res.message);
  }, [profile, flash]);

  const toggleSkipMem = (i: number): void =>
    setSkipMem((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const canCapture =
    mode === "note" ? body.trim().length > 0 : url.trim().length > 0;

  return (
    <div className="inbox-surface">
      <header className="inbox-header-mb">
        <h1 className="inbox-title">
          <Icon name="inbox" size={22} />
          Inbox
        </h1>
        <p className="inbox-subtitle">
          Capture rough thoughts and links. My Assistant turns these raw sources
          into linked wiki pages — they stay untouched until then.
        </p>
      </header>

      {/* Tabs */}
      <div className="inbox-tabs">
        <button
          className={`inbox-tab-btn ${activeTab === "inbox" ? "active" : ""}`}
          onClick={() => setActiveTab("inbox")}
        >
          Inbox Review
        </button>
        <button
          className={`inbox-tab-btn ${activeTab === "settings" ? "active" : ""}`}
          onClick={() => setActiveTab("settings")}
        >
          Curation Settings
        </button>
      </div>

      {activeTab === "inbox" ? (
        <>
          <section className="inbox-section">
            <div className="inbox-flex-row-gap8-mb10">
              <button
                className={`nav-item inbox-flex-no-shrink ${mode === "note" ? "active" : ""}`}
                onClick={() => setMode("note")}
              >
                <Icon name="callout" size={15} />
                <span className="nav-label">Quick note</span>
              </button>
              <button
                className={`nav-item inbox-flex-no-shrink ${mode === "web" ? "active" : ""}`}
                onClick={() => setMode("web")}
              >
                <Icon name="doc" size={15} />
                <span className="nav-label">Web clip</span>
              </button>
              <button
                className={`nav-item inbox-flex-no-shrink ${mode === "pdf" ? "active" : ""}`}
                onClick={() => setMode("pdf")}
              >
                <Icon name="file" size={15} />
                <span className="nav-label">Import PDF</span>
              </button>
            </div>

            {mode !== "pdf" && (
              <input
                className="inbox-input"
                placeholder="Title (optional)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            )}

            {mode !== "pdf" && (
              <label className="inbox-flex-align-center-gap6">
                Type
                <select
                  className="inbox-select"
                  value={mode === "note" ? noteKind : webKind}
                  onChange={(e) => {
                    const next = e.target.value as SpsCaptureKind;
                    if (mode === "note") setNoteKind(next);
                    else setWebKind(next);
                  }}
                >
                  {CAPTURE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {mode === "note" ? (
              <textarea
                className="inbox-textarea inbox-textarea-resize"
                placeholder="What's on your mind?  (⌘↵ to capture)"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                    captureNote();
                }}
                rows={4}
              />
            ) : mode === "web" ? (
              <input
                className="inbox-input"
                placeholder="https://…  (↵ to clip)"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") captureWeb();
                }}
              />
            ) : (
              <div className="inbox-pdf-dropzone">
                <Icon name="doc" size={32} className="inbox-pdf-icon" />
                <div className="inbox-pdf-desc">
                  Import a local PDF to extract and ingest it as a wiki source page.
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={async () => {
                    try {
                      await importPdf();
                    } catch (err) {
                      console.error(err);
                    }
                  }}
                >
                  Choose PDF file
                </button>
              </div>
            )}

            {error && <div className="inbox-error">{error}</div>}

            {mode !== "pdf" && (
              <div className="inbox-btn-group">
                <button
                  className="btn btn-primary"
                  disabled={busy || !canCapture}
                  onClick={mode === "note" ? captureNote : captureWeb}
                >
                  {busy ? "Capturing…" : "Capture"}
                </button>
              </div>
            )}
          </section>

          <div className="inbox-flex-align-center-gap8-mb10-bold">
            <span>Unprocessed</span>
            <span className="inbox-badge">{visible.length}</span>
            <span className="flex-grow" />
            <button
              className="btn btn-primary btn-sm"
              disabled={ingesting || visible.length === 0}
              onClick={() => void processInbox()}
              title="Ask My Assistant to turn these captures into wiki pages"
            >
              {ingesting ? "Processing…" : "Process inbox"}
            </button>
          </div>

          <div className="inbox-controls-row">
            <label className="inbox-flex-align-center-gap6-pointer">
              <input
                type="checkbox"
                checked={autoApply}
                onChange={(e) => {
                  setAutoApply(e.target.checked);
                  setAutoApplyState(e.target.checked);
                }}
              />
              Auto-apply (skip review)
            </label>
            <label className="inbox-flex-align-center-gap6">
              Auto-process every
              <select
                className="inbox-select inbox-select-schedule"
                value={intervalMin}
                onChange={(e) => {
                  const m = Number(e.target.value);
                  setIngestIntervalMin(m);
                  setIntervalMin(m);
                }}
              >
                <option value={0}>Off</option>
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={60}>60 min</option>
              </select>
            </label>
            {intervalMin > 0 && !autoApply && (
              <span className="inbox-schedule-hint">
                enable auto-apply for scheduled runs to land
              </span>
            )}
          </div>

          {changeset && (
            <section className="inbox-proposal-section">
              <div className="inbox-proposal-title">Proposed changes</div>
              <div className="inbox-proposal-summary">
                {changeset.summary ||
                  "Review My Assistant's proposed wiki pages."}
              </div>
              {changeset.pages.length === 0 ? (
                <div className="inbox-no-changes-notice">
                  No new pages — the captures will just be marked processed.
                </div>
              ) : (
                <ul className="inbox-card-list">
                  {changeset.pages.map((p) => {
                    const skipped = skip.has(p.pageId);
                    return (
                      <li
                        key={p.pageId}
                        className={`inbox-proposed-page ${skipped ? "skipped" : ""}`}
                      >
                        <div className="inbox-flex-align-center-gap8-mb6">
                          <span className="inbox-card-badge">{p.op}</span>
                          <strong>{p.title}</strong>
                          <span className="inbox-pageid-monospace">
                            [[{p.pageId}]]
                          </span>
                          <span className="flex-grow" />
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => toggleSkip(p.pageId)}
                            title={skipped ? "Include this page" : "Skip this page"}
                          >
                            {skipped ? "Include" : "Skip"}
                          </button>
                        </div>
                        <pre className="inbox-proposed-markdown-preview">
                          {p.markdown.slice(0, 600)}
                          {p.markdown.length > 600 ? "…" : ""}
                        </pre>
                      </li>
                    );
                  })}
                </ul>
              )}
              {changeset.memory.length > 0 && (
                <div className="inbox-proposed-memories">
                  <div className="inbox-proposed-memories-title">
                    Remember about you
                  </div>
                  <ul className="inbox-proposed-memories-list">
                    {changeset.memory.map((fact, i) => {
                       const skipped = skipMem.has(i);
                       return (
                         <li
                           key={i}
                           className={`inbox-proposed-memory-item ${skipped ? "skipped" : ""}`}
                         >
                           <Icon name="wand" size={13} />
                           <span className="flex-grow">{fact}</span>
                           <button
                             className="btn btn-ghost btn-sm"
                             onClick={() => toggleSkipMem(i)}
                             title={skipped ? "Remember this fact" : "Skip this fact"}
                           >
                             {skipped ? "Include" : "Skip"}
                           </button>
                         </li>
                       );
                    })}
                  </ul>
                </div>
              )}
              <div className="inbox-btn-group">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setChangeset(null)}
                >
                  Discard
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={ingesting}
                  onClick={() => void applyChangeset()}
                >
                  {ingesting ? "Applying…" : "Apply"}
                </button>
              </div>
            </section>
          )}

          {visible.length === 0 ? (
            <div className="inbox-empty-notice">
              Nothing waiting. Captures you add land here.
            </div>
          ) : (
            <ul className="inbox-card-list">
              {visible.map((row) => (
                <li key={row.path} className="inbox-card">
                  <div className="inbox-card-content">
                    <div className="inbox-card-title">
                      {String(row.props.title ?? "Untitled capture")}
                    </div>
                    <div className="inbox-card-meta">
                      <span className="inbox-source-capitalize">
                        {String(row.props.source ?? "note")}
                      </span>
                      <span>·</span>
                      <span>{timeLabel(row.props.capturedAt)}</span>
                    </div>
                  </div>
                  <button
                    title="Mark processed"
                    className="btn btn-ghost btn-sm inbox-card-action-btn"
                    onClick={() => setStatus(row, "processed")}
                  >
                    <Icon name="check" size={15} />
                  </button>
                  <button
                    title="Discard"
                    className="btn btn-ghost btn-sm inbox-card-action-btn"
                    onClick={() => setStatus(row, "discarded")}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        /* Settings Tab */
        <section className="inbox-section inbox-settings-section">
          <div className="type-h3 inbox-settings-title">
            News Curator Preferences
          </div>

          {settingsError && (
            <div className="inbox-settings-error-text">
              {settingsError}
            </div>
          )}

          {settingsSaved && (
            <div className="inbox-curation-saved-outcome">
              Settings saved successfully!
            </div>
          )}

          <div className="settings-field">
            <label className="settings-field-label">
              Similarity Threshold ({threshold.toFixed(2)})
            </label>
            <div className="settings-field-hint inbox-settings-field-hint-mb6">
              Controls how similar articles must be to group into the same
              cluster. Higher threshold yields tighter groups with fewer, more
              distinct articles.
            </div>
            <div className="inbox-flex-align-center-gap12">
              <input
                type="range"
                min="0.10"
                max="1.00"
                step="0.05"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="flex-grow"
                title="Similarity Threshold Range"
              />
              <input
                type="number"
                min="0.10"
                max="1.00"
                step="0.05"
                className="inbox-input inbox-width-70-margin0"
                value={threshold}
                onChange={(e) =>
                  setThreshold(
                    Math.max(0.1, Math.min(1.0, Number(e.target.value))),
                  )
                }
                title="Similarity Threshold Value"
              />
            </div>
          </div>

          <PillEditor
            label="Prioritized Topics"
            hint="Keywords of topics you want to flag or prioritize. If articles in a cluster match these, they are highlighted and tagged."
            tags={topics}
            onChange={setTopics}
            placeholder="e.g. AI, Fed, Finance"
          />

          <PillEditor
            label="Ignored Topics"
            hint="Keywords of topics you want to automatically filter out from your feed. Any capture containing these words will be skipped."
            tags={ignoredTopics}
            onChange={setIgnoredTopics}
            placeholder="e.g. Clickbait, Gossip"
          />

          <div className="settings-field">
            <label className="settings-field-label">Synthesis LLM Model</label>
            <div className="settings-field-hint inbox-settings-field-hint-mb6">
              Model used to summarize clustered articles and write daily briefs.
            </div>
            <input
              type="text"
              className="inbox-input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. hermes-agent"
            />
          </div>

          <div className="settings-field">
            <label className="settings-field-label">TTS Auditory Voice</label>
            <div className="settings-field-hint inbox-settings-field-hint-mb6">
              Voice utilized by edge-tts for compiling the 2-minute Pimsleur
              audio drills.
            </div>
            <select
              className="inbox-select"
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              title="TTS Auditory Voice Selection"
            >
              <option value="en-US-AriaNeural">
                en-US-AriaNeural (US, Female)
              </option>
              <option value="en-US-GuyNeural">
                en-US-GuyNeural (US, Male)
              </option>
              <option value="en-GB-SoniaNeural">
                en-GB-SoniaNeural (UK, Female)
              </option>
              <option value="en-GB-RyanNeural">
                en-GB-RyanNeural (UK, Male)
              </option>
              <option value="en-AU-NatashaNeural">
                en-AU-NatashaNeural (AU, Female)
              </option>
            </select>
          </div>

          <div className="settings-field">
            <label className="settings-field-label">
              Daily Digest Subfolder
            </label>
            <div className="settings-field-hint inbox-settings-field-hint-mb6">
              Folder inside your vault where daily briefs land (e.g.
              daily-digests).
            </div>
            <input
              type="text"
              className="inbox-input"
              value={digestPath}
              onChange={(e) => setDigestPath(e.target.value)}
              title="Daily Digest Subfolder Path"
            />
          </div>

          <div className="settings-field">
            <label className="settings-field-label">
              Flashcard Output File
            </label>
            <div className="settings-field-hint inbox-settings-field-hint-mb6">
              Path to the markdown file where cloze-deletion flashcards are
              appended.
            </div>
            <input
              type="text"
              className="inbox-input"
              value={flashcardPath}
              onChange={(e) => setFlashcardPath(e.target.value)}
              title="Flashcard Output File Path"
            />
          </div>

          <div className="settings-field">
            <label className="settings-field-label">
              Audio Loops Subfolder
            </label>
            <div className="settings-field-hint inbox-settings-field-hint-mb6">
              Folder where Pimsleur Q&A scripts and MP3 loops are written.
            </div>
            <input
              type="text"
              className="inbox-input"
              value={audioPath}
              onChange={(e) => setAudioPath(e.target.value)}
              title="Audio Loops Subfolder Path"
            />
          </div>

          <div
            className="inbox-btn-group inbox-settings-actions-btn-group"
          >
            <button
              className="btn btn-primary"
              disabled={savingSettings}
              onClick={() => void saveSettings()}
            >
              {savingSettings ? "Saving..." : "Save Settings"}
            </button>
          </div>
        </section>
      )}

      <div className="inbox-footer-container">
        <button onClick={editWikiSchema} className="inbox-footer-btn">
          Edit wiki schema
        </button>
        <button
          onClick={() => void installSkill()}
          className="inbox-footer-btn"
        >
          Install assistant vault skill
        </button>
      </div>
    </div>
  );
}

function PillEditor({
  label,
  hint,
  tags,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const val = input.trim();
      if (val && !tags.includes(val)) {
        onChange([...tags, val]);
      }
      setInput("");
    }
  };

  const removeTag = (index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  return (
    <div className="settings-field">
      <label className="settings-field-label">{label}</label>
      {hint && (
        <div className="settings-field-hint inbox-settings-field-hint-mb6">
          {hint}
        </div>
      )}
      <div className="inbox-pill-input-container">
        {tags.map((tag, i) => (
          <span key={i} className="inbox-pill">
            {tag}
            <button
              type="button"
              className="inbox-pill-remove"
              onClick={() => removeTag(i)}
            >
              &times;
            </button>
          </span>
        ))}
        <input
          type="text"
          className="inbox-pill-input"
          placeholder={placeholder || "Type and press Enter..."}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
}
