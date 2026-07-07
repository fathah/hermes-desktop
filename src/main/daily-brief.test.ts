import { describe, expect, it } from "vitest";
import {
  buildDailyBriefMarkdown,
  dailyBriefDeliveryBody,
  dailyBriefFileName,
  extractOptedInDailyBrief,
} from "./daily-brief";

describe("daily brief capsules", () => {
  it("uses a stable Daily Brief filename", () => {
    expect(dailyBriefFileName(new Date("2026-06-26T12:00:00.000Z"))).toBe(
      "Daily Brief - 2026-06-26.md",
    );
  });

  it("wraps generated content in review-first frontmatter", () => {
    const markdown = buildDailyBriefMarkdown({
      date: new Date("2026-06-26T12:00:00.000Z"),
      body: "# Daily Brief - 2026-06-26\n\nOpen loops.",
    });

    expect(markdown).toContain('title: "Daily Brief - 2026-06-26"');
    expect(markdown).toContain("kind: daily-brief");
    expect(markdown).toContain("context: review");
    expect(markdown).toContain("# Daily Brief - 2026-06-26");
  });

  it("only extracts a daily brief for assistant context after markdown opt-in", () => {
    const review = buildDailyBriefMarkdown({
      date: new Date("2026-06-26T12:00:00.000Z"),
      body: "# Daily Brief - 2026-06-26\n\nReview me first.",
    });
    const include = review.replace("context: review", "context: include");

    expect(extractOptedInDailyBrief(review)).toBe("");
    expect(extractOptedInDailyBrief(include)).toContain("Review me first.");
  });

  it("summarizes markdown into a compact delivery body", () => {
    const markdown = buildDailyBriefMarkdown({
      date: new Date("2026-06-26T12:00:00.000Z"),
      body: [
        "# Daily Brief - 2026-06-26",
        "",
        "Review **open loops** in [Inbox](sps://inbox).",
      ].join("\n"),
    });

    expect(dailyBriefDeliveryBody(markdown)).toBe(
      "Daily Brief - 2026-06-26 Review open loops in Inbox.",
    );
  });
});
