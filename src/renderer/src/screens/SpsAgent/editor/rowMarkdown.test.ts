// rowMarkdown.test.ts — S4: database row ↔ markdown file (frontmatter props).
import { describe, expect, it } from "vitest";
import { rowToMarkdown, rowFromMarkdown } from "./rowMarkdown";

describe("rowToMarkdown", () => {
  it("writes properties as JSON-scalar frontmatter", () => {
    const md = rowToMarkdown({ title: "Task A", status: "doing", prio: 1 });
    expect(md).toBe('---\ntitle: "Task A"\nstatus: "doing"\nprio: 1\n---\n');
  });

  it("omits empty/undefined properties", () => {
    const md = rowToMarkdown({ title: "x", status: "", note: undefined });
    expect(md).toBe('---\ntitle: "x"\n---\n');
  });

  it("includes a body when given", () => {
    const md = rowToMarkdown({ title: "x" }, "Some notes.");
    expect(md).toBe('---\ntitle: "x"\n---\n\nSome notes.');
  });

  it("returns only the body when there are no properties", () => {
    expect(rowToMarkdown({}, "just text")).toBe("just text");
  });
});

describe("rowFromMarkdown round-trip", () => {
  it("round-trips properties", () => {
    const props = { title: "Task A", status: "done", prio: 3, ok: true };
    expect(rowFromMarkdown(rowToMarkdown(props)).props).toEqual(props);
  });

  it("round-trips properties + body", () => {
    const out = rowFromMarkdown(rowToMarkdown({ title: "t" }, "body here"));
    expect(out.props).toEqual({ title: "t" });
    expect(out.body.trim()).toBe("body here");
  });

  it("parses a body-only file with no frontmatter", () => {
    expect(rowFromMarkdown("no fm")).toEqual({ props: {}, body: "no fm" });
  });
});
