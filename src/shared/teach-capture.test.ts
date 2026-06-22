import { describe, expect, it } from "vitest";
import { buildTeachCapturePrompt } from "./teach-capture";

describe("buildTeachCapturePrompt", () => {
  it("asks the model to solve question sets pedagogically without inventing unreadable content", () => {
    const prompt = buildTeachCapturePrompt({
      captureId: "cap-textbook",
      title: "Chapter 3 questions",
      corpusDescription:
        "OCR text:\n1. Find x if 2x + 3 = 11.\n2. Explain photosynthesis.",
    });

    expect(prompt).toContain("Chapter 3 questions");
    expect(prompt).toContain("Segment the captured material into questions");
    expect(prompt).toContain("worked answer");
    expect(prompt).toContain("pedagogy");
    expect(prompt).toContain("If OCR is missing, low confidence, or ambiguous");
    expect(prompt).toContain("Do not invent unreadable questions");
  });
});
