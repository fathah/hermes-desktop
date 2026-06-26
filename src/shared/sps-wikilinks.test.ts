import { describe, expect, it } from "vitest";
import {
  extractSpsLinkEdges,
  maskSpsWikilinks,
  parseSpsWikilinks,
} from "./sps-wikilinks";

describe("parseSpsWikilinks", () => {
  it("parses Obsidian link variants", () => {
    expect(
      parseSpsWikilinks(
        "See [[Project Atlas|Atlas]], [[Roadmap#North Star]], [[Tasks#^todo-1]], and ![[Brief]].",
      ).map((link) => ({
        target: link.target,
        display: link.display,
        heading: link.heading,
        blockId: link.blockId,
        kind: link.kind,
      })),
    ).toEqual([
      {
        target: "Project Atlas",
        display: "Atlas",
        heading: undefined,
        blockId: undefined,
        kind: "link",
      },
      {
        target: "Roadmap",
        display: undefined,
        heading: "North Star",
        blockId: undefined,
        kind: "link",
      },
      {
        target: "Tasks",
        display: undefined,
        heading: undefined,
        blockId: "todo-1",
        kind: "link",
      },
      {
        target: "Brief",
        display: undefined,
        heading: undefined,
        blockId: undefined,
        kind: "embed",
      },
    ]);
  });

  it("keeps legacy typed wikilinks readable", () => {
    expect(parseSpsWikilinks("[[works_at::Garry Tan]]")[0]).toMatchObject({
      target: "Garry Tan",
      relation: "works_at",
      kind: "link",
    });
  });
});

describe("extractSpsLinkEdges", () => {
  it("extracts canonical inline attributes and frontmatter relation links", () => {
    const edges = extractSpsLinkEdges(
      "advisor:: [[Garry Tan]]\nSee [[Roadmap]] and ![[Brief#Summary]].",
      { investor: ["[[Sequoia|Sequoia Capital]]"] },
    );

    expect(
      edges.map((edge) => ({
        target: edge.target,
        type: edge.type,
        kind: edge.kind,
        heading: edge.heading,
      })),
    ).toEqual([
      {
        target: "Garry Tan",
        type: "advisor",
        kind: "link",
        heading: undefined,
      },
      {
        target: "Roadmap",
        type: "link",
        kind: "link",
        heading: undefined,
      },
      {
        target: "Brief",
        type: "embed",
        kind: "embed",
        heading: "Summary",
      },
      {
        target: "Sequoia",
        type: "investor",
        kind: "link",
        heading: undefined,
      },
    ]);
  });

  it("uses the legacy wikilink relation type without duplicating a generic link", () => {
    expect(extractSpsLinkEdges("[[works_at::Garry Tan]]")).toEqual([
      expect.objectContaining({
        target: "Garry Tan",
        type: "works_at",
        kind: "link",
      }),
    ]);
  });

  it("masks links and embeds for unlinked mention search", () => {
    const masked = maskSpsWikilinks(
      "Atlas ![[Brief]] [[Roadmap|roadmap]] Atlas",
    );
    expect(masked).toHaveLength(
      "Atlas ![[Brief]] [[Roadmap|roadmap]] Atlas".length,
    );
    expect(masked).not.toContain("Brief");
    expect(masked).not.toContain("Roadmap");
    expect(masked).toMatch(/^Atlas\s+Atlas$/);
  });
});
