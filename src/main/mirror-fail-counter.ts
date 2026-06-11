// mirror-fail-counter.ts — observability for the additive vault-mirror write path.
//
// The SPS vault is markdown-on-disk; in blob mode it is an ADDITIVE mirror of the
// authoritative JSON workspace, and sps-vault.ts deliberately swallows write
// failures ("worst case is a stale extra file"). That silence hides genuine
// divergence: a failed mirror write means the markdown source-of-truth is missing
// content the operator believes is on disk. This counter persists how many mirror
// writes have failed (plus the last error + timestamp) so the drift can surface in
// Workspace settings.
//
// Pure fs/path only (no Electron): the caller supplies HERMES_HOME and the clock,
// so this is directly unit-testable against a tmp dir.
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const COUNTER_FILE = "mirror-failures.json";

export interface MirrorFailRecord {
  count: number;
  lastError?: string;
  lastAt?: number;
}

function counterPath(homeDir: string): string {
  return join(homeDir, COUNTER_FILE);
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Coerce arbitrary parsed JSON into a well-formed record (tolerant of corruption). */
export function normalizeMirrorFailRecord(parsed: unknown): MirrorFailRecord {
  if (!parsed || typeof parsed !== "object") return { count: 0 };
  const obj = parsed as Record<string, unknown>;
  const rawCount = obj.count;
  const validCount =
    typeof rawCount === "number" && Number.isFinite(rawCount) && rawCount > 0;
  const count = validCount ? Math.floor(rawCount) : 0;
  const record: MirrorFailRecord = { count };
  if (typeof obj.lastError === "string") record.lastError = obj.lastError;
  if (typeof obj.lastAt === "number" && Number.isFinite(obj.lastAt)) {
    record.lastAt = obj.lastAt;
  }
  return record;
}

/** Read the persisted counter, or a zeroed record if absent/unreadable. */
export function readMirrorFailRecord(homeDir: string): MirrorFailRecord {
  try {
    const raw = readFileSync(counterPath(homeDir), "utf-8");
    return normalizeMirrorFailRecord(JSON.parse(raw));
  } catch {
    return { count: 0 };
  }
}

/**
 * Record one mirror-write failure: bump the count, stamp the error + time, and
 * persist. Returns the new record. Persistence is best-effort — failing to write
 * the counter must never throw into the (already-failing) write path.
 */
export function recordMirrorFailure(
  homeDir: string,
  error: unknown,
  at: number,
): MirrorFailRecord {
  const prev = readMirrorFailRecord(homeDir);
  const next: MirrorFailRecord = {
    count: prev.count + 1,
    lastError: messageOf(error),
    lastAt: at,
  };
  try {
    writeFileSync(counterPath(homeDir), JSON.stringify(next, null, 2), "utf-8");
  } catch {
    /* best effort — observability must not break the write path */
  }
  return next;
}
