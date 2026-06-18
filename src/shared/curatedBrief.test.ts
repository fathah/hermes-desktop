import { describe, expect, it } from "vitest";
import {
  buildCuratedBriefPrompt,
  hasCuratedBriefSources,
} from "./curatedBrief";

describe("buildCuratedBriefPrompt", () => {
  it("includes the topic and optional corpus description", () => {
    const out = buildCuratedBriefPrompt("Local-first knowledge work", {
      corpusDescription:
        "Use https://example.com/source and the connected Knowledge Wiki notes.",
    });

    expect(out).toContain("Local-first knowledge work");
    expect(out).toContain("https://example.com/source");
    expect(out).toContain("connected Knowledge Wiki notes");
  });

  it("requires the complete curated brief structure", () => {
    const out = buildCuratedBriefPrompt("topic");

    for (const heading of [
      "## Perspectives",
      "## Questions",
      "## Evidence Ledger",
      "## Outline",
      "## Brief",
      "## Concept Links",
      "## Open Questions",
      "## Sources",
    ]) {
      expect(out).toContain(heading);
    }
  });

  it("requires source-backed claims, source URLs, and evidence gaps", () => {
    const out = buildCuratedBriefPrompt("topic");

    expect(out).toContain("Do not invent sources");
    expect(out).toContain("source URL");
    expect(out).toContain("evidence gap");
    expect(out).toContain("[[wikilinks]]");
  });
});

describe("hasCuratedBriefSources", () => {
  it("accepts curated briefs with a Sources section and at least one URL", () => {
    expect(
      hasCuratedBriefSources(
        "# Topic\n\n## Brief\nBody\n\n## Sources\n- [A](https://a.example)",
      ),
    ).toBe(true);
  });

  it("rejects briefs without a Sources heading", () => {
    expect(hasCuratedBriefSources("Body with https://a.example")).toBe(false);
  });

  it("rejects briefs with a Sources heading but no URL", () => {
    expect(hasCuratedBriefSources("## Sources\n- Internal memory only")).toBe(
      false,
    );
  });
});
