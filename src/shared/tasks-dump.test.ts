import { describe, expect, it } from "vitest";
import {
  advanceNagRecord,
  createNagRecord,
  escalationTier,
  isNagDue,
  nagIntervalMs,
  type TaskNagRecord,
} from "./tasks-dump";

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const NOW = 1_700_000_000_000;

describe("nagIntervalMs", () => {
  it("never nags on cadence 'none'", () => {
    expect(nagIntervalMs(0, "none")).toBe(Number.POSITIVE_INFINITY);
    expect(nagIntervalMs(50, "none")).toBe(Number.POSITIVE_INFINITY);
  });

  it("is daily for the first week of nags, then weekly", () => {
    expect(nagIntervalMs(0, "daily")).toBe(DAY);
    expect(nagIntervalMs(6, "daily")).toBe(DAY);
    expect(nagIntervalMs(7, "daily")).toBe(WEEK);
    expect(nagIntervalMs(20, "daily")).toBe(WEEK);
  });

  it("is always weekly on cadence 'weekly'", () => {
    expect(nagIntervalMs(0, "weekly")).toBe(WEEK);
    expect(nagIntervalMs(99, "weekly")).toBe(WEEK);
  });
});

describe("escalationTier", () => {
  it("rises badge → notification → channel with the nag count", () => {
    expect(escalationTier(0)).toBe("badge");
    expect(escalationTier(1)).toBe("badge");
    expect(escalationTier(2)).toBe("notification");
    expect(escalationTier(3)).toBe("notification");
    expect(escalationTier(4)).toBe("channel");
    expect(escalationTier(10)).toBe("channel");
  });
});

describe("createNagRecord", () => {
  it("starts at count 0 and schedules the first chase one interval out", () => {
    const record = createNagRecord("tasks/t1", "daily", NOW);
    expect(record.rowId).toBe("tasks/t1");
    expect(record.nagCount).toBe(0);
    expect(record.cadence).toBe("daily");
    expect(record.nextNagAt).toBe(NOW + DAY);
  });

  it("schedules at now for cadence 'none' (never becomes due)", () => {
    const record = createNagRecord("tasks/t1", "none", NOW);
    expect(record.nextNagAt).toBe(NOW);
    expect(isNagDue(record, NOW + WEEK)).toBe(false);
  });
});

describe("advanceNagRecord", () => {
  it("bumps the count, records the time, and reschedules", () => {
    const start = createNagRecord("tasks/t1", "daily", NOW);
    const next = advanceNagRecord(start, NOW + DAY);
    expect(next.nagCount).toBe(1);
    expect(next.lastNaggedAt).toBe(NOW + DAY);
    expect(next.nextNagAt).toBe(NOW + DAY + DAY);
  });

  it("decays to weekly spacing once past the first week of nags", () => {
    let record: TaskNagRecord = createNagRecord("tasks/t1", "daily", NOW);
    for (let i = 0; i < 7; i++)
      record = advanceNagRecord(record, NOW + i * DAY);
    expect(record.nagCount).toBe(7);
    const advanced = advanceNagRecord(record, NOW + 7 * DAY);
    expect(advanced.nextNagAt).toBe(NOW + 7 * DAY + WEEK);
  });
});

describe("isNagDue", () => {
  const base = createNagRecord("tasks/t1", "daily", NOW);

  it("is due once past nextNagAt", () => {
    expect(isNagDue(base, NOW)).toBe(false);
    expect(isNagDue(base, NOW + DAY)).toBe(true);
  });

  it("is suppressed while snoozed", () => {
    const snoozed: TaskNagRecord = { ...base, snoozedUntil: NOW + 2 * DAY };
    expect(isNagDue(snoozed, NOW + DAY)).toBe(false);
    expect(isNagDue(snoozed, NOW + 3 * DAY)).toBe(true);
  });

  it("is suppressed when done", () => {
    const done: TaskNagRecord = { ...base, done: true };
    expect(isNagDue(done, NOW + WEEK)).toBe(false);
  });
});
