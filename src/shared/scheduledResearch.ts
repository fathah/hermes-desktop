// scheduledResearch.ts (shared) — pure types + scheduling logic for the
// Scheduled Research feature. No Electron/node imports so it runs in both
// typecheck projects and under vitest. The main process owns persistence + the
// gateway calls; this module owns the testable "is it due" + validation logic.

import type { ExternalSource } from "./external-context";

export type Cadence = "daily" | "weekly" | "monthly";

/** What a schedule produces: a web-research page (default) or a digest of the
 *  user's external AI-tool sessions over the period. */
export type ScheduleKind = "research" | "digest";

export const SOURCE_INTENTS = [
  "all",
  "web",
  "rss",
  "substack",
  "social",
] as const;
export type SourceIntent = (typeof SOURCE_INTENTS)[number];

export const MONITOR_SOURCE_KINDS = [
  "web",
  "rss",
  "substack",
  "social",
] as const;
export type MonitorSourceKind = (typeof MONITOR_SOURCE_KINDS)[number];

export const MONITOR_SOURCE_STATUSES = [
  "suggested",
  "approved",
  "ignored",
  "unavailable",
] as const;
export type MonitorSourceStatus = (typeof MONITOR_SOURCE_STATUSES)[number];

export const IMPORTANCE_THRESHOLDS = [
  "digest",
  "noteworthy",
  "breaking",
] as const;
export type ImportanceThreshold = (typeof IMPORTANCE_THRESHOLDS)[number];

export const TELEGRAM_MODES = ["summary-only"] as const;
export type TelegramMode = (typeof TELEGRAM_MODES)[number];

export interface TelegramDeliveryStatus {
  available: boolean;
  reason: "configured" | "missing-channel";
  message: string;
}

export interface MonitorSourceEntry {
  id: string;
  kind: MonitorSourceKind;
  label: string;
  url?: string;
  query?: string;
  status: MonitorSourceStatus;
  lastCheckedAt?: number;
  note?: string;
}

export interface MonitorDiscoveryInput {
  topic: string;
  sourceIntent?: SourceIntent;
  existingPlan?: MonitorSourceEntry[];
}

export interface MonitorDiscoveryResult {
  topic: string;
  sourceIntent: SourceIntent;
  prompt: string;
  candidates: MonitorSourceEntry[];
  warnings: string[];
}

/** Optional scoping for a digest schedule (which external sources/project). */
export interface DigestScope {
  source?: ExternalSource;
  project?: string;
}

export interface ScheduledResearchItem {
  id: string;
  /** What this schedule produces. Absent ⇒ "research" (back-compat). */
  kind?: ScheduleKind;
  /** Digest-only: limit the summarized sessions to a source/project. */
  scope?: DigestScope;
  /** Monitor-only: source family to prefer while researching this beat. */
  sourceIntent?: SourceIntent;
  /** Monitor-only: user-reviewed source/query candidates. */
  sourcePlan?: MonitorSourceEntry[];
  /** Monitor-only: minimum importance for push delivery. */
  importanceThreshold?: ImportanceThreshold;
  /** Monitor-only: request Telegram push for important changes. */
  telegramPush?: boolean;
  /** Monitor-only v1: Telegram sends only a short summary. */
  telegramMode?: TelegramMode;
  /** Free-text research topic (research kind). For a digest this is a label. */
  topic: string;
  /** Slug of the living wiki page this schedule keeps current. */
  pageId: string;
  cadence: Cadence;
  /** Local hour-of-day (0–23) at/after which a due run may fire. */
  hour: number;
  /** MVP default false: the merge waits in the pending queue for review. */
  autoApply: boolean;
  enabled: boolean;
  createdAt: number;
  /** Epoch ms of the last completed run (0 = never run). */
  lastRunAt: number;
  /** Last persistent run-level failure, cleared by the next non-error run. */
  lastError?: string;
  /** Hash of the last committed brief — a cheap dedupe gate. */
  lastChangeHash: string;
  /** v2: the paired Hermes gateway cron job that runs this app-closed. Empty
   *  when no cron is linked (then the desktop isDue fallback fires it app-open). */
  cronJobId?: string;
  /** v2: epoch ms of the newest cron-output brief already drained (so we don't
   *  re-merge old deliveries). */
  lastDrainedAt?: number;
}

/** Input shape for creating/updating a schedule (the user-controlled fields). */
export interface ScheduleInput {
  topic: string;
  cadence: Cadence;
  hour?: number;
  autoApply?: boolean;
  kind?: ScheduleKind;
  scope?: DigestScope;
  sourceIntent?: SourceIntent;
  sourcePlan?: MonitorSourceEntry[];
  importanceThreshold?: ImportanceThreshold;
  telegramPush?: boolean;
  telegramMode?: TelegramMode;
}

export const MAX_SCHEDULES = 25;
export const CADENCES: Cadence[] = ["daily", "weekly", "monthly"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeHttpUrl(value: unknown): string | undefined {
  let raw = asString(value).trim();
  if (!raw) return undefined;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:[/:?#]|$)/.test(raw)) {
      raw = `https://${raw}`;
    } else {
      return undefined;
    }
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    let normalized = url.toString();
    if (url.pathname !== "/" && normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return undefined;
  }
}

function normalizeQuery(value: unknown): string | undefined {
  const query = asString(value).replace(/\s+/g, " ").trim();
  return query ? query.slice(0, 240) : undefined;
}

function simpleHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function sourceId(kind: MonitorSourceKind, value: string): string {
  return `${kind}_${simpleHash(`${kind}:${value}`)}`;
}

function titleCaseKind(kind: MonitorSourceKind): string {
  if (kind === "rss") return "RSS";
  if (kind === "substack") return "Substack";
  if (kind === "social") return "Social";
  return "Web";
}

function defaultSourceLabel(
  kind: MonitorSourceKind,
  url: string | undefined,
  query: string | undefined,
): string {
  if (url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return titleCaseKind(kind);
    }
  }
  return query || titleCaseKind(kind);
}

function normalizeSourceKind(value: unknown): MonitorSourceKind | null {
  return MONITOR_SOURCE_KINDS.includes(value as MonitorSourceKind)
    ? (value as MonitorSourceKind)
    : null;
}

function normalizeSourceStatus(value: unknown): MonitorSourceStatus {
  return MONITOR_SOURCE_STATUSES.includes(value as MonitorSourceStatus)
    ? (value as MonitorSourceStatus)
    : "suggested";
}

export function normalizeMonitorSourcePlan(
  input: unknown,
): MonitorSourceEntry[] {
  if (!Array.isArray(input)) return [];
  const out: MonitorSourceEntry[] = [];
  const seen = new Set<string>();

  for (const raw of input) {
    if (!isRecord(raw)) continue;
    const kind = normalizeSourceKind(raw.kind);
    if (!kind) continue;
    const url = normalizeHttpUrl(raw.url ?? raw.value);
    const query = normalizeQuery(raw.query ?? (!url ? raw.value : undefined));
    if (!url && !query) continue;

    const dedupeValue = url ?? query ?? "";
    const key = `${kind}:${dedupeValue.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const lastCheckedAt =
      typeof raw.lastCheckedAt === "number" &&
      Number.isFinite(raw.lastCheckedAt) &&
      raw.lastCheckedAt >= 0
        ? raw.lastCheckedAt
        : undefined;
    const note = normalizeQuery(raw.note);
    out.push({
      id: sourceId(kind, dedupeValue),
      kind,
      label: normalizeQuery(raw.label) ?? defaultSourceLabel(kind, url, query),
      ...(url ? { url } : {}),
      ...(query ? { query } : {}),
      status: normalizeSourceStatus(raw.status),
      ...(lastCheckedAt !== undefined ? { lastCheckedAt } : {}),
      ...(note ? { note } : {}),
    });
  }

  return out;
}

export function buildMonitorDiscoveryPrompt(
  topic: string,
  sourceIntent: SourceIntent = "all",
): string {
  const focus =
    sourceIntent === "rss"
      ? "RSS/Atom feeds and blogs"
      : sourceIntent === "substack"
        ? "Substack publications, author archives, and /feed URLs"
        : sourceIntent === "social"
          ? "discussion/search surfaces such as Reddit, X, Hacker News, and forums"
          : sourceIntent === "web"
            ? "general web/news sources"
            : "RSS, Substack, web/news, and available social/search surfaces";

  return [
    `Suggest reviewable feed-monitor sources for this topic: ${topic.trim()}.`,
    `Source focus: ${sourceIntent} (${focus}).`,
    "Return compact candidates with kind, label, and either url or query. These are reviewable metadata, not trusted facts.",
    "Prefer stable public feeds, author/publication pages, official blogs, changelog pages, pricing pages, and high-signal discussion searches.",
    "Do not claim Reddit/X coverage unless a configured tool actually succeeds; if unavailable, suggest the query as unavailable rather than treating it as monitored.",
    "Never include private, credentialed, localhost, file, or javascript URLs.",
  ].join("\n");
}

function seedSourceCandidates(
  topic: string,
  sourceIntent: SourceIntent,
): MonitorSourceEntry[] {
  const trimmed = topic.trim();
  const candidates: Array<Omit<MonitorSourceEntry, "id">> = [];
  const wants = (kind: SourceIntent | MonitorSourceKind): boolean =>
    sourceIntent === "all" || sourceIntent === kind;

  if (wants("web")) {
    candidates.push({
      kind: "web",
      label: "Web/news search",
      query: `${trimmed} latest news updates`,
      status: "suggested",
    });
  }
  if (wants("rss")) {
    candidates.push({
      kind: "rss",
      label: "RSS/feed search",
      query: `${trimmed} RSS feed OR Atom feed`,
      status: "suggested",
    });
  }
  if (wants("substack")) {
    candidates.push({
      kind: "substack",
      label: "Substack search",
      query: `${trimmed} site:substack.com`,
      status: "suggested",
    });
  }
  if (wants("social")) {
    candidates.push({
      kind: "social",
      label: "Discussion search",
      query: `${trimmed} Reddit OR Hacker News OR X`,
      status: "suggested",
      note: "Coverage depends on configured social/search tools.",
    });
  }

  const urlMatches = trimmed.match(/https?:\/\/[^\s)]+/gi) ?? [];
  for (const url of urlMatches) {
    const normalized = normalizeHttpUrl(url);
    if (!normalized) continue;
    const host = new URL(normalized).hostname;
    candidates.push({
      kind: host.endsWith(".substack.com") ? "substack" : "web",
      label: host.replace(/^www\./, ""),
      url: normalized,
      status: "suggested",
    });
  }

  return normalizeMonitorSourcePlan(candidates);
}

export function buildMonitorDiscoveryResult(
  input: MonitorDiscoveryInput,
): MonitorDiscoveryResult {
  const sourceIntent = SOURCE_INTENTS.includes(
    input.sourceIntent as SourceIntent,
  )
    ? (input.sourceIntent as SourceIntent)
    : "all";
  const seeded = seedSourceCandidates(input.topic, sourceIntent);
  const existing = normalizeMonitorSourcePlan(input.existingPlan);
  const candidates = normalizeMonitorSourcePlan([...existing, ...seeded]);
  const warnings =
    sourceIntent === "social" || sourceIntent === "all"
      ? [
          "Social coverage is conditional: Reddit/X/Hacker News must be backed by configured Hermes tools before it is claimed as monitored.",
        ]
      : [];

  return {
    topic: input.topic.trim(),
    sourceIntent,
    prompt: buildMonitorDiscoveryPrompt(input.topic, sourceIntent),
    candidates,
    warnings,
  };
}

export function buildMonitorSourceHint(item: {
  sourceIntent?: SourceIntent;
  sourcePlan?: MonitorSourceEntry[];
  importanceThreshold?: ImportanceThreshold;
  telegramPush?: boolean;
  telegramMode?: TelegramMode;
}): string {
  const sourceIntent = item.sourceIntent ?? "all";
  const approved = normalizeMonitorSourcePlan(item.sourcePlan).filter(
    (source) => source.status === "approved",
  );
  const lines = [
    `Source focus: ${sourceIntent}.`,
    `Importance threshold: ${item.importanceThreshold ?? "noteworthy"}.`,
  ];

  if (approved.length > 0) {
    lines.push("Approved monitor sources and queries:");
    for (const source of approved) {
      const target = source.url ?? source.query ?? "";
      lines.push(
        `- ${titleCaseKind(source.kind)}: ${source.label} (${target})`,
      );
    }
    lines.push(
      "Prioritize these approved sources, but cite only sources that were actually fetched and verified during this run.",
    );
  } else {
    lines.push(
      "No approved monitor sources yet; discover live public sources and cite only sources actually fetched during this run.",
    );
  }

  if (item.telegramPush) {
    lines.push(
      `Telegram push requested: ${item.telegramMode ?? "summary-only"}. Classify the run's importance, but do not send the push from the research turn.`,
    );
  }

  return lines.join("\n");
}

export function meetsImportanceThreshold(
  classification: ImportanceThreshold,
  threshold: ImportanceThreshold,
): boolean {
  const rank: Record<ImportanceThreshold, number> = {
    digest: 0,
    noteworthy: 1,
    breaking: 2,
  };
  return rank[classification] >= rank[threshold];
}

export function inferBriefImportance(markdown: string): ImportanceThreshold {
  const text = markdown.toLowerCase();
  if (
    /\b(breaking|urgent|major outage|security incident|acquired|lawsuit)\b/.test(
      text,
    )
  ) {
    return "breaking";
  }
  if (
    /\b(launch|launched|announced|changed|released|pricing|raised|funding|new)\b/.test(
      text,
    )
  ) {
    return "noteworthy";
  }
  return "digest";
}

/** Coerce an arbitrary topic into a safe, readable page-id slug. */
export function slugForTopic(topic: string): string {
  const slug = String(topic)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "topic";
}

/** Validate user input for a schedule. Returns an error string or null. A
 *  digest summarizes sessions rather than a topic, so its topic is optional. */
export function validateScheduleInput(input: ScheduleInput): string | null {
  if (!input || typeof input !== "object") return "Invalid schedule.";
  const isDigest = input.kind === "digest";
  if (!isDigest && (!input.topic || !input.topic.trim()))
    return "Enter a topic to research.";
  if (!CADENCES.includes(input.cadence)) return "Pick a valid cadence.";
  if (
    input.sourceIntent !== undefined &&
    !SOURCE_INTENTS.includes(input.sourceIntent)
  )
    return "Pick a valid source focus.";
  if (
    input.importanceThreshold !== undefined &&
    !IMPORTANCE_THRESHOLDS.includes(input.importanceThreshold)
  )
    return "Pick a valid importance threshold.";
  if (
    input.telegramMode !== undefined &&
    !TELEGRAM_MODES.includes(input.telegramMode)
  )
    return "Telegram mode must be summary-only for now.";
  if (input.sourcePlan !== undefined && !Array.isArray(input.sourcePlan))
    return "Source plan is invalid.";
  const hour = input.hour ?? 8;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23)
    return "Hour must be 0–23.";
  return null;
}

// ── due-check (pure; tests pass a fixed `now`) ──────────────────────────────

function ymd(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Monday-of-week (local) as a YMD string — a stable weekly bucket key. */
function weekKey(d: Date): string {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (monday.getDay() + 6) % 7; // 0 = Monday
  monday.setDate(monday.getDate() - dow);
  return ymd(monday);
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}

/** The calendar bucket a date falls in, for the given cadence. */
export function periodKey(cadence: Cadence, d: Date): string {
  if (cadence === "weekly") return weekKey(d);
  if (cadence === "monthly") return monthKey(d);
  return ymd(d);
}

/**
 * Epoch ms of the START of the current period for a cadence (local time): today
 * 00:00 (daily), Monday 00:00 (weekly), or the 1st 00:00 (monthly). The digest
 * run uses this as the lower bound for "sessions in this period". Pure.
 */
export function periodStart(cadence: Cadence, now: Date): number {
  if (cadence === "monthly") {
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  }
  if (cadence === "weekly") {
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dow = (monday.getDay() + 6) % 7; // 0 = Monday
    monday.setDate(monday.getDate() - dow);
    return monday.getTime();
  }
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/**
 * Is this schedule due to run at `now`? True when it is enabled, the local hour
 * has reached its run hour, and it has not already run in the current period
 * (day / week / month). A never-run schedule (lastRunAt 0) is due once the hour
 * passes. Pure — callers pass `now` (main passes `new Date()`).
 */
export function isDue(item: ScheduledResearchItem, now: Date): boolean {
  if (!item.enabled) return false;
  if (now.getHours() < item.hour) return false;
  if (!item.lastRunAt) return true;
  const last = new Date(item.lastRunAt);
  return periodKey(item.cadence, now) !== periodKey(item.cadence, last);
}

/** Build a standard 5-field cron expression for a cadence + hour (minute 0).
 *  daily → every day; weekly → Mondays; monthly → the 1st. Pure/testable. */
export function cronExprFor(cadence: Cadence, hour: number): string {
  const h = Math.max(0, Math.min(23, Math.floor(hour)));
  if (cadence === "weekly") return `0 ${h} * * 1`;
  if (cadence === "monthly") return `0 ${h} 1 * *`;
  return `0 ${h} * * *`;
}

/** Human label for a cadence, for the management UI. */
export function cadenceLabel(cadence: Cadence, hour: number): string {
  const h = `${String(hour).padStart(2, "0")}:00`;
  if (cadence === "weekly") return `Weekly · Mon ${h}`;
  if (cadence === "monthly") return `Monthly · 1st ${h}`;
  return `Daily · ${h}`;
}
