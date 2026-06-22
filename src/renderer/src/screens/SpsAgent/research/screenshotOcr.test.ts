import { describe, expect, it } from "vitest";
import {
  appendScreenshotOcr,
  buildScreenshotStudyCorpus,
} from "./screenshotOcr";
import type { SpsRecentScreenshotImportResult } from "../../../../../shared/recent-screenshots";

const imported: Extract<SpsRecentScreenshotImportResult, { ok: true }> = {
  ok: true,
  captureId: "cap-shot",
  assetPath: "a".repeat(64) + ".png",
  originalName: "Screenshot 2026-06-18 at 10.00.00.png",
  modifiedAt: 1_797_000_100_000,
  source: "recent-file",
};

describe("appendScreenshotOcr", () => {
  it("adds an OCR section without removing existing capture markdown", () => {
    const markdown =
      '---\ntitle: "Screenshot"\nsource: "screenshot"\n---\n\n![Screenshot](../_assets/a.png)\n';

    expect(appendScreenshotOcr(markdown, " Extracted text. ")).toBe(
      '---\ntitle: "Screenshot"\nsource: "screenshot"\nocrStatus: "complete"\n---\n\n![Screenshot](../_assets/a.png)\n\n## OCR Text\n\nExtracted text.',
    );
  });

  it("replaces an existing OCR section instead of duplicating it", () => {
    const markdown =
      '---\ntitle: "Screenshot"\n---\n\n![Screenshot](../_assets/a.png)\n\n## OCR Text\n\nOld text.';

    expect(appendScreenshotOcr(markdown, "New text.")).toContain(
      "## OCR Text\n\nNew text.",
    );
    expect(appendScreenshotOcr(markdown, "New text.")).not.toContain(
      "Old text.",
    );
  });
});

describe("buildScreenshotStudyCorpus", () => {
  it("uses explicit OCR text when available", () => {
    expect(
      buildScreenshotStudyCorpus(imported, "OCR says checkout failed."),
    ).toContain("OCR says checkout failed.");
  });

  it("is honest when OCR has not been run", () => {
    expect(buildScreenshotStudyCorpus(imported)).toContain(
      "OCR has not been run yet",
    );
  });
});
