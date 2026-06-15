import { describe, expect, it } from "vitest";
import { buildContextPackMarkdown } from "./context-packs";

describe("buildContextPackMarkdown", () => {
  it("renders provenance, included paths, backlinks, tasks, and unresolved questions", () => {
    const pack = buildContextPackMarkdown(
      {
        pageId: "Project-Atlas",
        title: "Project Atlas",
        root: {
          path: "Project-Atlas.md",
          title: "Project Atlas",
          body: "# Project Atlas\n\nMain note",
        },
        backlinks: [
          { path: "Decision-Log.md", title: "Decision Log", body: "links in" },
        ],
        outgoing: [{ path: "Source-A.md", title: "Source A", body: "source" }],
        tasks: [{ path: "tasks/t1.md", title: "Follow up", body: "- [ ] Call" }],
        unresolvedQuestions: ["Which owner signs off?"],
      },
      { maxBytes: 10_000 },
    );

    expect(pack.markdown).toContain("# Context Pack: Project Atlas");
    expect(pack.markdown).toContain("## Included paths");
    expect(pack.markdown).toContain("- Project-Atlas.md");
    expect(pack.markdown).toContain("## Backlinks");
    expect(pack.markdown).toContain("## Related tasks");
    expect(pack.markdown).toContain("Which owner signs off?");
    expect(pack.truncated).toBe(false);
  });

  it("truncates deterministically at the byte budget", () => {
    const pack = buildContextPackMarkdown(
      {
        pageId: "Long",
        title: "Long",
        root: { path: "Long.md", title: "Long", body: "x".repeat(5000) },
        backlinks: [],
        outgoing: [],
        tasks: [],
        unresolvedQuestions: [],
      },
      { maxBytes: 600 },
    );

    expect(Buffer.byteLength(pack.markdown, "utf-8")).toBeLessThanOrEqual(600);
    expect(pack.truncated).toBe(true);
    expect(pack.markdown).toContain("[truncated]");
  });
});
