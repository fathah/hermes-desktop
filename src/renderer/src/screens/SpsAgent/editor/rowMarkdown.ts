// rowMarkdown.ts — Part 2 / S4: a database row ↔ a markdown file.
//
// A folder-backed database stores each row as a markdown file whose YAML
// frontmatter holds its properties (title, status, prio, …). Frontmatter is
// written as JSON-style scalars (valid YAML), so the note-index reads the same
// files. The body is an optional free-text note for the row.
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

export type RowProps = Record<string, unknown>;

/** Serialize a row's properties (+ optional body) to a markdown file string. */
export function rowToMarkdown(props: RowProps, body = ""): string {
  const lines = Object.keys(props)
    .filter((k) => props[k] !== undefined && props[k] !== "")
    .map((k) => `${k}: ${JSON.stringify(props[k])}`);
  if (lines.length === 0) return body;
  return `---\n${lines.join("\n")}\n---\n${body ? `\n${body}` : ""}`;
}

/** Parse a row markdown file back into its properties + body. */
export function rowFromMarkdown(md: string): { props: RowProps; body: string } {
  const match = FRONTMATTER_RE.exec(md);
  if (!match) return { props: {}, body: md };
  const body = md.slice(match[0].length);
  const props: RowProps = {};
  for (const line of match[1].split("\n")) {
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim();
    const rawValue = line.slice(sep + 1).trim();
    try {
      props[key] = JSON.parse(rawValue);
    } catch {
      props[key] = rawValue;
    }
  }
  return { props, body };
}
