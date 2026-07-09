// liveNotes.ts — pure types + matching/scheduling for Live Notes.
// No Electron/node imports so both typecheck projects and vitest can load it.

export const LIVE_NOTE_KIND = "live-note";
export const LIVE_NOTES_REGISTRY_VERSION = 1 as const;
export const MAX_LIVE_NOTES = 50;
export const LIVE_NOTE_RETRY_BACKOFF_MS = 5 * 60 * 1000;
/** Missed cron fires older than this are skipped, not replayed. */
export const LIVE_NOTE_CRON_GRACE_MS = 2 * 60 * 1000;
export const NO_UPDATE_SENTINEL = "NO_UPDATE";

export type LiveNoteTriggerKind = "manual" | "cron" | "window" | "email";

export type LiveNoteTriageLabel =
  | "urgent"
  | "action"
  | "knowledge"
  | "archive"
  | "ignore";

export interface LiveNoteEventMatch {
  /** Whole-word keywords against subject + bodyPreview. */
  keywords?: string[];
  /** Substrings matched against normalized from address / domain. */
  fromIncludes?: string[];
  /** If set, triage label must be one of these. */
  triageLabels?: LiveNoteTriageLabel[];
  /** Prompt-only Pass-2 hint; not used as a hard filter in v1. */
  description?: string;
}

export interface LiveNoteTimeWindow {
  /** Local HH:MM (24h). */
  startTime: string;
  /** Local HH:MM (24h). */
  endTime: string;
}

export interface LiveNoteTriggers {
  cronExpr?: string;
  windows?: LiveNoteTimeWindow[];
  eventMatch?: LiveNoteEventMatch;
}

export interface LiveNoteItem {
  id: string;
  pageId: string;
  objective: string;
  active: boolean;
  autoApply: boolean;
  triggers: LiveNoteTriggers;
  model?: string;
  lastAttemptAt?: number;
  lastRunAt?: number;
  lastRunSummary?: string;
  lastRunError?: string | null;
  lastRunId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface LiveNotesRegistry {
  version: typeof LIVE_NOTES_REGISTRY_VERSION;
  items: LiveNoteItem[];
}

/** User-controlled fields for create/update (runtime fields owned by main). */
export interface LiveNoteInput {
  pageId: string;
  objective: string;
  active?: boolean;
  autoApply?: boolean;
  triggers?: LiveNoteTriggers;
  model?: string;
}

export interface LiveNoteEmailEvent {
  subject: string;
  bodyPreview: string;
  from: string;
  triageLabel?: LiveNoteTriageLabel | string;
  /** When true, skip unless triageLabels explicitly includes archive. */
  digest?: boolean;
  captureId?: string;
}

export interface LiveNotePending {
  id: string;
  liveNoteId: string;
  pageId: string;
  title: string;
  createdAt: number;
  trigger: LiveNoteTriggerKind;
  contentBeforeHash: string;
  proposedBody: string;
  summary: string;
  emailCaptureId?: string;
  autoApply: boolean;
}

export type LiveNoteRunResult = {
  ok: boolean;
  action?: "replace" | "no_update" | "skipped";
  summary?: string;
  error?: string;
  pendingId?: string;
};

export type DueTimedResult = "cron" | "window" | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word keyword match (case-insensitive haystack should already be lower). */
export function matchesLiveNoteKeyword(
  lowerHaystack: string,
  keyword: string,
): boolean {
  const trimmed = keyword.trim().toLowerCase();
  if (!trimmed) return false;
  const re = new RegExp(`\\b${escapeRegExp(trimmed)}\\b`);
  return re.test(lowerHaystack);
}

export function normalizeEmailLoose(value: string): string {
  return value.trim().toLowerCase();
}

const HH_MM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function parseHhMm(
  value: string,
): { hour: number; minute: number } | null {
  const match = HH_MM_RE.exec(value.trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function windowMinutes(w: LiveNoteTimeWindow): {
  start: number;
  end: number;
} | null {
  const start = parseHhMm(w.startTime);
  const end = parseHhMm(w.endTime);
  if (!start || !end) return null;
  return {
    start: start.hour * 60 + start.minute,
    end: end.hour * 60 + end.minute,
  };
}

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeStringList(value: unknown, max = 40): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const s = asString(raw).trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s.slice(0, 120));
    if (out.length >= max) break;
  }
  return out;
}

const TRIAGE_LABELS: LiveNoteTriageLabel[] = [
  "urgent",
  "action",
  "knowledge",
  "archive",
  "ignore",
];

function normalizeTriageLabels(value: unknown): LiveNoteTriageLabel[] {
  if (!Array.isArray(value)) return [];
  const out: LiveNoteTriageLabel[] = [];
  for (const raw of value) {
    const s = asString(raw).trim().toLowerCase();
    if (TRIAGE_LABELS.includes(s as LiveNoteTriageLabel)) {
      out.push(s as LiveNoteTriageLabel);
    }
  }
  return out;
}

function normalizeWindows(value: unknown): LiveNoteTimeWindow[] {
  if (!Array.isArray(value)) return [];
  const out: LiveNoteTimeWindow[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const startTime = asString(raw.startTime).trim();
    const endTime = asString(raw.endTime).trim();
    if (!parseHhMm(startTime) || !parseHhMm(endTime)) continue;
    out.push({ startTime, endTime });
    if (out.length >= 8) break;
  }
  return out;
}

function normalizeEventMatch(value: unknown): LiveNoteEventMatch | undefined {
  if (!isRecord(value)) return undefined;
  const keywords = normalizeStringList(value.keywords);
  const fromIncludes = normalizeStringList(value.fromIncludes).map((s) =>
    normalizeEmailLoose(s),
  );
  const triageLabels = normalizeTriageLabels(value.triageLabels);
  const description = asString(value.description).trim().slice(0, 500);
  if (
    keywords.length === 0 &&
    fromIncludes.length === 0 &&
    triageLabels.length === 0 &&
    !description
  ) {
    return undefined;
  }
  return {
    ...(keywords.length ? { keywords } : {}),
    ...(fromIncludes.length ? { fromIncludes } : {}),
    ...(triageLabels.length ? { triageLabels } : {}),
    ...(description ? { description } : {}),
  };
}

/** Basic 5-field cron validation (minute hour dom month dow). */
export function isValidCronExpr(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return parts.every((p) => /^[\d*/,#-]+$/.test(p));
}

function fieldMatches(
  field: string,
  value: number,
  min: number,
  max: number,
): boolean {
  if (field === "*") return true;
  for (const piece of field.split(",")) {
    if (piece.includes("/")) {
      const [rangePart, stepRaw] = piece.split("/");
      const step = Number(stepRaw);
      if (!Number.isInteger(step) || step <= 0) continue;
      let start = min;
      let end = max;
      if (rangePart !== "*") {
        if (rangePart.includes("-")) {
          const [a, b] = rangePart.split("-").map(Number);
          if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
          start = a;
          end = b;
        } else {
          const n = Number(rangePart);
          if (!Number.isInteger(n)) continue;
          start = n;
          end = max;
        }
      }
      for (let v = start; v <= end; v += step) {
        if (v === value) return true;
      }
      continue;
    }
    if (piece.includes("-")) {
      const [a, b] = piece.split("-").map(Number);
      if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
      if (value >= a && value <= b) return true;
      continue;
    }
    const n = Number(piece);
    if (Number.isInteger(n) && n === value) return true;
  }
  return false;
}

/**
 * Whether `at` matches a 5-field cron expression (local time fields).
 * Dow: 0=Sunday … 6=Saturday (also accepts 7 as Sunday).
 */
export function cronMatchesAt(expr: string, at: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minF, hourF, domF, monF, dowF] = parts;
  const minute = at.getMinutes();
  const hour = at.getHours();
  const dom = at.getDate();
  const mon = at.getMonth() + 1;
  const dow = at.getDay();
  if (!fieldMatches(minF, minute, 0, 59)) return false;
  if (!fieldMatches(hourF, hour, 0, 23)) return false;
  if (!fieldMatches(domF, dom, 1, 31)) return false;
  if (!fieldMatches(monF, mon, 1, 12)) return false;
  if (dowF === "*") return true;
  // Support 7 as Sunday
  if (fieldMatches(dowF, dow, 0, 7)) return true;
  if (dow === 0 && fieldMatches(dowF, 7, 0, 7)) return true;
  return false;
}

/**
 * Cron due check with grace: fire if the schedule matched in the last
 * LIVE_NOTE_CRON_GRACE_MS and we have not successfully run at/after that slot.
 * Missed slots older than grace are skipped.
 */
export function isCronDue(
  cronExpr: string,
  lastRunAt: number | undefined,
  now: Date,
  graceMs = LIVE_NOTE_CRON_GRACE_MS,
): boolean {
  if (!isValidCronExpr(cronExpr)) return false;
  // Check current minute and walk back second-by-second for grace window
  const nowMs = now.getTime();
  const startMs = nowMs - graceMs;
  // Sample every minute in the grace window (inclusive of current minute)
  const startMinute = Math.floor(startMs / 60000) * 60000;
  const endMinute = Math.floor(nowMs / 60000) * 60000;
  for (let t = endMinute; t >= startMinute; t -= 60000) {
    const slot = new Date(t);
    if (!cronMatchesAt(cronExpr, slot)) continue;
    if (lastRunAt !== undefined && lastRunAt >= t) continue;
    return true;
  }
  return false;
}

/**
 * Daily window due: once per local day after startTime while still before endTime,
 * anchored on successful lastRunAt (must not already have run today after start).
 */
export function isWindowDue(
  windows: LiveNoteTimeWindow[],
  lastRunAt: number | undefined,
  now: Date,
): boolean {
  if (!windows.length) return false;
  const nowMin = minutesOfDay(now);
  const today = ymdLocal(now);
  for (const w of windows) {
    const bounds = windowMinutes(w);
    if (!bounds) continue;
    const { start, end } = bounds;
    // Support windows that don't wrap midnight in v1
    if (end <= start) continue;
    if (nowMin < start || nowMin >= end) continue;
    if (lastRunAt !== undefined) {
      const last = new Date(lastRunAt);
      if (ymdLocal(last) === today && minutesOfDay(last) >= start) {
        continue;
      }
    }
    return true;
  }
  return false;
}

export function dueTimedTrigger(
  triggers: LiveNoteTriggers,
  lastRunAt: number | undefined,
  now: Date = new Date(),
): DueTimedResult {
  if (triggers.cronExpr && isCronDue(triggers.cronExpr, lastRunAt, now)) {
    return "cron";
  }
  if (
    triggers.windows?.length &&
    isWindowDue(triggers.windows, lastRunAt, now)
  ) {
    return "window";
  }
  return null;
}

export function backoffRemainingMs(
  lastAttemptAt: number | undefined,
  nowMs: number = Date.now(),
  backoffMs = LIVE_NOTE_RETRY_BACKOFF_MS,
): number {
  if (lastAttemptAt === undefined) return 0;
  const elapsed = nowMs - lastAttemptAt;
  if (elapsed >= backoffMs) return 0;
  return backoffMs - elapsed;
}

/**
 * Hard email match. Fail-closed: needs at least one hard filter field
 * (keywords / fromIncludes / triageLabels). description alone does not fire.
 * AND across present fields.
 */
export function emailEventMatches(
  eventMatch: LiveNoteEventMatch | undefined,
  event: LiveNoteEmailEvent,
): boolean {
  if (!eventMatch) return false;
  const hasHard =
    (eventMatch.keywords && eventMatch.keywords.length > 0) ||
    (eventMatch.fromIncludes && eventMatch.fromIncludes.length > 0) ||
    (eventMatch.triageLabels && eventMatch.triageLabels.length > 0);
  if (!hasHard) return false;

  // Digest bulk: never wake unless triageLabels explicitly lists the message
  // label (usually "archive"). description/keywords alone are not enough.
  if (event.digest === true) {
    const labels = eventMatch.triageLabels ?? [];
    const label = asString(
      event.triageLabel,
    ).toLowerCase() as LiveNoteTriageLabel;
    if (labels.length === 0) return false;
    if (!labels.includes(label)) return false;
  }

  if (eventMatch.keywords && eventMatch.keywords.length > 0) {
    const haystack = `${event.subject}\n${event.bodyPreview}`.toLowerCase();
    const hit = eventMatch.keywords.some((kw) =>
      matchesLiveNoteKeyword(haystack, kw),
    );
    if (!hit) return false;
  }

  if (eventMatch.fromIncludes && eventMatch.fromIncludes.length > 0) {
    const from = normalizeEmailLoose(event.from);
    const hit = eventMatch.fromIncludes.some((needle) => {
      const n = normalizeEmailLoose(needle);
      return n && from.includes(n);
    });
    if (!hit) return false;
  }

  if (eventMatch.triageLabels && eventMatch.triageLabels.length > 0) {
    const label = asString(event.triageLabel).toLowerCase();
    if (!eventMatch.triageLabels.includes(label as LiveNoteTriageLabel)) {
      return false;
    }
  }

  return true;
}

export function normalizeTriggers(value: unknown): LiveNoteTriggers {
  if (!isRecord(value)) return {};
  const cronRaw = asString(value.cronExpr).trim();
  const cronExpr = cronRaw && isValidCronExpr(cronRaw) ? cronRaw : undefined;
  const windows = normalizeWindows(value.windows);
  const eventMatch = normalizeEventMatch(value.eventMatch);
  return {
    ...(cronExpr ? { cronExpr } : {}),
    ...(windows.length ? { windows } : {}),
    ...(eventMatch ? { eventMatch } : {}),
  };
}

export function validateLiveNoteInput(input: LiveNoteInput): string | null {
  if (!input || typeof input !== "object") return "Invalid live note.";
  const pageId = asString(input.pageId).trim();
  if (!pageId) return "Pick a page.";
  if (!/^[A-Za-z0-9._-]+$/.test(pageId)) return "Invalid page id.";
  const objective = asString(input.objective).trim();
  if (!objective) return "Enter an objective.";
  if (objective.length > 4000) return "Objective is too long.";
  if (input.triggers !== undefined) {
    if (!isRecord(input.triggers) && typeof input.triggers !== "object") {
      return "Invalid triggers.";
    }
    const t = input.triggers as LiveNoteTriggers;
    if (t.cronExpr && !isValidCronExpr(t.cronExpr)) {
      return "Cron expression must be 5 fields (min hour dom month dow).";
    }
    if (t.windows) {
      for (const w of t.windows) {
        if (!parseHhMm(w.startTime) || !parseHhMm(w.endTime)) {
          return "Windows must use HH:MM times.";
        }
      }
    }
  }
  return null;
}

export function normalizeLiveNote(
  raw: unknown,
  fallbacks?: { id?: string; now?: number },
): LiveNoteItem | null {
  if (!isRecord(raw)) return null;
  const pageId = asString(raw.pageId).trim();
  const objective = asString(raw.objective).trim();
  if (!pageId || !objective) return null;
  const now = fallbacks?.now ?? Date.now();
  const id = asString(raw.id).trim() || fallbacks?.id || `ln_${now}`;
  const triggers = normalizeTriggers(raw.triggers);
  const createdAt = asFiniteNumber(raw.createdAt) ?? now;
  const updatedAt = asFiniteNumber(raw.updatedAt) ?? createdAt;
  const model = asString(raw.model).trim();
  return {
    id,
    pageId,
    objective: objective.slice(0, 4000),
    active: raw.active !== false,
    autoApply: raw.autoApply !== false,
    triggers,
    ...(model ? { model: model.slice(0, 80) } : {}),
    lastAttemptAt: asFiniteNumber(raw.lastAttemptAt),
    lastRunAt: asFiniteNumber(raw.lastRunAt),
    lastRunSummary: asString(raw.lastRunSummary).slice(0, 500) || undefined,
    lastRunError:
      raw.lastRunError === null
        ? null
        : asString(raw.lastRunError).slice(0, 500) || undefined,
    lastRunId: asString(raw.lastRunId).trim() || undefined,
    createdAt,
    updatedAt,
  };
}

export function normalizeRegistry(raw: unknown): LiveNotesRegistry {
  const empty: LiveNotesRegistry = {
    version: LIVE_NOTES_REGISTRY_VERSION,
    items: [],
  };
  if (!isRecord(raw)) return empty;
  const list = Array.isArray(raw.items) ? raw.items : [];
  const items: LiveNoteItem[] = [];
  const seenPages = new Set<string>();
  for (const entry of list) {
    const item = normalizeLiveNote(entry);
    if (!item) continue;
    if (seenPages.has(item.pageId)) continue;
    seenPages.add(item.pageId);
    items.push(item);
    if (items.length >= MAX_LIVE_NOTES) break;
  }
  return { version: LIVE_NOTES_REGISTRY_VERSION, items };
}

export function emptyLiveNotesRegistry(): LiveNotesRegistry {
  return { version: LIVE_NOTES_REGISTRY_VERSION, items: [] };
}

/** Build chat messages for a live-note body rewrite. Pure/testable. */
export function buildLiveNoteRunMessages(input: {
  objective: string;
  pageId: string;
  title: string;
  currentBody: string;
  trigger: LiveNoteTriggerKind;
  email?: LiveNoteEmailEvent;
  dateStr: string;
}): Array<{ role: string; content: string }> {
  const emailBlock = input.email
    ? [
        "<email_event>",
        `from: ${input.email.from}`,
        `subject: ${input.email.subject}`,
        `triage: ${input.email.triageLabel ?? "unknown"}`,
        input.email.bodyPreview.slice(0, 3000),
        "</email_event>",
        "Pass-2: only edit if this email genuinely warrants a change for the objective.",
      ].join("\n")
    : "";

  const system = [
    "You maintain a single living markdown page for the user.",
    "Rewrite the page BODY only (no YAML frontmatter) so it satisfies the objective.",
    "Keep an H1 title line if the current body has one.",
    "Prefer: short rolling summary, then H2 sections, freshest first.",
    "Tightness over decoration. No fluff.",
    `If nothing material should change, reply with exactly ${NO_UPDATE_SENTINEL} and nothing else.`,
    "Otherwise reply with the full new markdown body only — no JSON, no fences, no commentary.",
  ].join("\n");

  const user = [
    `Page id: ${input.pageId}`,
    `Title: ${input.title}`,
    `Today: ${input.dateStr}`,
    `Trigger: ${input.trigger}`,
    "",
    "Objective:",
    input.objective,
    "",
    "<current_body>",
    input.currentBody || "(empty)",
    "</current_body>",
    emailBlock ? `\n${emailBlock}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** Parse model output into body update or no-op. */
export function parseLiveNoteModelOutput(content: string): {
  action: "replace" | "no_update";
  body?: string;
} {
  const trimmed = content.trim();
  if (!trimmed) return { action: "no_update" };
  if (trimmed === NO_UPDATE_SENTINEL) return { action: "no_update" };
  // Strip accidental fences
  let body = trimmed;
  const fence = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(body);
  if (fence) body = fence[1].trim();
  if (!body || body === NO_UPDATE_SENTINEL) return { action: "no_update" };
  return { action: "replace", body };
}
