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
import { useVirtualizer } from "@tanstack/react-virtual";
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import { useVaultQuery, type VaultRow } from "../hooks/useNoteIndex";
import { rowFromMarkdown, rowToMarkdown } from "../editor/rowMarkdown";
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
  refreshSpsAutomationPrefs,
  setIngestIntervalMin,
} from "./ingestPrefs";
import { installVaultSkill } from "./vaultSkill";
import { splitDigestRows } from "./digest";
import { blk } from "../lib/ids";
import { pageIdFromPath } from "../lib/pageId";
import { pageFromMarkdown } from "../editor/pageMarkdown";
import { DEFAULT_WIKI_SCHEMA } from "../../../../../shared/wikiSchema";
import {
  buildVisualCaptureBody,
  visualCaptureExtFromPath,
  visualCaptureMimeFromPath,
  visualCaptureNameFromPath,
  visualCaptureTitle,
  type VisualCaptureOrigin,
} from "../../../../../shared/visual-capture";
import type { SpsRecentScreenshotCandidate } from "../../../../../shared/recent-screenshots";
import type {
  EmailMonitorAccount,
  EmailMonitorConfig,
  EmailMonitorFeedbackAction,
  EmailMonitorStatus,
} from "../../../../../shared/email-monitor";
import {
  DEFAULT_EMAIL_MONITOR_ACCOUNT,
  defaultPasswordEnvKey,
} from "../../../../../shared/email-monitor";
import { assetUrl } from "../lib/assets";
import { getScrollContainer } from "../lib/scroll";
import { ocrImageBlobToText } from "../lib/ocr";
import {
  appendVisualCaptureOcr,
  buildTeachCaptureCorpus,
  extractOcrText,
  isVisualCaptureProps,
  visualAssetPath,
} from "./visualCapture";

interface InboxSurfaceProps {
  profile?: string;
}

type Mode = "note" | "web" | "image" | "pdf";
type Tab = "inbox" | "settings" | "sources";

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

// Map the 5 triage labels onto the existing SPS chip variants (home.css) —
// no new color tokens; dark mode comes with the .chip filter for free.
const TRIAGE_CHIP_CLASS: Record<string, string> = {
  urgent: "p-high",
  action: "p-med",
  knowledge: "s-review",
  archive: "s-todo",
  ignore: "s-todo",
};

const FEEDBACK_ACTIONS: Array<{
  action: EmailMonitorFeedbackAction;
  title: string;
}> = [
  { action: "always-capture-sender", title: "Always capture sender" },
  { action: "raise-priority", title: "Raise priority" },
  { action: "not-relevant", title: "Not relevant" },
  { action: "ignore-sender", title: "Ignore sender" },
];

const TASKS_DB_FOLDER = "tasks";

function feedbackConfirmation(
  action: EmailMonitorFeedbackAction,
  sender: string,
): string {
  switch (action) {
    case "always-capture-sender":
      return `Will always capture mail from ${sender}.`;
    case "ignore-sender":
      return `Will ignore mail from ${sender}.`;
    case "not-relevant":
      return `Marked not relevant — future mail from ${sender} is skipped.`;
    case "raise-priority":
      return `Raised priority for ${sender}.`;
  }
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

function assistantReplyText(result: unknown): string {
  if (
    result &&
    typeof result === "object" &&
    "reply" in result &&
    Array.isArray((result as { reply?: unknown }).reply)
  ) {
    return (result as { reply: unknown[] }).reply.map(String).join("\n\n");
  }
  return typeof result === "string" ? result : JSON.stringify(result, null, 2);
}

function stringProp(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function emailCaptureTitle(row: VaultRow): string {
  return (
    stringProp(row.props.title) ||
    row.title.trim() ||
    "Email follow-up"
  ).slice(0, 120);
}

function buildEmailReplyUrl(row: VaultRow): string | null {
  const to = stringProp(row.props.emailFrom);
  if (!to) return null;
  const title = emailCaptureTitle(row);
  const subject = /^re:/i.test(title) ? title : `Re: ${title}`;
  const capturedAt = timeLabel(row.props.capturedAt);
  const params = new URLSearchParams({
    subject,
    body: [
      "",
      "",
      "---",
      `From SPS email capture${capturedAt ? ` (${capturedAt})` : ""}: ${title}`,
    ].join("\n"),
  });
  return `mailto:${encodeURIComponent(to)}?${params.toString()}`;
}

function buildEmailTaskDetail(row: VaultRow, captureBody: string): string {
  return [
    stringProp(row.props.emailFrom)
      ? `From: ${stringProp(row.props.emailFrom)}`
      : "",
    stringProp(row.props.emailAccount)
      ? `Account: ${stringProp(row.props.emailAccount)}`
      : "",
    stringProp(row.props.messageId)
      ? `Message-ID: ${stringProp(row.props.messageId)}`
      : "",
    captureBody.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
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
  const [imageNote, setImageNote] = useState("");
  const [noteKind, setNoteKind] = useState<SpsCaptureKind>("note");
  const [webKind, setWebKind] = useState<SpsCaptureKind>("source");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recentScreenshots, setRecentScreenshots] = useState<
    SpsRecentScreenshotCandidate[]
  >([]);
  const [recentScreenshotError, setRecentScreenshotError] = useState("");
  const [visualBusy, setVisualBusy] = useState("");
  const [rowBusy, setRowBusy] = useState<Record<string, string>>({});
  const [visualMarkdown, setVisualMarkdown] = useState<Record<string, string>>(
    {},
  );
  const [teachResults, setTeachResults] = useState<Record<string, string>>({});

  // Ingest review queue.
  const ingestCommitPage = useStore((s) => s.ingestCommitPage);
  const flash = useStore((s) => s.flash);
  const setSurface = useStore((s) => s.setSurface);
  const importPdf = useStore((s) => s.importPdf);
  const saveStudyToWiki = useStore((s) => s.saveStudyToWiki);
  const pendingInboxMode = useStore((s) => s.pendingInboxMode);
  const clearPendingInboxMode = useStore((s) => s.clearPendingInboxMode);
  const [ingesting, setIngesting] = useState(false);
  const [changeset, setChangeset] = useState<Changeset | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [skipMem, setSkipMem] = useState<Set<number>>(new Set());
  const [autoApply, setAutoApplyState] = useState(() => getAutoApply());
  const [intervalMin, setIntervalMin] = useState(() => getIngestIntervalMin());

  useEffect(() => {
    let cancelled = false;
    void refreshSpsAutomationPrefs(profile).then((prefs) => {
      if (cancelled) return;
      setAutoApplyState(prefs.autoApply);
      setIntervalMin(prefs.ingestIntervalMin);
    });
    return () => {
      cancelled = true;
    };
  }, [profile]);

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
  const [emailConfig, setEmailConfig] = useState<EmailMonitorConfig | null>(
    null,
  );
  const [emailStatus, setEmailStatus] = useState<EmailMonitorStatus | null>(
    null,
  );
  const [emailRuleSender, setEmailRuleSender] = useState("");
  const [emailBusy, setEmailBusy] = useState("");
  const [emailError, setEmailError] = useState("");
  // Capture card whose "triage is wrong" menu is open (page id, "" = none).
  const [feedbackMenuFor, setFeedbackMenuFor] = useState("");
  const [digestOpen, setDigestOpen] = useState(false);
  // Account edits (add/remove/field/enable) are staged locally; "Save changes"
  // persists the whole config through spsEmailMonitorSaveConfig.
  const [emailDirty, setEmailDirty] = useState(false);

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

  const loadEmailMonitor = useCallback(async (): Promise<void> => {
    const api = window.hermesAPI;
    if (!api?.spsEmailMonitorGetConfig || !api?.spsEmailMonitorGetStatus) {
      setEmailError("Email monitor is unavailable.");
      return;
    }
    setEmailError("");
    try {
      const [config, status] = await Promise.all([
        api.spsEmailMonitorGetConfig(profile),
        api.spsEmailMonitorGetStatus(profile),
      ]);
      setEmailConfig(config);
      setEmailStatus(status);
      setEmailDirty(false);
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : String(e));
    }
  }, [profile]);

  useEffect(() => {
    if (activeTab !== "sources") return;
    void loadEmailMonitor();
  }, [activeTab, loadEmailMonitor]);

  useEffect(() => {
    if (pendingInboxMode !== "image") return;
    setActiveTab("inbox");
    setMode("image");
    clearPendingInboxMode();
  }, [pendingInboxMode, clearPendingInboxMode]);

  useEffect(() => {
    let cancelled = false;
    if (mode !== "image") return;
    setRecentScreenshotError("");
    window.hermesAPI
      ?.spsListRecentScreenshots?.(profile)
      .then((items) => {
        if (!cancelled) setRecentScreenshots(items ?? []);
      })
      .catch((e) => {
        if (!cancelled) {
          setRecentScreenshots([]);
          setRecentScreenshotError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mode, profile]);

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
  // Digest captures render inside one collapsible "Newsletters" card; only the
  // normal rows go through the virtualizer.
  const { normal: nonDigest, digest: digestRows } = splitDigestRows(visible);
  const inboxVirtualizer = useVirtualizer({
    count: nonDigest.length,
    getScrollElement: getScrollContainer,
    estimateSize: () => 112,
    overscan: 8,
    getItemKey: (index) => nonDigest[index]?.path ?? index,
  });

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

  const saveVisualCapture = useCallback(
    async (input: {
      source: "image" | "screenshot";
      assetPath: string;
      originalName: string;
      captureOrigin: VisualCaptureOrigin;
      mime: string;
      note?: string;
    }) => {
      setVisualBusy(input.captureOrigin);
      setError("");
      try {
        const capturedAt = Date.now();
        const captureTitle =
          title.trim() ||
          visualCaptureTitle({
            captureOrigin: input.captureOrigin,
            originalName: input.originalName,
            capturedAt,
          });
        const { id, markdown } = buildCapture({
          source: input.source,
          body: buildVisualCaptureBody({
            assetPath: input.assetPath,
            originalName: input.originalName,
            note: input.note,
          }),
          title: captureTitle,
          via: "user",
          capturedAt,
          captureKind: "source",
          schema: "source",
          provenance: "SPS inbox visual capture",
          assetPath: input.assetPath,
          originalName: input.originalName,
          mime: input.mime,
          captureOrigin: input.captureOrigin,
          ocrStatus: "not-run",
        });
        await writeCapture(markdown, id);
        setTitle("");
        setImageNote("");
        reconcile();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setVisualBusy("");
      }
    },
    [title, writeCapture, reconcile],
  );

  const chooseImageFile = useCallback(async () => {
    const api = window.hermesAPI;
    const picked = await api?.spsPickImage?.();
    if (!picked) return;
    const bytes = await api.spsReadFileBytes(picked);
    const ext = visualCaptureExtFromPath(picked);
    const assetPath = await api.spsAssetWrite(bytes, ext, profile);
    await saveVisualCapture({
      source: "image",
      assetPath,
      originalName: visualCaptureNameFromPath(picked),
      captureOrigin: "file",
      mime: visualCaptureMimeFromPath(picked),
      note: imageNote,
    });
  }, [imageNote, profile, saveVisualCapture]);

  const captureScreen = useCallback(async () => {
    const name = await window.hermesAPI?.spsTriggerScreencapture?.();
    if (!name) return;
    await saveVisualCapture({
      source: "screenshot",
      assetPath: name,
      originalName: name,
      captureOrigin: "screen-snippet",
      mime: visualCaptureMimeFromPath(name),
      note: imageNote,
    });
  }, [imageNote, saveVisualCapture]);

  const importClipboardScreenshot = useCallback(async () => {
    setVisualBusy("clipboard");
    setError("");
    try {
      const result = await window.hermesAPI?.spsImportClipboardScreenshot?.(
        { note: imageNote },
        profile,
      );
      if (!result) throw new Error("Clipboard import is unavailable.");
      if (!result.ok) throw new Error(result.error);
      setImageNote("");
      reconcile();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setVisualBusy("");
    }
  }, [imageNote, profile, reconcile]);

  const importRecentScreenshot = useCallback(
    async (candidateId?: string) => {
      setVisualBusy(candidateId || "recent-file");
      setError("");
      try {
        const result = await window.hermesAPI?.spsImportRecentScreenshot?.(
          { candidateId, note: imageNote },
          profile,
        );
        if (!result)
          throw new Error("Recent screenshot import is unavailable.");
        if (!result.ok) throw new Error(result.error);
        setImageNote("");
        reconcile();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setVisualBusy("");
      }
    },
    [imageNote, profile, reconcile],
  );

  const readVisualMarkdown = useCallback(
    async (row: VaultRow): Promise<string | null> => {
      const id = pageIdFromPath(row.path);
      if (visualMarkdown[id]) return visualMarkdown[id];
      return (
        (await window.hermesAPI?.spsReadRow?.(INBOX_FOLDER, id, profile)) ??
        null
      );
    },
    [profile, visualMarkdown],
  );

  const extractVisualText = useCallback(
    async (row: VaultRow): Promise<string | null> => {
      const id = pageIdFromPath(row.path);
      const assetPath = visualAssetPath(row.props);
      if (!assetPath) return null;
      setRowBusy((prev) => ({ ...prev, [id]: "Extracting text..." }));
      setError("");
      try {
        const current = await readVisualMarkdown(row);
        if (current == null) throw new Error("Could not read this capture.");
        const response = await fetch(assetUrl(assetPath));
        const blob = await response.blob();
        const text = await ocrImageBlobToText(blob);
        const next = appendVisualCaptureOcr(
          current,
          text,
          text.trim() ? "complete" : "failed",
        );
        await window.hermesAPI?.spsExportRow?.(INBOX_FOLDER, id, next, profile);
        setVisualMarkdown((prev) => ({ ...prev, [id]: next }));
        reconcile();
        return next;
      } catch (e) {
        const current = await readVisualMarkdown(row).catch(() => null);
        if (current) {
          const failed = appendVisualCaptureOcr(current, "", "failed");
          await window.hermesAPI?.spsExportRow?.(
            INBOX_FOLDER,
            id,
            failed,
            profile,
          );
          setVisualMarkdown((prev) => ({ ...prev, [id]: failed }));
        }
        setError(
          e instanceof Error
            ? `OCR failed: ${e.message}`
            : "OCR failed on this capture.",
        );
        return current;
      } finally {
        setRowBusy((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [profile, readVisualMarkdown, reconcile],
  );

  const teachVisualCapture = useCallback(
    async (row: VaultRow): Promise<void> => {
      const id = pageIdFromPath(row.path);
      setRowBusy((prev) => ({ ...prev, [id]: "Teaching..." }));
      setError("");
      try {
        let markdown = await readVisualMarkdown(row);
        if (!markdown) throw new Error("Could not read this capture.");
        if (!extractOcrText(markdown)) {
          const withOcr = await extractVisualText(row);
          if (withOcr) markdown = withOcr;
        }
        const titleText = String(row.props.title ?? row.title ?? "");
        const result = await window.hermesAPI?.spsTeachCapture?.(
          {
            captureId: id,
            title: titleText,
            corpusDescription: buildTeachCaptureCorpus({
              captureId: id,
              title: titleText,
              markdown,
            }),
          },
          profile,
        );
        setTeachResults((prev) => ({
          ...prev,
          [id]: assistantReplyText(result),
        }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRowBusy((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [extractVisualText, profile, readVisualMarkdown],
  );

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

  const applyEmailFeedback = useCallback(
    async (
      accountId: string,
      action: EmailMonitorFeedbackAction,
    ): Promise<void> => {
      const value = emailRuleSender.trim();
      if (!value) return;
      setEmailBusy(action);
      setEmailError("");
      try {
        const feedback =
          action === "raise-priority"
            ? { accountId, action, keyword: value }
            : { accountId, action, sender: value };
        const config = await window.hermesAPI.spsEmailMonitorApplyFeedback(
          feedback,
          profile,
        );
        setEmailConfig(config);
        setEmailRuleSender("");
      } catch (e) {
        setEmailError(e instanceof Error ? e.message : String(e));
      } finally {
        setEmailBusy("");
      }
    },
    [emailRuleSender, profile],
  );

  // Card-level "the triage was wrong" feedback: resolves the capture's account
  // and sender from its frontmatter, so it works without the Sources tab ever
  // having been opened (config is fetched lazily on first use).
  const sendCaptureFeedback = useCallback(
    async (
      row: VaultRow,
      action: EmailMonitorFeedbackAction,
    ): Promise<void> => {
      const id = pageIdFromPath(row.path);
      const sender =
        typeof row.props.emailFrom === "string"
          ? row.props.emailFrom.trim()
          : "";
      setFeedbackMenuFor("");
      if (!sender) {
        flash("This capture has no sender recorded — use the Sources tab.");
        return;
      }
      setRowBusy((prev) => ({ ...prev, [id]: "Updating email rules…" }));
      try {
        const config =
          emailConfig ??
          (await window.hermesAPI.spsEmailMonitorGetConfig(profile));
        const propAccountId =
          typeof row.props.emailAccountId === "string"
            ? row.props.emailAccountId
            : "";
        // Pre-Slice-4 captures only carry the account label; fall back to it.
        const labelMatch = config.accounts.find(
          (account) => account.label === row.props.emailAccount,
        );
        const accountId = propAccountId || labelMatch?.id || "";
        if (!accountId) {
          flash("Could not match this capture to an email account.");
          return;
        }
        const updated = await window.hermesAPI.spsEmailMonitorApplyFeedback(
          { accountId, action, sender },
          profile,
        );
        setEmailConfig(updated);
        flash(feedbackConfirmation(action, sender));
      } catch (e) {
        flash(e instanceof Error ? e.message : String(e));
      } finally {
        setRowBusy((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [emailConfig, profile, flash],
  );

  const draftEmailReply = useCallback(
    async (row: VaultRow): Promise<void> => {
      const id = pageIdFromPath(row.path);
      const url = buildEmailReplyUrl(row);
      if (!url) {
        flash("This capture has no sender address.");
        return;
      }
      setRowBusy((prev) => ({ ...prev, [id]: "Opening reply draft..." }));
      setError("");
      try {
        await window.hermesAPI.openExternal(url);
        flash("Draft reply opened.");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRowBusy((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [flash],
  );

  const createTaskFromEmail = useCallback(
    async (row: VaultRow): Promise<void> => {
      const api = window.hermesAPI;
      const id = pageIdFromPath(row.path);
      if (
        !api?.spsReadRow ||
        !api.spsExportRow ||
        !api.spsClassifyTask ||
        !api.spsRouteTask
      ) {
        setError("Task capture is unavailable.");
        return;
      }
      setRowBusy((prev) => ({ ...prev, [id]: "Creating task..." }));
      setError("");
      try {
        const current = await api.spsReadRow(INBOX_FOLDER, id, profile);
        if (current == null) throw new Error("Could not read this capture.");
        const { body: captureBody } = rowFromMarkdown(current);
        const titleText = emailCaptureTitle(row);
        const detail = buildEmailTaskDetail(row, captureBody);
        const taskText = [titleText, detail].filter(Boolean).join("\n\n");
        const rowId = `task-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        const draft = rowToMarkdown(
          {
            title: titleText,
            status: "inbox",
            source: "email",
            captureId: id,
          },
          detail,
        );
        const saved = await api.spsExportRow(
          TASKS_DB_FOLDER,
          rowId,
          draft,
          profile,
        );
        if (!saved) throw new Error("Could not create the task row.");

        const triage = await api.spsClassifyTask(taskText, profile);
        const outcome = await api.spsRouteTask(
          { rowId, title: titleText, body: detail, triage },
          profile,
        );
        const props: Record<string, unknown> = {
          title: titleText,
          status: outcome.status,
          route: outcome.route,
          source: "email",
          captureId: id,
        };
        if (triage.assigneeId) {
          props.assigneeId = triage.assigneeId;
          props.who = triage.assigneeId;
        }
        if (triage.due) props.due = triage.due;
        if (outcome.delegatedTo) props.delegatedTo = outcome.delegatedTo;
        await api.spsExportRow(
          TASKS_DB_FOLDER,
          rowId,
          rowToMarkdown(props, detail),
          profile,
        );
        await api.spsExportRow(
          INBOX_FOLDER,
          id,
          withStatus(current, "processed"),
          profile,
        );
        setHidden((prev) => new Set(prev).add(row.path));
        flash("Created task from email.");
        reconcile();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRowBusy((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [profile, flash, reconcile],
  );

  const runEmailMonitor = useCallback(async (): Promise<void> => {
    setEmailBusy("run");
    setEmailError("");
    try {
      const result = await window.hermesAPI.spsEmailMonitorRunNow(profile);
      setEmailStatus({ running: false, accounts: result.accounts });
      if (!result.ok && result.error) setEmailError(result.error);
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : String(e));
    } finally {
      setEmailBusy("");
    }
  }, [profile]);

  // Patch a single staged account by list index (new accounts share the empty
  // id until save, so index — not id — is the stable editing handle here).
  const updateEmailAccount = useCallback(
    (index: number, patch: Partial<EmailMonitorAccount>): void => {
      setEmailConfig((prev) => {
        if (!prev) return prev;
        const accounts = prev.accounts.map((account, i) =>
          i === index ? { ...account, ...patch } : account,
        );
        return { ...prev, accounts };
      });
      setEmailDirty(true);
    },
    [],
  );

  const addEmailAccount = useCallback((): void => {
    setEmailConfig((prev) => {
      const base = prev ?? { accounts: [] };
      const account: EmailMonitorAccount = {
        ...DEFAULT_EMAIL_MONITOR_ACCOUNT,
        // Empty id → normalizeEmailMonitorConfig derives it from the address on
        // save; empty key → a distinct per-account password key is assigned.
        id: "",
        label: "New account",
        emailAddress: "",
        username: "",
        imapHost: "",
        passwordEnvKey: "",
        enabled: false,
      };
      return { ...base, accounts: [...base.accounts, account] };
    });
    setEmailDirty(true);
  }, []);

  const removeEmailAccount = useCallback((index: number): void => {
    setEmailConfig((prev) => {
      if (!prev) return prev;
      const accounts = prev.accounts.filter((_, i) => i !== index);
      return { ...prev, accounts };
    });
    setEmailDirty(true);
  }, []);

  const saveEmailConfig = useCallback(async (): Promise<void> => {
    if (!emailConfig) return;
    setEmailBusy("save");
    setEmailError("");
    try {
      const saved = await window.hermesAPI.spsEmailMonitorSaveConfig(
        emailConfig,
        profile,
      );
      setEmailConfig(saved);
      setEmailDirty(false);
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : String(e));
    } finally {
      setEmailBusy("");
    }
  }, [emailConfig, profile]);

  const toggleSkipMem = (i: number): void =>
    setSkipMem((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const canCapture =
    mode === "note"
      ? body.trim().length > 0
      : mode === "web"
        ? url.trim().length > 0
        : false;

  const renderInboxCard = (row: VaultRow): React.JSX.Element => {
    const id = pageIdFromPath(row.path);
    const isVisual = isVisualCaptureProps(row.props);
    const isEmail = row.props.source === "email";
    const triageLabel =
      typeof row.props.triageLabel === "string" ? row.props.triageLabel : "";
    const triageReason =
      typeof row.props.triageReason === "string" ? row.props.triageReason : "";
    const confidenceTitle =
      typeof row.props.triageConfidence === "number"
        ? `Confidence ${Math.round(row.props.triageConfidence * 100)}%`
        : undefined;
    return (
      <div className="inbox-card">
        <div className="inbox-card-content">
          <div className="inbox-card-title">
            {String(row.props.title ?? "Untitled capture")}
          </div>
          <div className="inbox-card-meta">
            <span className="inbox-source-capitalize">
              {String(row.props.source ?? "note")}
            </span>
            {triageLabel && (
              <span
                className={`chip ${TRIAGE_CHIP_CLASS[triageLabel] ?? "s-todo"}`}
                title={confidenceTitle}
              >
                {triageLabel}
              </span>
            )}
            <span>·</span>
            <span>{timeLabel(row.props.capturedAt)}</span>
            {typeof row.props.ocrStatus === "string" && (
              <>
                <span>·</span>
                <span>OCR {row.props.ocrStatus}</span>
              </>
            )}
          </div>
          {triageReason && (
            <div className="inbox-row-status">{triageReason}</div>
          )}
          {feedbackMenuFor === id && (
            <div className="inbox-teach-actions">
              {FEEDBACK_ACTIONS.map(({ action, title }) => (
                <button
                  key={action}
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={Boolean(rowBusy[id])}
                  onClick={() => void sendCaptureFeedback(row, action)}
                >
                  {title}
                </button>
              ))}
            </div>
          )}
          {rowBusy[id] && <div className="inbox-row-status">{rowBusy[id]}</div>}
          {teachResults[id] && (
            <div className="inbox-teach-result">
              <pre>{teachResults[id]}</pre>
              <div className="inbox-teach-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() =>
                    void saveStudyToWiki(
                      String(row.props.title ?? "Visual capture"),
                      teachResults[id],
                    )
                  }
                >
                  Save as study page
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    void navigator.clipboard?.writeText?.(teachResults[id])
                  }
                >
                  Copy
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    setTeachResults((prev) => {
                      const next = { ...prev };
                      delete next[id];
                      return next;
                    })
                  }
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>
        {isVisual && (
          <>
            <button
              title="Extract text"
              className="btn btn-ghost btn-sm inbox-card-action-btn"
              disabled={Boolean(rowBusy[id])}
              onClick={() => void extractVisualText(row)}
            >
              Extract text
            </button>
            <button
              title="Teach this"
              className="btn btn-ghost btn-sm inbox-card-action-btn"
              disabled={Boolean(rowBusy[id])}
              onClick={() => void teachVisualCapture(row)}
            >
              Teach this
            </button>
          </>
        )}
        {isEmail && (
          <>
            <button
              title="Draft reply"
              className="btn btn-ghost btn-sm inbox-card-action-btn"
              disabled={Boolean(rowBusy[id])}
              onClick={() => void draftEmailReply(row)}
            >
              <Icon name="send" size={15} />
            </button>
            <button
              title="Create task"
              className="btn btn-ghost btn-sm inbox-card-action-btn"
              disabled={Boolean(rowBusy[id])}
              onClick={() => void createTaskFromEmail(row)}
            >
              <Icon name="list" size={15} />
            </button>
            <button
              title="Triage is wrong…"
              className="btn btn-ghost btn-sm inbox-card-action-btn"
              disabled={Boolean(rowBusy[id])}
              onClick={() =>
                setFeedbackMenuFor((prev) => (prev === id ? "" : id))
              }
            >
              <Icon name="flag" size={15} />
            </button>
          </>
        )}
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
      </div>
    );
  };

  const renderEmailSources = (): React.JSX.Element => {
    const accounts = emailConfig?.accounts ?? [];
    return (
      <section className="inbox-section">
        <div className="inbox-flex-align-center-gap8-mb10-bold">
          <span>Email sources</span>
          <span className="flex-grow" />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={Boolean(emailBusy)}
            onClick={() => addEmailAccount()}
          >
            Add account
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!emailDirty || Boolean(emailBusy)}
            onClick={() => void saveEmailConfig()}
          >
            {emailBusy === "save" ? "Saving..." : "Save changes"}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={emailBusy === "run"}
            onClick={() => void runEmailMonitor()}
          >
            {emailBusy === "run" ? "Checking..." : "Check now"}
          </button>
        </div>

        {emailError && <div className="inbox-error">{emailError}</div>}
        {emailDirty && (
          <div className="inbox-row-status">
            Unsaved account changes — click “Save changes” to apply.
          </div>
        )}

        {accounts.length === 0 ? (
          <div className="inbox-empty-notice">
            No email accounts configured. Click “Add account” to connect one.
          </div>
        ) : (
          <ul className="inbox-card-list">
            {accounts.map((account, index) => {
              const accountStatus = account.id
                ? emailStatus?.accounts.find(
                    (status) => status.accountId === account.id,
                  )
                : undefined;
              const derivedKey = defaultPasswordEnvKey(
                account.emailAddress || account.id,
                index,
              );
              return (
                <li key={index} className="inbox-card">
                  <div className="inbox-card-content">
                    <div className="inbox-card-meta">
                      <span>{accountStatus?.state ?? "not saved"}</span>
                      <span>·</span>
                      <span>{accountStatus?.captured ?? 0} captured</span>
                      <span>·</span>
                      <span>{accountStatus?.skipped ?? 0} skipped</span>
                    </div>
                    {accountStatus?.lastError && (
                      <div className="inbox-row-status">
                        {accountStatus.lastError}
                      </div>
                    )}
                    <label className="inbox-flex-align-center-gap8-mb10-bold">
                      <input
                        type="checkbox"
                        checked={account.enabled}
                        onChange={(e) =>
                          updateEmailAccount(index, {
                            enabled: e.target.checked,
                          })
                        }
                      />
                      Enabled (polls this account on the schedule)
                    </label>
                    <label className="inbox-flex-align-center-gap8-mb10-bold">
                      <input
                        type="checkbox"
                        checked={account.digestBulk === true}
                        onChange={(e) =>
                          updateEmailAccount(index, {
                            digestBulk: e.target.checked,
                          })
                        }
                      />
                      Capture newsletters into a digest (instead of skipping
                      bulk mail)
                    </label>
                    <label className="settings-field-label">
                      Label
                      <input
                        className="inbox-input"
                        value={account.label}
                        onChange={(e) =>
                          updateEmailAccount(index, { label: e.target.value })
                        }
                        placeholder="Work inbox"
                      />
                    </label>
                    <label className="settings-field-label">
                      Email address
                      <input
                        className="inbox-input"
                        value={account.emailAddress}
                        onChange={(e) =>
                          updateEmailAccount(index, {
                            emailAddress: e.target.value,
                            username: e.target.value,
                          })
                        }
                        placeholder="you@example.com"
                      />
                    </label>
                    <label className="settings-field-label">
                      IMAP host
                      <input
                        className="inbox-input"
                        value={account.imapHost}
                        onChange={(e) =>
                          updateEmailAccount(index, {
                            imapHost: e.target.value,
                          })
                        }
                        placeholder="imap.gmail.com"
                      />
                    </label>
                    <label className="settings-field-label">
                      IMAP port
                      <input
                        className="inbox-input"
                        type="number"
                        value={account.imapPort ?? 993}
                        onChange={(e) =>
                          updateEmailAccount(index, {
                            imapPort: Number(e.target.value) || 993,
                          })
                        }
                        placeholder="993"
                      />
                    </label>
                    <label className="settings-field-label">
                      Password env var
                      <input
                        className="inbox-input"
                        value={account.passwordEnvKey ?? ""}
                        onChange={(e) =>
                          updateEmailAccount(index, {
                            passwordEnvKey: e.target.value,
                          })
                        }
                        placeholder={derivedKey}
                      />
                    </label>
                    {accountStatus && (
                      <>
                        <label className="settings-field-label">
                          Sender rule
                          <input
                            className="inbox-input"
                            value={emailRuleSender}
                            onChange={(e) => setEmailRuleSender(e.target.value)}
                            placeholder="person@example.com or keyword"
                          />
                        </label>
                        <div className="inbox-btn-group">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={Boolean(emailBusy)}
                            onClick={() =>
                              void applyEmailFeedback(
                                account.id,
                                "always-capture-sender",
                              )
                            }
                          >
                            Always capture sender
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={Boolean(emailBusy)}
                            onClick={() =>
                              void applyEmailFeedback(
                                account.id,
                                "ignore-sender",
                              )
                            }
                          >
                            Ignore sender
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={Boolean(emailBusy)}
                            onClick={() =>
                              void applyEmailFeedback(
                                account.id,
                                "raise-priority",
                              )
                            }
                          >
                            Raise priority
                          </button>
                        </div>
                      </>
                    )}
                    <div className="inbox-btn-group">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={Boolean(emailBusy)}
                        onClick={() => removeEmailAccount(index)}
                      >
                        Remove account
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  };

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
        <button
          className={`inbox-tab-btn ${activeTab === "sources" ? "active" : ""}`}
          onClick={() => setActiveTab("sources")}
        >
          Sources
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
                className={`nav-item inbox-flex-no-shrink ${mode === "image" ? "active" : ""}`}
                onClick={() => setMode("image")}
              >
                <Icon name="file" size={15} />
                <span className="nav-label">Image</span>
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

            {(mode === "note" || mode === "web") && (
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
            ) : mode === "image" ? (
              <div className="inbox-image-capture">
                <textarea
                  className="inbox-textarea inbox-textarea-resize"
                  aria-label="Image note"
                  placeholder="Optional note for the image capture"
                  value={imageNote}
                  onChange={(e) => setImageNote(e.target.value)}
                  rows={3}
                />
                <div className="inbox-image-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={Boolean(visualBusy)}
                    onClick={() => void captureScreen()}
                    title="Capture a screen snippet"
                  >
                    Capture screen
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={Boolean(visualBusy)}
                    onClick={() => void importClipboardScreenshot()}
                    title="Import an image from the clipboard"
                  >
                    Import from clipboard
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={Boolean(visualBusy)}
                    onClick={() => void chooseImageFile()}
                    title="Choose a local image file"
                  >
                    Choose image file
                  </button>
                </div>
                <div className="inbox-recent-screenshots">
                  <div className="inbox-recent-title">Recent screenshots</div>
                  {recentScreenshotError ? (
                    <div className="inbox-empty-notice">
                      {recentScreenshotError}
                    </div>
                  ) : recentScreenshots.length === 0 ? (
                    <div className="inbox-empty-notice">
                      No recent screenshots found.
                    </div>
                  ) : (
                    <div className="inbox-recent-list">
                      {recentScreenshots.map((shot) => (
                        <button
                          key={shot.id}
                          type="button"
                          className="btn btn-ghost btn-sm inbox-recent-item"
                          disabled={Boolean(visualBusy)}
                          onClick={() => void importRecentScreenshot(shot.id)}
                          title={`Import ${shot.originalName}`}
                        >
                          {shot.previewDataUrl && (
                            <img
                              src={shot.previewDataUrl}
                              alt=""
                              className="inbox-recent-thumb"
                            />
                          )}
                          <span>{shot.originalName}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="inbox-pdf-dropzone">
                <Icon name="doc" size={32} className="inbox-pdf-icon" />
                <div className="inbox-pdf-desc">
                  Import a local PDF to extract and ingest it as a wiki source
                  page.
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

            {(mode === "note" || mode === "web") && (
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
                  setAutoApply(e.target.checked, profile);
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
                  setIngestIntervalMin(m, profile);
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
                enable auto-apply for scheduled runs
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
                            title={
                              skipped ? "Include this page" : "Skip this page"
                            }
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
                            title={
                              skipped ? "Remember this fact" : "Skip this fact"
                            }
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

          {digestRows.length > 0 && (
            <div className="inbox-card">
              <div className="inbox-card-content">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setDigestOpen((v) => !v)}
                  title={
                    digestOpen ? "Collapse newsletters" : "Expand newsletters"
                  }
                >
                  {digestOpen ? "▾" : "▸"} Newsletters ({digestRows.length})
                </button>
                {digestOpen && (
                  <ul className="inbox-card-list">
                    {digestRows.map((row) => (
                      <li key={row.path}>{renderInboxCard(row)}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {visible.length === 0 ? (
            <div className="inbox-empty-notice">
              Nothing waiting. Captures you add land here.
            </div>
          ) : nonDigest.length === 0 ? null : (
            <ul
              className={`inbox-card-list ${
                getScrollContainer() ? "inbox-card-list-virtual" : ""
              }`}
              style={
                getScrollContainer()
                  ? { height: `${inboxVirtualizer.getTotalSize()}px` }
                  : undefined
              }
            >
              {getScrollContainer()
                ? inboxVirtualizer.getVirtualItems().map((virtualRow) => {
                    const row = nonDigest[virtualRow.index];
                    return (
                      <li
                        key={virtualRow.key}
                        className="inbox-card-virtual-row"
                        data-index={virtualRow.index}
                        ref={inboxVirtualizer.measureElement}
                        style={{
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        {renderInboxCard(row)}
                      </li>
                    );
                  })
                : nonDigest.map((row) => (
                    <li key={row.path}>{renderInboxCard(row)}</li>
                  ))}
            </ul>
          )}
        </>
      ) : activeTab === "sources" ? (
        renderEmailSources()
      ) : (
        /* Settings Tab */
        <section className="inbox-section inbox-settings-section">
          <div className="type-h3 inbox-settings-title">
            News Curator Preferences
          </div>

          {settingsError && (
            <div className="inbox-settings-error-text">{settingsError}</div>
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

          <div className="inbox-btn-group inbox-settings-actions-btn-group">
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
