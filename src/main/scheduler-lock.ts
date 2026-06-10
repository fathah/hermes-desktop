// Phase 1.2 — routine scheduler lock: pure stale-lock decision logic.
//
// The old lock was a bare existsSync on /tmp/hermes-routine-<id>.lock that wrote
// the PID but never read it. A job that crashed mid-run left the file behind and
// was then skipped forever — the textbook "the system silently does nothing"
// PKM-killer. This module decides acquisition from the lock record + a liveness
// probe, so a dead or stale lock self-heals. Effects (fs, process.kill) live in
// scheduler.ts; this stays pure and vitest-testable.

export interface LockRecord {
  pid: number;
  startedAt: number;
}

export type LockDecision =
  | { type: "acquire" }
  | { type: "steal"; reason: "dead-pid" | "stale" }
  | { type: "blocked" };

export function serializeLockRecord(record: LockRecord): string {
  return JSON.stringify(record);
}

export function parseLockRecord(raw: string): LockRecord | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Legacy format: the old lock wrote a bare PID integer. Treat it as a record
  // with startedAt 0 so it is always older than any timeout and thus stealable —
  // an upgrade never wedges a job behind a pre-upgrade lock.
  if (!trimmed.startsWith("{")) {
    const legacyPid = Number.parseInt(trimmed, 10);
    if (Number.isInteger(legacyPid)) {
      return { pid: legacyPid, startedAt: 0 };
    }
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as Partial<LockRecord>;
    if (typeof parsed.pid !== "number" || !Number.isFinite(parsed.pid)) {
      return null;
    }
    const startedAt =
      typeof parsed.startedAt === "number" && Number.isFinite(parsed.startedAt)
        ? parsed.startedAt
        : 0;
    return { pid: parsed.pid, startedAt };
  } catch {
    return null;
  }
}

export function decideLockAcquisition(
  existing: LockRecord | null,
  now: number,
  timeoutMs: number,
  isPidAlive: (pid: number) => boolean,
): LockDecision {
  if (existing === null) {
    return { type: "acquire" };
  }

  // A dead owner is the strongest signal — steal regardless of age.
  const ownerAlive = isPidAlive(existing.pid);
  if (!ownerAlive) {
    return { type: "steal", reason: "dead-pid" };
  }

  // Owner looks alive but the lock has outlived the job timeout — the run is
  // wedged (or the PID was recycled by an unrelated process). Steal it.
  const age = now - existing.startedAt;
  if (age > timeoutMs) {
    return { type: "steal", reason: "stale" };
  }

  return { type: "blocked" };
}
