import { describe, it, expect, beforeEach } from "vitest";
import {
  getOcrDefer,
  setOcrDefer,
  getOcrTime,
  setOcrTime,
  isScheduledNow,
} from "../src/renderer/src/screens/SpsAgent/lib/ocrSchedule";

// Overnight OCR scheduling (item 2, P3). Default OFF; persisted in localStorage.

describe("ocrSchedule settings", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to no deferral and 02:00", () => {
    expect(getOcrDefer()).toBe(false);
    expect(getOcrTime()).toBe("02:00");
  });

  it("persists the defer flag and time", () => {
    setOcrDefer(true);
    setOcrTime("23:30");
    expect(getOcrDefer()).toBe(true);
    expect(getOcrTime()).toBe("23:30");
  });
});

describe("isScheduledNow", () => {
  const at = (h: number, m: number): Date => new Date(2026, 5, 6, h, m, 0);

  it("is true only within the configured minute", () => {
    expect(isScheduledNow(at(2, 0), "02:00")).toBe(true);
    expect(isScheduledNow(at(2, 1), "02:00")).toBe(false);
    expect(isScheduledNow(at(1, 59), "02:00")).toBe(false);
    expect(isScheduledNow(at(23, 30), "23:30")).toBe(true);
  });

  it("is false for a malformed time", () => {
    expect(isScheduledNow(at(2, 0), "nope")).toBe(false);
  });
});
