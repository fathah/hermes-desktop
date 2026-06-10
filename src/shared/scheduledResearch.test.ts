import { describe, it, expect } from "vitest";
import {
  slugForTopic,
  validateScheduleInput,
  periodKey,
  periodStart,
  isDue,
  cadenceLabel,
  cronExprFor,
  type ScheduledResearchItem,
} from "./scheduledResearch";
import { hasUsableSources } from "./research";

describe("slugForTopic", () => {
  it("slugifies to [a-z0-9_-]", () => {
    expect(slugForTopic("UK SIA Guarding-Licence changes!")).toBe(
      "uk-sia-guarding-licence-changes",
    );
  });
  it("never returns empty", () => {
    expect(slugForTopic("…?!")).toBe("topic");
  });
});

describe("validateScheduleInput", () => {
  it("accepts a valid input", () => {
    expect(
      validateScheduleInput({ topic: "x", cadence: "weekly", hour: 8 }),
    ).toBeNull();
  });
  it("rejects empty topic, bad cadence, bad hour", () => {
    expect(validateScheduleInput({ topic: " ", cadence: "weekly" })).toMatch(
      /topic/i,
    );
    expect(
      // @ts-expect-error testing invalid cadence
      validateScheduleInput({ topic: "x", cadence: "hourly" }),
    ).toMatch(/cadence/i);
    expect(
      validateScheduleInput({ topic: "x", cadence: "daily", hour: 25 }),
    ).toMatch(/hour/i);
  });
});

describe("periodKey", () => {
  it("buckets daily/weekly/monthly", () => {
    const a = new Date(2026, 5, 9, 10); // Tue 2026-06-09
    const b = new Date(2026, 5, 10, 10); // Wed 2026-06-10 (same week, same month)
    expect(periodKey("daily", a)).not.toBe(periodKey("daily", b));
    expect(periodKey("weekly", a)).toBe(periodKey("weekly", b));
    expect(periodKey("monthly", a)).toBe(periodKey("monthly", b));
  });
});

describe("periodStart", () => {
  it("returns the start of the current period (local midnight boundaries)", () => {
    const wed = new Date(2026, 5, 10, 14, 30); // Wed 2026-06-10 14:30
    expect(periodStart("daily", wed)).toBe(new Date(2026, 5, 10).getTime());
    // Monday of that week is 2026-06-08.
    expect(periodStart("weekly", wed)).toBe(new Date(2026, 5, 8).getTime());
    expect(periodStart("monthly", wed)).toBe(new Date(2026, 5, 1).getTime());
  });

  it("the period start is never after now", () => {
    const now = new Date(2026, 0, 1, 0, 0); // Thu 2026-01-01 midnight
    for (const c of ["daily", "weekly", "monthly"] as const) {
      expect(periodStart(c, now)).toBeLessThanOrEqual(now.getTime());
    }
  });
});

function item(
  over: Partial<ScheduledResearchItem> = {},
): ScheduledResearchItem {
  return {
    id: "sr_x",
    topic: "t",
    pageId: "t",
    cadence: "daily",
    hour: 8,
    autoApply: false,
    telegramPush: false,
    enabled: true,
    createdAt: 0,
    lastRunAt: 0,
    lastChangeHash: "",
    ...over,
  };
}

describe("isDue", () => {
  it("first run is due once the hour passes", () => {
    expect(
      isDue(item({ lastRunAt: 0, hour: 8 }), new Date(2026, 5, 9, 9)),
    ).toBe(true);
    expect(
      isDue(item({ lastRunAt: 0, hour: 8 }), new Date(2026, 5, 9, 7)),
    ).toBe(false);
  });
  it("disabled is never due", () => {
    expect(isDue(item({ enabled: false }), new Date(2026, 5, 9, 12))).toBe(
      false,
    );
  });
  it("daily: not due twice in one day, due the next day", () => {
    const ran = new Date(2026, 5, 9, 8).getTime();
    expect(isDue(item({ lastRunAt: ran }), new Date(2026, 5, 9, 20))).toBe(
      false,
    );
    expect(isDue(item({ lastRunAt: ran }), new Date(2026, 5, 10, 8))).toBe(
      true,
    );
  });
  it("weekly: not due same week, due next week", () => {
    const ran = new Date(2026, 5, 9, 8).getTime(); // Tue
    expect(
      isDue(
        item({ cadence: "weekly", lastRunAt: ran }),
        new Date(2026, 5, 11, 8),
      ),
    ).toBe(false); // Thu same week
    expect(
      isDue(
        item({ cadence: "weekly", lastRunAt: ran }),
        new Date(2026, 5, 16, 8),
      ),
    ).toBe(true); // next Tue
  });
});

describe("cronExprFor", () => {
  it("maps cadence+hour to a 5-field cron expr", () => {
    expect(cronExprFor("daily", 8)).toBe("0 8 * * *");
    expect(cronExprFor("weekly", 9)).toBe("0 9 * * 1");
    expect(cronExprFor("monthly", 6)).toBe("0 6 1 * *");
  });
  it("clamps the hour", () => {
    expect(cronExprFor("daily", 30)).toBe("0 23 * * *");
    expect(cronExprFor("daily", -5)).toBe("0 0 * * *");
  });
});

describe("cadenceLabel", () => {
  it("renders readable labels", () => {
    expect(cadenceLabel("daily", 8)).toBe("Daily · 08:00");
    expect(cadenceLabel("weekly", 9)).toContain("Weekly");
  });
});

describe("hasUsableSources", () => {
  it("requires a ## Sources heading and an http link", () => {
    expect(
      hasUsableSources("# T\nbody\n## Sources\n- [a](https://a.com)"),
    ).toBe(true);
    expect(hasUsableSources("# T\nno sources here")).toBe(false);
    expect(hasUsableSources("## Sources\n- no link")).toBe(false);
  });
});
