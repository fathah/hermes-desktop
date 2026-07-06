import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "./index";

// MED-5 regression: ingestCommitPage parses full frontmatter meta out of the
// proposal markdown (via pageFromMarkdown) but historically kept only `blocks`,
// silently discarding tags/source/ingestedAt/custom-properties on OKF import.

const withFrontmatter = [
  "---",
  'title: "Imported Concept"',
  'source: "https://example.com/resource"',
  "ingestedAt: 1700000000000",
  'tags: ["ml","import"]',
  'owner: "Maya"',
  "---",
  "",
  "Body paragraph.",
].join("\n");

describe("ingestCommitPage preserves frontmatter meta", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("carries tags, source, ingestedAt, and custom properties on create", () => {
    const id = useStore.getState().ingestCommitPage({
      op: "create",
      pageId: "imported-concept",
      title: "Imported Concept",
      markdown: withFrontmatter,
    });

    const meta = useStore.getState().meta[id];
    expect(meta.title).toBe("Imported Concept");
    expect(meta.source).toBe("https://example.com/resource");
    expect(meta.ingestedAt).toBe(1700000000000);
    expect(meta.tags).toEqual(["ml", "import"]);
    expect(meta.properties).toEqual({ owner: "Maya" });
  });

  it("carries frontmatter meta when updating an existing page", () => {
    const store = useStore.getState();
    store.ingestCommitPage({
      op: "create",
      pageId: "imported-concept",
      title: "Imported Concept",
      markdown: "Body only.",
    });

    store.ingestCommitPage({
      op: "update",
      pageId: "imported-concept",
      title: "Imported Concept",
      markdown: withFrontmatter,
    });

    const meta = useStore.getState().meta["imported-concept"];
    expect(meta.tags).toEqual(["ml", "import"]);
    expect(meta.source).toBe("https://example.com/resource");
    expect(meta.properties).toEqual({ owner: "Maya" });
  });

  it("leaves a body-only proposal with default meta (no clobber)", () => {
    const id = useStore.getState().ingestCommitPage({
      op: "create",
      pageId: "plain-note",
      title: "Plain Note",
      markdown: "Just a body, no frontmatter.",
    });

    const meta = useStore.getState().meta[id];
    expect(meta.title).toBe("Plain Note");
    expect(meta.tags).toBeUndefined();
    expect(meta.properties).toBeUndefined();
  });
});
