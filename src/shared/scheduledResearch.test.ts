import { describe, it, expect } from "vitest";
import {
  slugForTopic,
  validateScheduleInput,
  buildMonitorDiscoveryPrompt,
  buildMonitorSourceHint,
  meetsImportanceThreshold,
  normalizeMonitorSourcePlan,
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

  it("accepts monitor source focus, threshold, and Telegram summary mode", () => {
    expect(
      validateScheduleInput({
        topic: "AI agent launches",
        cadence: "weekly",
        sourceIntent: "rss",
        importanceThreshold: "noteworthy",
        telegramPush: true,
        telegramMode: "summary-only",
        sourcePlan: [
          {
            id: "rss-agent-feed",
            kind: "rss",
            label: "Agent Feed",
            url: "https://example.com/feed",
            status: "approved",
          },
        ],
      }),
    ).toBeNull();
  });

  it("rejects invalid monitor source focus, threshold, and Telegram mode", () => {
    expect(
      validateScheduleInput({
        topic: "x",
        cadence: "daily",
        sourceIntent: "x" as never,
      }),
    ).toMatch(/source focus/i);
    expect(
      validateScheduleInput({
        topic: "x",
        cadence: "daily",
        importanceThreshold: "urgent" as never,
      }),
    ).toMatch(/importance/i);
    expect(
      validateScheduleInput({
        topic: "x",
        cadence: "daily",
        telegramPush: true,
        telegramMode: "chat" as never,
      }),
    ).toMatch(/telegram/i);
  });
});

describe("monitor source helpers", () => {
  it("normalizes approved source plans and rejects unsafe URLs", () => {
    const plan = normalizeMonitorSourcePlan([
      {
        kind: "rss",
        label: "Agent Feed",
        url: "HTTPS://Example.com/feed#fragment",
        status: "approved",
        lastCheckedAt: 123,
      },
      {
        kind: "rss",
        label: "Duplicate",
        url: "https://example.com/feed",
        status: "suggested",
      },
      {
        kind: "rss",
        label: "Bad",
        url: "javascript:alert(1)",
        status: "approved",
      },
      {
        kind: "social",
        label: "Reddit search",
        query: "  reddit   AI agents  ",
        status: "unavailable",
      },
    ]);

    expect(plan).toEqual([
      {
        id: expect.stringMatching(/^rss_/),
        kind: "rss",
        label: "Agent Feed",
        url: "https://example.com/feed",
        status: "approved",
        lastCheckedAt: 123,
      },
      {
        id: expect.stringMatching(/^social_/),
        kind: "social",
        label: "Reddit search",
        query: "reddit AI agents",
        status: "unavailable",
      },
    ]);
  });

  it("builds a discovery prompt that treats suggestions as reviewable metadata", () => {
    const prompt = buildMonitorDiscoveryPrompt(
      "competitor pricing changes",
      "social",
    );

    expect(prompt).toContain("competitor pricing changes");
    expect(prompt).toContain("reviewable");
    expect(prompt).toContain("social");
    expect(prompt).toContain("Do not claim Reddit/X coverage");
  });

  it("builds run source hints from approved sources only", () => {
    const sourcePlan = normalizeMonitorSourcePlan([
      {
        kind: "rss",
        label: "Agent Feed",
        url: "https://example.com/feed",
        status: "approved",
      },
      {
        kind: "web",
        label: "Ignored web",
        query: "ignored query",
        status: "ignored",
      },
    ]);

    const itemWithSources: ScheduledResearchItem = {
      id: "sr_x",
      topic: "AI agent launches",
      pageId: "ai-agent-launches",
      cadence: "weekly",
      hour: 8,
      autoApply: false,
      enabled: true,
      createdAt: 0,
      lastRunAt: 0,
      lastChangeHash: "",
      sourceIntent: "rss",
      sourcePlan,
      importanceThreshold: "breaking",
      telegramPush: true,
      telegramMode: "summary-only",
    };

    const hint = buildMonitorSourceHint(itemWithSources);

    expect(hint).toContain("Source focus: rss");
    expect(hint).toContain("RSS: Agent Feed (https://example.com/feed)");
    expect(hint).not.toContain("ignored query");
    expect(hint).toContain("Importance threshold: breaking");
    expect(hint).toContain("Telegram push requested: summary-only");
  });

  it("compares importance classifications against the configured threshold", () => {
    expect(meetsImportanceThreshold("digest", "digest")).toBe(true);
    expect(meetsImportanceThreshold("digest", "noteworthy")).toBe(false);
    expect(meetsImportanceThreshold("noteworthy", "noteworthy")).toBe(true);
    expect(meetsImportanceThreshold("noteworthy", "breaking")).toBe(false);
    expect(meetsImportanceThreshold("breaking", "noteworthy")).toBe(true);
    expect(meetsImportanceThreshold("breaking", "breaking")).toBe(true);
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
