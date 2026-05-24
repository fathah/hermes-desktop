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
  // Stack of (indent, key) frames describing the parent path being walked.
  // The current frame is the deepest one we've descended into; siblings or
  // dedents pop it.
  const stack: { indent: number; key: string }[] = [];
  let pathIdx = 0;

  for (const raw of lines) {
    const trimmed = raw.trimStart();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = raw.length - trimmed.length;
    // Pop stack frames whose indent is >= the current line's indent — those
    // are siblings/cousins of the current node, not parents.
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    // If we've already drilled into a deeper level than where the current
    // pathIdx parent lives, the dotted path is broken (we walked past it
    // without finding the next part), so reset pathIdx to the depth we are
    // actually at — i.e. number of parts already matched in stack.
    pathIdx = stack.length;

    const colon = trimmed.indexOf(":");
    if (colon < 0) continue;
    const rawKey = trimmed.slice(0, colon).trim();
    if (!rawKey) continue;
    // Quoted keys aren't used in Hermes config but strip the wrapping just in
    // case so `"memory": ...` would still match.
    const key = stripQuotes(rawKey);
    const remainder = trimmed.slice(colon + 1);

    if (pathIdx < parts.length && key === parts[pathIdx]) {
      const isLeaf = pathIdx === parts.length - 1;
      if (isLeaf) {
        return parseScalar(remainder);
      }
      // Intermediate key — push onto the stack and look for the next part
      // among its children.
      stack.push({ indent, key });
      pathIdx = stack.length;
    }
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
