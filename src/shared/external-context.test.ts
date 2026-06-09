import { describe, it, expect } from "vitest";
import {
  EXTERNAL_SOURCES,
  defaultExternalSourceConfig,
  formatProvenance,
} from "./external-context";

describe("defaultExternalSourceConfig", () => {
  it("disables every source by default (opt-in)", () => {
    const cfg = defaultExternalSourceConfig();
    for (const source of EXTERNAL_SOURCES) {
      expect(cfg[source]).toBe(false);
    }
  });
});

describe("formatProvenance", () => {
  it("renders source, project basename, branch and date — no full path, no URL", () => {
    const line = formatProvenance({
      source: "claude-code",
      projectPath: "/Users/amar/Desktop/MyCode/fathah_hermes",
      gitBranch: "main",
      ts: Date.UTC(2026, 5, 10),
    });
    expect(line).toContain("Claude Code");
    expect(line).toContain("project: fathah_hermes");
    expect(line).toContain("branch: main");
    expect(line).toContain("2026-06-10");
    expect(line).not.toContain("/Users/amar");
    expect(line).not.toContain("http");
  });

  it("omits missing fields gracefully", () => {
    const line = formatProvenance({ source: "grok" });
    expect(line).toBe("Grok");
  });

  it("includes a quoted title when present", () => {
    const line = formatProvenance({ source: "codex", title: "Refactor auth" });
    expect(line).toContain("Refactor auth");
  });
});
