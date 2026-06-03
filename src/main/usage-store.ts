/**
 * Desktop-owned usage/cost store IO (idea A2 / Phase 0b).
 *
 * The gateway owns `state.db` and the desktop opens it read-only — and that
 * schema has NO token/cost columns. So per-turn usage (which the gateway DOES
 * emit live on the final SSE chunk, parsed in `sse-parser.ts`) is the only
 * source of cost data the desktop can see. We capture it here into a
 * desktop-owned append-only JSONL file, mirroring the per-profile placement of
 * `session-cache.ts` (`<profileHome>/desktop/…`).
 *
 * Pure types + aggregation live in `../shared/usage` (so the renderer + preload
 * can share them); this module is just the filesystem layer. IO functions
 * accept a `filePath` override so tests write to a temp dir.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { profileHome, getActiveProfileNameSync } from "./utils";
import {
  type UsageRecord,
  type UsageAggregate,
  serializeRecord,
  parseUsageLines,
  aggregateUsage,
} from "../shared/usage";

// Re-export the shared pure core so existing importers of "./usage-store"
// (and tests) keep working from one entry point.
export {
  type UsageRecord,
  type UsageTotals,
  type UsageAggregate,
  serializeRecord,
  parseUsageLines,
  aggregateUsage,
  dayKey,
  toDaySeries,
  topModels,
  formatCost,
} from "../shared/usage";

/**
 * Resolve the usage file for a profile. Default profile →
 * `<HERMES_HOME>/desktop/usage.jsonl`; named profiles →
 * `<HERMES_HOME>/profiles/<name>/desktop/usage.jsonl`.
 */
export function usageFilePath(profile?: string): string {
  return join(profileHome(profile), "desktop", "usage.jsonl");
}

interface IoOpts {
  /** Explicit file path — used by tests to redirect away from the real home. */
  filePath?: string;
  profile?: string;
}

function resolvePath(opts?: IoOpts): string {
  if (opts?.filePath) return opts.filePath;
  return usageFilePath(opts?.profile ?? getActiveProfileNameSync());
}

/**
 * Append one usage record. `ts` defaults to now. Best-effort and non-fatal:
 * a failure to write usage must never break a chat turn.
 */
export function recordUsage(
  rec: Omit<UsageRecord, "ts"> & { ts?: number },
  opts?: IoOpts,
): void {
  try {
    const file = resolvePath(opts);
    mkdirSync(dirname(file), { recursive: true });
    const full: UsageRecord = { ts: rec.ts ?? Date.now(), ...rec };
    appendFileSync(file, serializeRecord(full) + "\n", "utf-8");
  } catch {
    // non-fatal
  }
}

/** Read all usage records for a profile (tolerant of a missing/corrupt file). */
export function readUsageRecords(opts?: IoOpts): UsageRecord[] {
  try {
    const file = resolvePath(opts);
    if (!existsSync(file)) return [];
    return parseUsageLines(readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
}

/** Read + aggregate in one call (what the IPC handler for A2 will use). */
export function getUsageStats(opts?: IoOpts): UsageAggregate {
  return aggregateUsage(readUsageRecords(opts));
}
