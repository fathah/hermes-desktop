/**
 * Shared types for the External Context Bridge — a local-first, opt-in, redacted
 * index of transcripts from *other* AI coding tools (Claude Code, Codex, Gemini,
 * Grok) so Hermes can act as the continuity layer across them.
 *
 * Everything here is pure data + formatting and is safe to import from both the
 * main process and the renderer (no Node/Electron/sqlite imports).
 */

/**
 * Sources discovered by a LIVE scan of a tool's local working directory
 * (append-only JSONL or whole-file rewrites). Each has a registered
 * {@link SourceAdapter} keyed by this subtype, so the registry stays exhaustive.
 */
export type ExternalScanSource = "claude-code" | "codex" | "gemini" | "grok";

/**
 * Sources ingested from a user-supplied EXPORT artifact (ZIP/JSON the user
 * downloads from the tool's web UI), copied to a content-hash import root and
 * then run through the same scan pipeline. `grok-export`/`gemini-takeout` are
 * named distinctly from the live `grok`/`gemini` scan sources they parallel.
 */
export type ExternalImportSource =
  | "chatgpt"
  | "claude-ai"
  | "grok-export"
  | "gemini-takeout";

/** The external AI tools whose transcripts we can index (scan + import). */
export type ExternalSource = ExternalScanSource | ExternalImportSource;

/** Live-scan sources, in stable order (the settings toggle list). */
export const EXTERNAL_SCAN_SOURCES: readonly ExternalScanSource[] = [
  "claude-code",
  "codex",
  "gemini",
  "grok",
] as const;

/** Import-only sources, in stable order (the Import tab in 3.6). */
export const EXTERNAL_IMPORT_SOURCES: readonly ExternalImportSource[] = [
  "chatgpt",
  "claude-ai",
  "grok-export",
  "gemini-takeout",
] as const;

/**
 * Every source, in stable order — used for config seeding, db rollups, and
 * search/digest filters. Scan sources first, then import sources.
 */
export const EXTERNAL_SOURCES: readonly ExternalSource[] = [
  ...EXTERNAL_SCAN_SOURCES,
  ...EXTERNAL_IMPORT_SOURCES,
] as const;

/** Human-facing labels for each source (UI + provenance lines). */
export const EXTERNAL_SOURCE_LABELS: Record<ExternalSource, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  gemini: "Gemini",
  grok: "Grok",
  chatgpt: "ChatGPT",
  "claude-ai": "Claude.ai",
  "grok-export": "Grok (export)",
  "gemini-takeout": "Gemini (Takeout)",
};

/**
 * One indexed external conversation. `convId` is the globally-unique key
 * `<source>:<conversationId>` and is what consumers reference.
 */
export interface ExternalConversationMeta {
  convId: string;
  source: ExternalSource;
  conversationId: string;
  projectPath: string | null;
  gitBranch: string | null;
  title: string | null;
  /** epoch ms of the first/last message, or null when unknown. */
  startedAt: number | null;
  lastAt: number | null;
  messageCount: number;
}

/** One full-text search hit — already redacted by the time it reaches a consumer. */
export interface ExternalSearchHit {
  convId: string;
  source: ExternalSource;
  conversationId: string;
  seq: number;
  role: string;
  ts: number | null;
  /** Redacted excerpt with `<b>`-free plain text (UI escapes it itself). */
  snippet: string;
  projectPath: string | null;
  gitBranch: string | null;
  title: string | null;
}

/** One message row when reading a conversation around a hit. */
export interface ExternalMessage {
  seq: number;
  role: string;
  ts: number | null;
  /** Redacted, capped message text. */
  text: string;
}

/** Per-source rollup shown in the settings view. */
export interface ExternalSourceStatus {
  source: ExternalSource;
  enabled: boolean;
  /** Whether the source's root directory exists on this machine. */
  available: boolean;
  conversations: number;
  messages: number;
  files: number;
}

/** Whole-index status surfaced to the renderer. */
export interface ExternalIndexStatus {
  sources: ExternalSourceStatus[];
  totalConversations: number;
  totalMessages: number;
  lastScanAt: number | null;
  scanning: boolean;
  /** Recency cap in days (only index sessions newer than this); null = all. */
  maxAgeDays: number | null;
}

/** Streaming progress event during a scan/backfill. */
export interface ExternalScanProgress {
  source: ExternalSource | null;
  phase: "start" | "scanning" | "done" | "error";
  filesProcessed: number;
  filesTotal: number;
  messagesIndexed: number;
  message?: string;
}

/** Per-source enabled flags (default all OFF). */
export type ExternalSourceConfig = Record<ExternalSource, boolean>;

/** The default config: every source disabled until the user opts in. */
export function defaultExternalSourceConfig(): ExternalSourceConfig {
  return {
    "claude-code": false,
    codex: false,
    gemini: false,
    grok: false,
    chatgpt: false,
    "claude-ai": false,
    "grok-export": false,
    "gemini-takeout": false,
  };
}

/** Fields a provenance line can be derived from. */
export interface ProvenanceFields {
  source: ExternalSource;
  projectPath?: string | null;
  gitBranch?: string | null;
  title?: string | null;
  ts?: number | null;
}

/** Render an ISO date (UTC, day precision) from epoch ms, or null. */
function formatDay(ts: number | null | undefined): string | null {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
  const iso = new Date(ts).toISOString();
  return iso.slice(0, 10);
}

/** Last path segment, so provenance stays short (no full filesystem paths). */
function projectName(projectPath: string | null | undefined): string | null {
  if (!projectPath) return null;
  const trimmed = projectPath.replace(/[/\\]+$/, "");
  const segments = trimmed.split(/[/\\]/);
  const last = segments[segments.length - 1];
  return last || trimmed || null;
}

/**
 * A single human-readable provenance line — NO URLs, deliberately terse. Used
 * verbatim in the UI viewer, the Save-to-KB `## Sources` section, and every MCP
 * response. The label makes the "this came from an external tool" boundary
 * obvious wherever an excerpt surfaces.
 */
export function formatProvenance(p: ProvenanceFields): string {
  const parts: string[] = [EXTERNAL_SOURCE_LABELS[p.source]];
  const project = projectName(p.projectPath);
  if (project) {
    parts.push(`project: ${project}`);
  }
  if (p.gitBranch) {
    parts.push(`branch: ${p.gitBranch}`);
  }
  const day = formatDay(p.ts);
  if (day) {
    parts.push(day);
  }
  if (p.title) {
    parts.push(`“${p.title}”`);
  }
  return parts.join(" · ");
}
