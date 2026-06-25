import { describe, expect, it } from "vitest";
import { detectMarkdown } from "../src/editor/markdown";

describe("markdown shortcuts", () => {
  it("maps heading/list/quote/code/divider prefixes", () => {
    expect(detectMarkdown("# ")?.type).toBe("h1");
    expect(detectMarkdown("## ")?.type).toBe("h2");
    expect(detectMarkdown("### ")?.type).toBe("h3");
    expect(detectMarkdown("- ")?.type).toBe("li");
    expect(detectMarkdown("* ")?.type).toBe("li");
    expect(detectMarkdown("1. ")?.type).toBe("numli");
    expect(detectMarkdown("> ")?.type).toBe("quote");
    expect(detectMarkdown("[] ")?.type).toBe("todo");
    expect(detectMarkdown("[ ] ")?.type).toBe("todo");
    expect(detectMarkdown("```")?.type).toBe("code");
    expect(detectMarkdown("--- ")?.type).toBe("divider");
  });

  it("ignores non-trigger text", () => {
    expect(detectMarkdown("hello")).toBeNull();
    expect(detectMarkdown("#hashtag")).toBeNull();
    expect(detectMarkdown("")).toBeNull();
  });
});
