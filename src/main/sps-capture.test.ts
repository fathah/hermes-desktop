import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSpsCaptureMarkdown, writeSpsCapture } from "./sps-capture";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "sps-capture-test-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("buildSpsCaptureMarkdown", () => {
  it("serializes Learn This web metadata, selections, and highlights", () => {
    const markdown = buildSpsCaptureMarkdown({
      source: "web",
      title: "Obsidian Help",
      description: "Official docs",
      url: "https://obsidian.md/help/",
      body: "Captured body",
      capturedAt: 1_700_000_000_000,
      selection: "Selected paragraph",
      highlights: [" first ", "", "second"],
    });

    expect(markdown).toContain('title: "Obsidian Help"');
    expect(markdown).toContain('description: "Official docs"');
    expect(markdown).toContain('status: "unprocessed"');
    expect(markdown).toContain('selection: "Selected paragraph"');
    expect(markdown).toContain('highlights: ["first","second"]');
    expect(markdown.endsWith("Captured body")).toBe(true);
  });

  it("serializes Obsidian-aware capture classification metadata", () => {
    const markdown = buildSpsCaptureMarkdown({
      source: "quick-note",
      captureKind: "decision",
      schema: "decision",
      links: ["Project-Atlas", "Person-Maya"],
      provenance: "Captured from Obsidian active note",
      body: "We will use the review queue.",
      capturedAt: 1_700_000_000_000,
    });

    expect(markdown).toContain('captureKind: "decision"');
    expect(markdown).toContain('schema: "decision"');
    expect(markdown).toContain('links: ["Project-Atlas","Person-Maya"]');
    expect(markdown).toContain(
      'provenance: "Captured from Obsidian active note"',
    );
  });
});

describe("writeSpsCapture", () => {
  it("writes captures through the _inbox row folder", async () => {
    const vaultDir = tempRoot();

    const result = await writeSpsCapture(
      vaultDir,
      {
        source: "quick-note",
        body: "A durable idea",
        capturedAt: 1,
      },
      "cap_test",
    );

    expect(result).toEqual({ success: true, id: "cap_test" });
    expect(readFileSync(join(vaultDir, "_inbox", "cap_test.md"), "utf-8")).toContain(
      "A durable idea",
    );
  });
});
