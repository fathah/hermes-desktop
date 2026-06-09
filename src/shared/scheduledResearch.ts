// scheduledResearch.ts (shared) — pure types + scheduling logic for the
// Scheduled Research feature. No Electron/node imports so it runs in both
// typecheck projects and under vitest. The main process owns persistence + the
// gateway calls; this module owns the testable "is it due" + validation logic.

export type Cadence = "daily" | "weekly" | "monthly";

export interface ScheduledResearchItem {
  id: string;
  /** Free-text research topic. */
  topic: string;
  /** Slug of the living wiki page this schedule keeps current. */
  pageId: string;
  cadence: Cadence;
  /** Local hour-of-day (0–23) at/after which a due run may fire. */
  hour: number;
  /** MVP default false: the merge waits in the pending queue for review. */
  autoApply: boolean;
  /** v2: push a one-liner to Telegram when changed (gated on a channel). */
  telegramPush: boolean;
  enabled: boolean;
  createdAt: number;
  /** Epoch ms of the last completed run (0 = never run). */
  lastRunAt: number;
  /** Hash of the last committed brief — a cheap dedupe gate. */
  lastChangeHash: string;
}

/** Input shape for creating/updating a schedule (the user-controlled fields). */
export interface ScheduleInput {
  topic: string;
  cadence: Cadence;
  hour?: number;
  autoApply?: boolean;
  telegramPush?: boolean;
}

export const MAX_SCHEDULES = 25;
export const CADENCES: Cadence[] = ["daily", "weekly", "monthly"];

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

/** Validate user input for a schedule. Returns an error string or null. */
export function validateScheduleInput(input: ScheduleInput): string | null {
  if (!input || typeof input !== "object") return "Invalid schedule.";
  if (!input.topic || !input.topic.trim()) return "Enter a topic to research.";
  if (!CADENCES.includes(input.cadence)) return "Pick a valid cadence.";
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

/** Human label for a cadence, for the management UI. */
export function cadenceLabel(cadence: Cadence, hour: number): string {
  const h = `${String(hour).padStart(2, "0")}:00`;
  if (cadence === "weekly") return `Weekly · Mon ${h}`;
  if (cadence === "monthly") return `Monthly · 1st ${h}`;
  return `Daily · ${h}`;
}
