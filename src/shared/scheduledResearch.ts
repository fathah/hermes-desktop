// scheduledResearch.ts (shared) — pure types + scheduling logic for the
// Scheduled Research feature. No Electron/node imports so it runs in both
// typecheck projects and under vitest. The main process owns persistence + the
// gateway calls; this module owns the testable "is it due" + validation logic.

import type { ExternalSource } from "./external-context";

export type Cadence = "daily" | "weekly" | "monthly";

/** What a schedule produces: a web-research page (default) or a digest of the
 *  user's external AI-tool sessions over the period. */
export type ScheduleKind = "research" | "digest";

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
  /** Free-text research topic (research kind). For a digest this is a label. */
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
  telegramPush?: boolean;
  kind?: ScheduleKind;
  scope?: DigestScope;
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

/** Validate user input for a schedule. Returns an error string or null. A
 *  digest summarizes sessions rather than a topic, so its topic is optional. */
export function validateScheduleInput(input: ScheduleInput): string | null {
  if (!input || typeof input !== "object") return "Invalid schedule.";
  const isDigest = input.kind === "digest";
  if (!isDigest && (!input.topic || !input.topic.trim()))
    return "Enter a topic to research.";
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
