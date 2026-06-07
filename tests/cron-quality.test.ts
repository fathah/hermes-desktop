import { describe, it, expect } from "vitest";
import {
  augmentPrompt,
  freshnessLabel,
  parseCreatedJobId,
} from "../src/main/cron-quality";

describe("parseCreatedJobId", () => {
  it("extracts the id from create's stdout", () => {
    expect(parseCreatedJobId("Created job: abc123\n  Name: x")).toBe("abc123");
  });
  it("is case-insensitive and tolerates color/whitespace", () => {
    expect(parseCreatedJobId("created job:   job_99  ")).toBe("job_99");
  });
  it("returns null when there's no id line", () => {
    expect(parseCreatedJobId("Failed to create job: boom")).toBeNull();
    expect(parseCreatedJobId("")).toBeNull();
  });
});

describe("freshnessLabel", () => {
  it("renders the coarsest natural unit", () => {
    expect(freshnessLabel(30)).toBe("30 minute(s)");
    expect(freshnessLabel(60)).toBe("1 hour(s)");
    expect(freshnessLabel(360)).toBe("6 hour(s)");
    expect(freshnessLabel(1440)).toBe("1 day(s)");
    expect(freshnessLabel(10080)).toBe("1 week(s)");
  });
});

describe("augmentPrompt", () => {
  it("returns the prompt unchanged when there are no opts", () => {
    expect(augmentPrompt("do the thing")).toBe("do the thing");
  });

  it("appends an Operating rules block under the prompt", () => {
    const out = augmentPrompt("morning brief", { failureBehavior: "notify" });
    expect(out).toContain("morning brief");
    expect(out).toContain("Operating rules:");
    expect(out.indexOf("Operating rules:")).toBeGreaterThan(
      out.indexOf("morning brief"),
    );
  });

  it("includes the freshness window only when > 0", () => {
    const withWindow = augmentPrompt("x", { freshnessWindowMinutes: 1440 });
    expect(withWindow).toContain("last 1 day(s)");
    const noWindow = augmentPrompt("x", { freshnessWindowMinutes: 0 });
    expect(noWindow).not.toContain("Only consider items");
  });

  it("varies the failure clause by behavior", () => {
    expect(augmentPrompt("x", { failureBehavior: "retry" })).toContain(
      "retry once",
    );
    expect(augmentPrompt("x", { failureBehavior: "ignore" })).toContain(
      "produce no output",
    );
    expect(augmentPrompt("x", { failureBehavior: "notify" })).toContain(
      "do not fabricate",
    );
  });

  it("works with an empty prompt (rules become the whole instruction)", () => {
    const out = augmentPrompt("", { freshnessWindowMinutes: 60 });
    expect(out.startsWith("Operating rules:")).toBe(true);
  });
});
