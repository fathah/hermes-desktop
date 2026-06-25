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

  it("serializes visual capture metadata for save-first image captures", () => {
    const markdown = buildSpsCaptureMarkdown({
      source: "image",
      title: "Camera capture",
      body: "![Capture](../_assets/camera.png)",
      capturedAt: 1_700_000_000_000,
      assetPath: "camera.png",
      originalName: "camera.png",
      mime: "image/png",
      captureOrigin: "camera",
      ocrStatus: "not-run",
    });

    expect(markdown).toContain('source: "image"');
    expect(markdown).toContain('assetPath: "camera.png"');
    expect(markdown).toContain('originalName: "camera.png"');
    expect(markdown).toContain('mime: "image/png"');
    expect(markdown).toContain('captureOrigin: "camera"');
    expect(markdown).toContain('ocrStatus: "not-run"');
    expect(markdown.endsWith("![Capture](../_assets/camera.png)")).toBe(true);
  });

  it("serializes email triage metadata and attachment references", () => {
    const markdown = buildSpsCaptureMarkdown({
      source: "email",
      title: "Bluebay roster change",
      body: "## Message\n\nPlease update tonight's roster.",
      capturedAt: 1_700_000_000_000,
      triageLabel: "action",
      triageReason: "Matched allowlisted sender and roster keyword.",
      triageConfidence: 0.92,
      emailAccount: "Ops inbox",
      messageId: "<msg-1@example.com>",
      folder: "INBOX",
      uid: 42,
      attachments: [
        {
          assetPath: "a".repeat(64) + ".pdf",
          originalName: "roster.pdf",
          mime: "application/pdf",
          size: 1200,
        },
      ],
    });

    expect(markdown).toContain('source: "email"');
    expect(markdown).toContain('triageLabel: "action"');
    expect(markdown).toContain(
      'triageReason: "Matched allowlisted sender and roster keyword."',
    );
    expect(markdown).toContain("triageConfidence: 0.92");
    expect(markdown).toContain('emailAccount: "Ops inbox"');
    expect(markdown).toContain('messageId: "<msg-1@example.com>"');
    expect(markdown).toContain('folder: "INBOX"');
    expect(markdown).toContain("uid: 42");
    expect(markdown).toContain('"originalName":"roster.pdf"');
    expect(markdown.endsWith("Please update tonight's roster.")).toBe(true);
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
    expect(
      readFileSync(join(vaultDir, "_inbox", "cap_test.md"), "utf-8"),
    ).toContain("A durable idea");
  });
});
