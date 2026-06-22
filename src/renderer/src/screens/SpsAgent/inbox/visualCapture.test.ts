import { describe, expect, it } from "vitest";
import {
  appendVisualCaptureOcr,
  buildTeachCaptureCorpus,
  isVisualCaptureProps,
} from "./visualCapture";

describe("appendVisualCaptureOcr", () => {
  it("adds OCR text and marks frontmatter complete without duplicating OCR sections", () => {
    const markdown =
      '---\ntitle: "Textbook"\nsource: "image"\nassetPath: "page.png"\nocrStatus: "not-run"\n---\n\n![Capture](../_assets/page.png)\n';

    const next = appendVisualCaptureOcr(markdown, " Question 1 text. ");
    const replaced = appendVisualCaptureOcr(next, "Better OCR text.");

    expect(next).toContain('ocrStatus: "complete"');
    expect(next).toContain("## OCR Text\n\nQuestion 1 text.");
    expect(replaced).toContain("## OCR Text\n\nBetter OCR text.");
    expect(replaced).not.toContain("Question 1 text.");
  });

  it("marks OCR failed without removing the preserved image", () => {
    const markdown =
      '---\ntitle: "Textbook"\nsource: "image"\nassetPath: "page.png"\n---\n\n![Capture](../_assets/page.png)\n';

    const next = appendVisualCaptureOcr(markdown, "   ", "failed");

    expect(next).toContain('ocrStatus: "failed"');
    expect(next).toContain("![Capture](../_assets/page.png)");
    expect(next).not.toContain("## OCR Text");
  });
});

describe("visual capture predicates and teaching corpus", () => {
  it("recognizes image and screenshot captures with asset paths", () => {
    expect(
      isVisualCaptureProps({ source: "image", assetPath: "page.png" }),
    ).toBe(true);
    expect(
      isVisualCaptureProps({ source: "quick-note", assetPath: "page.png" }),
    ).toBe(false);
  });

  it("builds an honest corpus when OCR has not been run", () => {
    const corpus = buildTeachCaptureCorpus({
      captureId: "cap-image",
      title: "Textbook page",
      markdown:
        '---\ntitle: "Textbook page"\nsource: "image"\nassetPath: "page.png"\nocrStatus: "not-run"\n---\n\n![Capture](../_assets/page.png)\n',
    });

    expect(corpus).toContain("Inbox capture: cap-image");
    expect(corpus).toContain("OCR has not been run yet");
    expect(corpus).toContain("Stored asset: page.png");
  });
});
