// tasks-dump.ts — shared contract for the Tasks-Dump GTD inbox.
//
// Split of responsibility:
//   • The task ROW (vault/tasks/<id>.md) is the source of truth for identity +
//     routing (title/status/who/due/route/assigneeId/…). It is human-visible
//     and git-friendly, so it must change only on real edits.
//   • The NAG record below is volatile runtime bookkeeping (how many times we
//     have chased a task, when to chase next). It lives in a JSON sidecar
//     (`sps-agent/task-nag-state.json`, see src/main/tasks-dump.ts) so the nag
//     engine can tick without rewriting markdown and thrashing the note-index.
import type { StatusKey, TaskRoute } from "./sps-types";

/** What the classifier suggests for chase frequency. `none` = don't nag. */
export type NagCadence = "none" | "daily" | "weekly";

/** Where a due-but-undone human task is in the escalation ladder. */
export type EscalationTier = "badge" | "notification" | "channel";

/** The classifier's verdict for one captured task (see src/main/task-triage.ts). */
export interface TaskTriageResult {
  route: TaskRoute;
  due?: string;
  risky?: boolean;
  nagCadence?: NagCadence;
  assigneeId?: string;
  reason?: string;
  confidence?: number;
}

/** Input for routing a freshly-classified task (see src/main/task-routing.ts). */
export interface RouteTaskInput {
  rowId: string;
  title: string;
  body?: string;
  triage: TaskTriageResult;
}

/** What routing actually did, written back onto the task row + shown as a chip. */
export interface RouteTaskOutcome {
  route: TaskRoute;
  status: StatusKey;
  /** The Kanban task id for a dispatched AI task (the row reflects it read-only). */
  delegatedTo?: string;
  dispatched: boolean;
  /** True when an AI dispatch failed and the task fell back to the human lane. */
  fellBackToHuman?: boolean;
}

/** Volatile per-task nag bookkeeping, keyed by the task row id. */
export interface TaskNagRecord {
  rowId: string;
  nagCount: number;
  nextNagAt: number;
  lastNaggedAt?: number;
  snoozedUntil?: number;
  cadence: NagCadence;
  done?: boolean;
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

// Frequency decays as a task is repeatedly chased: daily for the first week of
// nags, then weekly thereafter ("1/day → 1/week"). Cadence "none" never nags.
export function nagIntervalMs(nagCount: number, cadence: NagCadence): number {
  if (cadence === "none") return Number.POSITIVE_INFINITY;
  if (cadence === "weekly") return WEEK_MS;
  const withinFirstWeek = nagCount < 7;
  return withinFirstWeek ? DAY_MS : WEEK_MS;
}

// Escalation rises with the chase count: a quiet in-app badge first, then a
// local OS notification, finally a channel hand-off (nag me, or — opt-in —
// auto-message the assignee). See the nag engine in src/main/scheduler.ts.
export function escalationTier(nagCount: number): EscalationTier {
  if (nagCount <= 1) return "badge";
  if (nagCount <= 3) return "notification";
  return "channel";
}

/** Build the initial nag record when a human task first acquires a due date. */
export function createNagRecord(
  rowId: string,
  cadence: NagCadence,
  now: number,
): TaskNagRecord {
  const firstInterval = nagIntervalMs(0, cadence);
  const firstNagAt = Number.isFinite(firstInterval) ? now + firstInterval : now;
  return {
    rowId,
    nagCount: 0,
    nextNagAt: firstNagAt,
    cadence,
  };
}

/** Advance after firing a nag: bump the count and schedule the next chase. */
export function advanceNagRecord(
  record: TaskNagRecord,
  now: number,
): TaskNagRecord {
  const nextCount = record.nagCount + 1;
  const interval = nagIntervalMs(nextCount, record.cadence);
  const nextNagAt = Number.isFinite(interval)
    ? now + interval
    : record.nextNagAt;
  return {
    ...record,
    nagCount: nextCount,
    lastNaggedAt: now,
    nextNagAt,
  };
}

/** A nag is due when it is past nextNagAt, not snoozed, and not finished. */
export function isNagDue(record: TaskNagRecord, now: number): boolean {
  if (record.done) return false;
  if (record.cadence === "none") return false;
  const stillSnoozed = record.snoozedUntil != null && record.snoozedUntil > now;
  if (stillSnoozed) return false;
  return record.nextNagAt <= now;
}
