import { describe, expect, it } from "vitest";
import { buildVisualCaptureBody, visualCaptureTitle } from "./visual-capture";

describe("visual capture helpers", () => {
  it("builds save-first image markdown with the preserved asset and optional note", () => {
    expect(
      buildVisualCaptureBody({
        assetPath: "abc123.png",
        originalName: "Chapter 4 question set.png",
        note: "Need worked answers for odd-numbered questions.",
      }),
    ).toBe(
      [
        "![Capture](../_assets/abc123.png)",
        "Imported from Chapter 4 question set.png.",
        "Note: Need worked answers for odd-numbered questions.",
      ].join("\n\n"),
    );
  });

  it("derives clear titles for different visual capture origins", () => {
    expect(
      visualCaptureTitle({
        captureOrigin: "camera",
        originalName: "camera.png",
        capturedAt: Date.UTC(2026, 5, 22, 8, 0, 0),
      }),
    ).toMatch(/^Camera capture - /);
    expect(
      visualCaptureTitle({
        captureOrigin: "file",
        originalName: "biology-page.png",
        capturedAt: Date.UTC(2026, 5, 22, 8, 0, 0),
      }),
    ).toBe("biology-page.png");
  });
});
