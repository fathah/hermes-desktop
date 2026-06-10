import { describe, it, expect } from "vitest";
import {
  decideLockAcquisition,
  parseLockRecord,
  serializeLockRecord,
  type LockRecord,
} from "./scheduler-lock";

// Pure stale-lock decision logic for the routine scheduler (Phase 1.2).
// The old lock was a bare existsSync on /tmp/hermes-routine-<id>.lock: a job that
// crashed mid-run orphaned the file and that job was skipped FOREVER. This module
// decides acquisition from the lock record + liveness, so it self-heals.

const TIMEOUT_MS = 15 * 60 * 1000;
const NOW = 1_000_000_000_000;

const alive = (): boolean => true;
const dead = (): boolean => false;

describe("scheduler lock acquisition decision", () => {
  it("acquires when no lock exists", () => {
    const decision = decideLockAcquisition(null, NOW, TIMEOUT_MS, alive);
    expect(decision.type).toBe("acquire");
  });

  it("is blocked by a live, fresh lock", () => {
    const existing: LockRecord = { pid: 4242, startedAt: NOW - 1000 };
    const decision = decideLockAcquisition(existing, NOW, TIMEOUT_MS, alive);
    expect(decision.type).toBe("blocked");
  });

  it("steals a lock whose owner process is dead", () => {
    const existing: LockRecord = { pid: 4242, startedAt: NOW - 1000 };
    const decision = decideLockAcquisition(existing, NOW, TIMEOUT_MS, dead);
    expect(decision.type).toBe("steal");
    if (decision.type === "steal") {
      expect(decision.reason).toBe("dead-pid");
    }
  });

  it("steals a lock older than the timeout even if the pid still looks alive", () => {
    const existing: LockRecord = {
      pid: 4242,
      startedAt: NOW - (TIMEOUT_MS + 1),
    };
    const decision = decideLockAcquisition(existing, NOW, TIMEOUT_MS, alive);
    expect(decision.type).toBe("steal");
    if (decision.type === "steal") {
      expect(decision.reason).toBe("stale");
    }
  });

  it("prefers the dead-pid reason when a lock is both dead and stale", () => {
    const existing: LockRecord = {
      pid: 4242,
      startedAt: NOW - (TIMEOUT_MS + 1),
    };
    const decision = decideLockAcquisition(existing, NOW, TIMEOUT_MS, dead);
    expect(decision.type).toBe("steal");
    if (decision.type === "steal") {
      expect(decision.reason).toBe("dead-pid");
    }
  });
});

describe("lock record parse/serialize", () => {
  it("round-trips a JSON record", () => {
    const record: LockRecord = { pid: 99, startedAt: NOW };
    const parsed = parseLockRecord(serializeLockRecord(record));
    expect(parsed).toEqual(record);
  });

  it("returns null for unparseable contents", () => {
    expect(parseLockRecord("not json")).toBeNull();
    expect(parseLockRecord("")).toBeNull();
  });

  it("treats a legacy bare-PID lock as immediately stealable (startedAt 0)", () => {
    const parsed = parseLockRecord("12345");
    expect(parsed).not.toBeNull();
    expect(parsed?.pid).toBe(12345);
    // startedAt 0 => older than any timeout => stealable, so legacy locks
    // never wedge a job permanently after upgrade.
    expect(parsed?.startedAt).toBe(0);
  });

  it("returns null when the JSON lacks a numeric pid", () => {
    expect(parseLockRecord(JSON.stringify({ startedAt: NOW }))).toBeNull();
  });
});
