import { describe, it, expect } from "vitest";
import {
  EXTERNAL_SOURCES,
  EXTERNAL_SCAN_SOURCES,
  EXTERNAL_IMPORT_SOURCES,
  EXTERNAL_SOURCE_LABELS,
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

describe("source taxonomy", () => {
  it("EXTERNAL_SOURCES = scan sources then import sources, no overlap", () => {
    expect(EXTERNAL_SOURCES).toEqual([
      ...EXTERNAL_SCAN_SOURCES,
      ...EXTERNAL_IMPORT_SOURCES,
    ]);
    const overlap = EXTERNAL_SCAN_SOURCES.filter((s) =>
      (EXTERNAL_IMPORT_SOURCES as readonly string[]).includes(s),
    );
    expect(overlap).toEqual([]);
  });

  it("includes the import sources with distinct labels (incl. paste)", () => {
    expect([...EXTERNAL_IMPORT_SOURCES]).toEqual([
      "chatgpt",
      "claude-ai",
      "grok-export",
      "gemini-takeout",
      "paste",
    ]);
    expect(EXTERNAL_SOURCE_LABELS["gemini-takeout"]).toBe("Gemini (Takeout)");
    expect(EXTERNAL_SOURCE_LABELS["grok-export"]).toBe("Grok (export)");
    expect(EXTERNAL_SOURCE_LABELS.paste).toBe("Pasted");
  });

  it("every source has a non-empty human label", () => {
    for (const source of EXTERNAL_SOURCES) {
      expect(EXTERNAL_SOURCE_LABELS[source].length).toBeGreaterThan(0);
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
