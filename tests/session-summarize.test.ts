import { describe, it, expect } from "vitest";
import {
  buildSummaryPrompt,
  type SummarySearchResult,
} from "../src/shared/searchSummary";

const results: SummarySearchResult[] = [
  {
    sessionId: "sess-aaaaaa",
    title: "Deploy pipeline",
    startedAt: 1000,
    snippet: "we   switched   to   blue-green deploys",
  },
  {
    sessionId: "sess-bbbbbb",
    title: null,
    startedAt: 2000,
    snippet: "rollback was triggered by the health check",
  },
];

describe("buildSummaryPrompt", () => {
  it("returns a system + user turn", () => {
    const msgs = buildSummaryPrompt("deploys", results);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
  });

  it("numbers results [1], [2] and includes the query", () => {
    const msgs = buildSummaryPrompt("deploys", results);
    const user = msgs[1].content;
    expect(user).toContain("Query: deploys");
    expect(user).toContain("[1] Deploy pipeline:");
    expect(user).toContain("[2] Session bbbbbb:"); // null title → fallback label
  });

  it("collapses whitespace in snippets", () => {
    const user = buildSummaryPrompt("x", results)[1].content;
    expect(user).toContain("switched to blue-green deploys");
    expect(user).not.toContain("switched   to");
  });

  it("clips very long snippets", () => {
    const long: SummarySearchResult[] = [
      {
        sessionId: "s",
        title: "t",
        startedAt: 1,
        snippet: "x".repeat(1000),
      },
    ];
    const user = buildSummaryPrompt("q", long)[1].content;
    expect(user).toContain("…");
    expect(user.length).toBeLessThan(700);
  });

  it("instructs the model to cite with [n]", () => {
    const sys = buildSummaryPrompt("q", results)[0].content;
    expect(sys.toLowerCase()).toContain("cite");
  });
});
