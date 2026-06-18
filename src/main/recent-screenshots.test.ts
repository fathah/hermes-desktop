import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { mkdir, writeFile, utimes } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  importClipboardScreenshot,
  importRecentScreenshot,
  listRecentScreenshots,
} from "./recent-screenshots";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "recent-screenshots-test-"));
  roots.push(root);
  return root;
}

async function writeDatedFile(
  path: string,
  bytes: Buffer,
  modifiedAtMs: number,
): Promise<void> {
  await writeFile(path, bytes);
  const date = new Date(modifiedAtMs);
  await utimes(path, date, date);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("listRecentScreenshots", () => {
  it("returns newest safe screenshot candidates with ids and capped previews", async () => {
    const home = tempRoot();
    const desktop = join(home, "Desktop");
    await mkdir(desktop, { recursive: true });
    const nowMs = Date.UTC(2026, 5, 18, 8, 0, 0);

    await writeDatedFile(
      join(desktop, "Screenshot 2026-06-18 at 09.00.00.png"),
      Buffer.from("new"),
      nowMs - 1_000,
    );
    await writeDatedFile(
      join(desktop, "Screen Shot 2026-06-18 at 08.00.00.jpg"),
      Buffer.from("old"),
      nowMs - 10_000,
    );
    await writeDatedFile(
      join(desktop, "holiday.png"),
      Buffer.from("not-a-screenshot"),
      nowMs - 500,
    );
    await writeDatedFile(
      join(desktop, "Screenshot notes.txt"),
      Buffer.from("not-an-image"),
      nowMs - 250,
    );
    await writeDatedFile(
      join(desktop, "Screenshot 2026-05-01 at 08.00.00.png"),
      Buffer.from("too-old"),
      nowMs - 8 * 24 * 60 * 60 * 1000,
    );
    await writeDatedFile(
      join(desktop, "Xnapper 2026-06-18 at 07.00.00.png"),
      Buffer.from("x"),
      nowMs - 100,
    );
    await writeDatedFile(
      join(desktop, "CleanShot 2026-06-18 at 06.00.00.png"),
      Buffer.alloc(8),
      nowMs - 50,
    );

    const screenshots = await listRecentScreenshots({
      homeDir: home,
      nowMs,
      maxBytes: 4,
      maxPreviewBytes: 4,
    });

    expect(screenshots.map((screenshot) => screenshot.originalName)).toEqual([
      "Xnapper 2026-06-18 at 07.00.00.png",
      "Screenshot 2026-06-18 at 09.00.00.png",
      "Screen Shot 2026-06-18 at 08.00.00.jpg",
    ]);
    expect(screenshots[0].id).toMatch(/^[a-f0-9]{64}$/);
    expect(screenshots[1].previewDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(screenshots[0]).not.toHaveProperty("sourcePath");
  });

  it("includes the configured macOS screenshot location before fallback dirs", async () => {
    const home = tempRoot();
    const configured = join(home, "Custom Screenshots");
    const desktop = join(home, "Desktop");
    await mkdir(configured, { recursive: true });
    await mkdir(desktop, { recursive: true });
    const nowMs = Date.UTC(2026, 5, 18, 8, 0, 0);

    await writeDatedFile(
      join(configured, "Screenshot Custom.png"),
      Buffer.from("configured"),
      nowMs - 2_000,
    );
    await writeDatedFile(
      join(desktop, "Screenshot Desktop.png"),
      Buffer.from("desktop"),
      nowMs - 1_000,
    );

    const screenshots = await listRecentScreenshots({
      homeDir: home,
      nowMs,
      readMacScreenshotLocation: async () => configured,
    });

    expect(screenshots.map((screenshot) => screenshot.originalName)).toEqual([
      "Screenshot Desktop.png",
      "Screenshot Custom.png",
    ]);
  });
});

describe("importRecentScreenshot", () => {
  it("imports the selected candidate to _assets and creates a screenshot inbox capture", async () => {
    const home = tempRoot();
    const vault = tempRoot();
    const desktop = join(home, "Desktop");
    await mkdir(desktop, { recursive: true });
    const nowMs = Date.UTC(2026, 5, 18, 8, 0, 0);
    const screenshotBytes = Buffer.from("fake-png");

    await writeDatedFile(
      join(desktop, "Screenshot 2026-06-18 at 09.00.00.png"),
      screenshotBytes,
      nowMs - 1_000,
    );
    await writeDatedFile(
      join(desktop, "Screenshot 2026-06-18 at 10.00.00.png"),
      Buffer.from("newer"),
      nowMs - 500,
    );
    const candidates = await listRecentScreenshots({ homeDir: home, nowMs });
    const selected = candidates.find((candidate) =>
      candidate.originalName.includes("09.00.00"),
    );

    const result = await importRecentScreenshot(
      vault,
      {
        candidateId: selected?.id,
        note: "Use this in the launch checklist.",
      },
      { homeDir: home, nowMs },
    );

    expect(result).toMatchObject({
      ok: true,
      originalName: "Screenshot 2026-06-18 at 09.00.00.png",
      modifiedAt: nowMs - 1_000,
      source: "recent-file",
    });
    if (!result.ok) throw new Error(result.error);
    expect(result).not.toHaveProperty("sourcePath");
    expect(result.assetPath).toMatch(/^[a-f0-9]{64}\.png$/);
    expect(existsSync(join(vault, "_assets", result.assetPath))).toBe(true);
    expect(statSync(join(vault, "_assets", result.assetPath)).size).toBe(
      screenshotBytes.length,
    );

    const capture = readFileSync(
      join(vault, "_inbox", `${result.captureId}.md`),
      "utf-8",
    );
    expect(capture).toContain('source: "screenshot"');
    expect(capture).toContain('captureKind: "source"');
    expect(capture).toContain('schema: "source"');
    expect(capture).toContain(
      'provenance: "SPS Sources recent screenshot import"',
    );
    expect(capture).toContain(`![Screenshot](../_assets/${result.assetPath})`);
    expect(capture).toContain(
      "Imported from Screenshot 2026-06-18 at 09.00.00.png.",
    );
    expect(capture).toContain("Note: Use this in the launch checklist.");
    expect(capture).not.toContain(desktop);
  });

  it("returns a stale result when a selected candidate can no longer be resolved", async () => {
    const home = tempRoot();
    const vault = tempRoot();
    await mkdir(join(home, "Desktop"), { recursive: true });

    await expect(
      importRecentScreenshot(
        vault,
        { candidateId: "missing-candidate" },
        { homeDir: home, nowMs: Date.now() },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "stale-candidate",
      error: "That screenshot is no longer available.",
    });
  });

  it("returns a user-facing not-found result when no recent screenshots exist", async () => {
    const home = tempRoot();
    const vault = tempRoot();
    await mkdir(join(home, "Desktop"), { recursive: true });

    await expect(
      importRecentScreenshot(vault, {}, { homeDir: home, nowMs: Date.now() }),
    ).resolves.toEqual({
      ok: false,
      reason: "not-found",
      error: "No recent screenshots found.",
    });
  });
});

describe("importClipboardScreenshot", () => {
  it("writes clipboard screenshot bytes through the same asset and capture path", async () => {
    const vault = tempRoot();
    const nowMs = Date.UTC(2026, 5, 18, 8, 0, 0);

    const result = await importClipboardScreenshot(
      vault,
      Buffer.from("clipboard-png"),
      { note: "From clipboard." },
      { nowMs },
    );

    expect(result).toMatchObject({
      ok: true,
      originalName: "Clipboard screenshot.png",
      source: "clipboard",
      modifiedAt: nowMs,
    });
    if (!result.ok) throw new Error(result.error);
    const capture = readFileSync(
      join(vault, "_inbox", `${result.captureId}.md`),
      "utf-8",
    );
    expect(capture).toContain(`![Screenshot](../_assets/${result.assetPath})`);
    expect(capture).toContain("Imported from Clipboard screenshot.png.");
    expect(capture).toContain("Note: From clipboard.");
  });

  it("returns a clipboard-empty result when no image bytes are available", async () => {
    const vault = tempRoot();

    await expect(
      importClipboardScreenshot(vault, Buffer.alloc(0), {}, { nowMs: 1 }),
    ).resolves.toEqual({
      ok: false,
      reason: "clipboard-empty",
      error: "No screenshot image found on the clipboard.",
    });
  });
});
