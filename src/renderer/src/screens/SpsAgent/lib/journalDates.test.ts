import { describe, it, expect } from "vitest";
import {
  isoFromDate,
  hmFromDate,
  parseISO,
  monthLabel,
  monthGrid,
  addMonths,
  shiftYears,
  prettyDate,
} from "./journalDates";

describe("isoFromDate / hmFromDate", () => {
  it("formats local date and time, zero-padded", () => {
    const d = new Date(2026, 5, 5, 8, 7); // 5 Jun 2026 08:07 local
    expect(isoFromDate(d)).toBe("2026-06-05");
    expect(hmFromDate(d)).toBe("08:07");
  });
});

describe("parseISO", () => {
  it("parses valid keys (month is 0-based)", () => {
    expect(parseISO("2026-06-05")).toEqual({ year: 2026, month: 5, day: 5 });
  });
  it("rejects malformed keys", () => {
    expect(parseISO("2026-6-5")).toBeNull();
    expect(parseISO("not-a-date")).toBeNull();
    expect(parseISO("2026-13-01")).toBeNull();
  });
});

describe("monthGrid", () => {
  it("pads to a multiple of 7 and contains every day", () => {
    const cells = monthGrid(2026, 5); // June 2026
    expect(cells.length % 7).toBe(0);
    const days = cells.filter(Boolean);
    expect(days.length).toBe(30);
    expect(days[0]).toBe("2026-06-01");
    expect(days[29]).toBe("2026-06-30");
    // June 1 2026 is a Monday → exactly one leading null (Sunday).
    expect(cells[0]).toBeNull();
    expect(cells[1]).toBe("2026-06-01");
  });
});

describe("addMonths / shiftYears", () => {
  it("steps months and clamps to the 1st", () => {
    expect(addMonths("2026-06-15", 1)).toBe("2026-07-01");
    expect(addMonths("2026-01-31", -1)).toBe("2025-12-01");
  });
  it("shifts whole years preserving the day", () => {
    expect(shiftYears("2026-06-05", -1)).toBe("2025-06-05");
    expect(shiftYears("bad", -1)).toBeNull();
  });
});

describe("labels", () => {
  it("monthLabel and prettyDate are human-readable", () => {
    expect(monthLabel(2026, 5)).toBe("June 2026");
    expect(prettyDate("2026-06-05")).toBe("Fri, 5 Jun 2026");
  });
});
