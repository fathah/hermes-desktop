// rowMarkdown.ts — Part 2 / S4: a database row ↔ a markdown file.
//
// A folder-backed database stores each row as a markdown file whose YAML
// frontmatter holds its properties (title, status, prio, …). Frontmatter is
// written as JSON-style scalars (valid YAML), so the note-index reads the same
// files. The body is an optional free-text note for the row.
import {
  frontmatterJsonLine,
  parseJsonScalarFrontmatter,
  splitSpsFrontmatter,
  wrapFrontmatterLines,
} from "../../../../../shared/sps-frontmatter";

export type RowProps = Record<string, unknown>;

/** Serialize a row's properties (+ optional body) to a markdown file string. */
export function rowToMarkdown(props: RowProps, body = ""): string {
  const lines = Object.keys(props)
    .filter((k) => props[k] !== undefined && props[k] !== "")
    .map((k) => frontmatterJsonLine(k, props[k]));
  return wrapFrontmatterLines(lines, body, body ? "\n\n" : "\n");
}

/** Parse a row markdown file back into its properties + body. */
export function rowFromMarkdown(md: string): { props: RowProps; body: string } {
  const { frontmatter, body } = splitSpsFrontmatter(md);
  if (frontmatter === null) return { props: {}, body: md };
  return { props: parseJsonScalarFrontmatter(frontmatter), body };
}
