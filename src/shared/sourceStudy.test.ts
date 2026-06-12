import { describe, expect, it } from "vitest";
import { buildSourceStudyPrompt } from "./sourceStudy";

describe("buildSourceStudyPrompt", () => {
  it("includes the focus and optional corpus description", () => {
    const out = buildSourceStudyPrompt("Adler-style syntopical reading", {
      corpusDescription: "NotebookLM notebook plus my Knowledge Wiki notes",
    });

    expect(out).toContain("Adler-style syntopical reading");
    expect(out).toContain("NotebookLM notebook plus my Knowledge Wiki notes");
  });

  it("defaults empty inputs to a connected source corpus", () => {
    const out = buildSourceStudyPrompt("   ");

    expect(out).toContain("the provided source corpus");
    expect(out).toContain("connected Knowledge Wiki");
    expect(out).toContain("NotebookLM notebook sources");
  });

  it("is generic across source formats", () => {
    const out = buildSourceStudyPrompt("learning goal");

    for (const term of [
      "books",
      "PDFs",
      "web articles",
      "YouTube transcripts",
      "magazines",
      "research papers",
      "notes",
      "wiki pages",
    ]) {
      expect(out).toContain(term);
    }
  });

  it("asks for the complete source-study workflow", () => {
    const out = buildSourceStudyPrompt("topic");

    expect(out).toContain("Central argument");
    expect(out).toContain("mental models");
    expect(out).toContain("Where do the sources agree");
    expect(out).toContain("evidence weakest");
    expect(out).toContain("Understanding check");
    expect(out).toContain("exactly three sentences");
    expect(out).toContain("Knowledge-wiki capture");
  });

  it("requires citations and evidence gaps without defaulting to chapters", () => {
    const out = buildSourceStudyPrompt("topic");

    expect(out).toContain("cite the source location or source name");
    expect(out).toContain("Key claims with citations");
    expect(out).toContain("evidence gap");
    expect(out).not.toMatch(/\bchapters\b/i);
  });
});
