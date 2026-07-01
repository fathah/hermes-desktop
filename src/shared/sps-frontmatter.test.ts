import { describe, expect, it } from "vitest";
import {
  frontmatterJsonLine,
  parseJsonScalarFrontmatter,
  parseYamlFrontmatterMarkdown,
  splitSpsFrontmatter,
  stringifySortedYamlFrontmatter,
  wrapFrontmatterLines,
} from "./sps-frontmatter";

describe("sps-frontmatter", () => {
  it("splits markdown frontmatter from body", () => {
    expect(splitSpsFrontmatter("---\ntitle: X\n---\nBody")).toEqual({
      frontmatter: "title: X",
      body: "Body",
    });
    expect(splitSpsFrontmatter("Body")).toEqual({
      frontmatter: null,
      body: "Body",
    });
  });

  it("parses JSON-style scalar frontmatter", () => {
    expect(
      parseJsonScalarFrontmatter('title: "Task"\nprio: 1\ntags: ["a"]'),
    ).toEqual({ title: "Task", prio: 1, tags: ["a"] });
  });

  it("wraps explicit frontmatter lines without reordering them", () => {
    expect(
      wrapFrontmatterLines(
        [
          frontmatterJsonLine("title", "Home"),
          frontmatterJsonLine("icon", "H"),
        ],
        "# Home",
        "\n\n",
      ),
    ).toBe('---\ntitle: "Home"\nicon: "H"\n---\n\n# Home');
  });

  it("parses YAML frontmatter and stringifies sorted YAML frontmatter", () => {
    expect(parseYamlFrontmatterMarkdown("---\nb: 2\na: 1\n---\nBody")).toEqual({
      props: { b: 2, a: 1 },
      body: "Body",
    });
    expect(stringifySortedYamlFrontmatter({ b: 2, a: 1 }, "Body")).toBe(
      "---\na: 1\nb: 2\n---\nBody",
    );
  });
});
