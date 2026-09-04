// Tiny indentation-aware YAML reader that resolves a dotted key path against
// a YAML document and returns the leaf scalar as a string, or null if the
// path is missing.
//
// Built deliberately small to avoid pulling js-yaml into the main bundle for
// a one-line lookup. Hermes config.yaml is plain key: value pairs nested by
// indentation — no anchors, no merge keys, no multi-line scalars in the
// fields we read. Edge cases we DO handle:
//
//  - 2-or-more-space indentation (Hermes always uses 2 today, but any
//    consistent positive indent works).
//  - Inline empty maps:  `providers: {}`  → returns "{}"
//    Inline empty lists: `disabled_toolsets: []` → returns "[]"
//  - Single/double-quoted scalars: `provider: 'honcho'` → "honcho"
//  - Trailing line comments: `model: gpt-4  # default` → "gpt-4"
//
// Edge cases we DON'T attempt — fall back to null:
//
//  - Block scalars (`|`, `>`)
//  - Flow-style mappings with content (`{a: 1, b: 2}`)
//  - YAML lists with `-` items
//
// If the codebase ever needs full YAML semantics, swap to js-yaml; the call
// sites only need `getYamlPath(content, key)` and that contract stays.
export function getYamlPath(content: string, dottedKey: string): string | null {
  const parts = dottedKey.split(".").filter(Boolean);
  if (parts.length === 0) return null;

  const lines = content.split(/\r?\n/);

  // Walk the path one segment at a time. `searchStart` is the first line to
  // scan for the current segment; `parentIndent` bounds the parent's block —
  // children live at indent strictly greater than it. The first segment uses
  // parentIndent = -1, so only column-0 keys match (a flat/single-segment key
  // is pinned to the top level and never resolves a nested occurrence).
  let searchStart = 0;
  let parentIndent = -1;

  for (let p = 0; p < parts.length; p++) {
    const isLeaf = p === parts.length - 1;
    // The shallowest non-blank line inside the block is the direct-child
    // depth. Lines deeper than that are grandchildren and are skipped, so a
    // segment only matches a *direct* child of its parent.
    let directChildIndent: number | null = null;
    let descendInto = -1;

    let i = searchStart;
    for (; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trimStart();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const indent = raw.length - trimmed.length;
      // A non-blank line at or shallower than the parent closes the block.
      if (indent <= parentIndent) break;

      if (directChildIndent === null) directChildIndent = indent;
      if (indent !== directChildIndent) continue; // grandchild — skip

      const colon = trimmed.indexOf(":");
      if (colon < 0) continue;
      const rawKey = trimmed.slice(0, colon).trim();
      if (!rawKey) continue;
      // Quoted keys aren't used in Hermes config but strip the wrapping just
      // in case so `"memory": ...` would still match.
      if (stripQuotes(rawKey) !== parts[p]) continue;

      if (isLeaf) return parseScalar(trimmed.slice(colon + 1));
      descendInto = i;
      break;
    }

    // Leaf not found among the direct children, or an intermediate segment
    // is missing → the path doesn't resolve.
    if (isLeaf || descendInto < 0) return null;
    searchStart = descendInto + 1;
    parentIndent = directChildIndent as number;
  }
  return null;
}

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return s.slice(1, -1);
    }
  }
  return s;
}

function parseScalar(remainderAfterColon: string): string | null {
  // Strip a trailing `# comment` segment only when not inside quotes. The
  // simplest approximation: if the value starts with a quote, find the
  // matching close-quote and ignore anything after it; otherwise split on
  // the first ` #` we encounter.
  let value = remainderAfterColon.trimStart();
  if (value === "") {
    // `key:` with no inline value means the value is a child map — not what
    // a getter on this key expects.
    return null;
  }
  if (value.startsWith('"') || value.startsWith("'")) {
    const quote = value[0];
    const end = value.indexOf(quote, 1);
    if (end > 0) value = value.slice(1, end);
    else value = value.slice(1); // unterminated — best effort
  } else {
    const commentIdx = value.search(/\s+#/);
    if (commentIdx >= 0) value = value.slice(0, commentIdx);
  }
  return value.trim();
}
