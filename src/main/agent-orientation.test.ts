import { describe, expect, it } from "vitest";
import { buildAgentOrientationMarkdown } from "./agent-orientation";

describe("Agent Orientation", () => {
  it("builds a vault-local markdown orientation without secrets or raw URLs", () => {
    const markdown = buildAgentOrientationMarkdown({
      generatedAt: new Date("2026-06-26T00:00:00.000Z"),
      rules: ["Keep secrets out of logs.", "Prefer markdown-first storage."],
      enabledExternalSources: ["Codex", "Claude Code"],
    });

    expect(markdown).toContain('title: "Agent Orientation"');
    expect(markdown).toContain("kind: agent-orientation");
    expect(markdown).toContain("context: include");
    expect(markdown).toContain("# Agent Orientation");
    expect(markdown).toContain("- Keep secrets out of logs.");
    expect(markdown).toContain("- Codex");
    expect(markdown).toContain("Daily Brief pages enter context only after");
    expect(markdown).not.toContain("apiKey");
    expect(markdown).not.toContain("token=");
    expect(markdown).not.toContain("http://");
    expect(markdown).not.toContain("https://");
  });
});
