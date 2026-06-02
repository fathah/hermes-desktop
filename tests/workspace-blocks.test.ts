import { describe, expect, it } from "vitest";
import {
  deleteBlockById,
  duplicateBlockById,
  ensureMarkdownBlockIds,
  extractWorkspacePageLinks,
  turnBlockInto,
} from "../src/renderer/src/screens/Workspace/blockExtensions";

describe("workspace block utilities", () => {
  it("adds stable ids to markdown blocks and preserves existing ids", () => {
    const first = ensureMarkdownBlockIds("# Title\n\nBody");
    const second = ensureMarkdownBlockIds(first);

    expect(first).toMatch(/<!-- hermes-block:block-/);
    expect(second).toBe(first);
  });

  it("duplicates and deletes a block by id", () => {
    const content = [
      "<!-- hermes-block:block-a -->",
      "First block",
      "",
      "<!-- hermes-block:block-b -->",
      "Second block",
    ].join("\n");

    expect(duplicateBlockById(content, "block-a")).toContain(
      "First block\n\n<!-- hermes-block:block-a-copy",
    );
    expect(deleteBlockById(content, "block-a")).not.toContain("First block");
    expect(deleteBlockById(content, "block-a")).toContain("Second block");
  });

  it("turns blocks into common workspace block types", () => {
    const content = "<!-- hermes-block:block-a -->\nShip feature";

    expect(turnBlockInto(content, "block-a", "todo")).toContain(
      "- [ ] Ship feature",
    );
    expect(turnBlockInto(content, "block-a", "callout")).toContain(
      "> Ship feature",
    );
    expect(turnBlockInto(content, "block-a", "code")).toContain(
      "```\nShip feature\n```",
    );
  });

  it("extracts page links from wiki style references", () => {
    expect(
      extractWorkspacePageLinks("See [[Product Roadmap]] and [[Spec]]."),
    ).toEqual(["Product Roadmap", "Spec"]);
  });
});
