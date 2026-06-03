/**
 * Recognize file-editing tool calls and extract the before/after text so the
 * chat tool feed can render an inline diff (idea A1). Pure + dependency-free so
 * it unit-tests without React.
 *
 * Field aliases cover the common gateway tool shapes:
 *   write_file / create_file → { path|file, content|text }   (new content; old = "")
 *   edit_file / str_replace  → { path|file, old_text|old_string, new_text|new_string }
 */

export interface FileEdit {
  fileName?: string;
  oldText: string;
  newText: string;
}

const WRITE_TOOLS = new Set(["write_file", "create_file"]);
const EDIT_TOOLS = new Set(["edit_file", "str_replace", "str_replace_editor"]);

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Parse a tool call's args; return a FileEdit if it's a recognized file edit. */
export function parseFileEditToolCall(
  name: string,
  args: string,
): FileEdit | null {
  const tool = name.trim().toLowerCase();
  if (!WRITE_TOOLS.has(tool) && !EDIT_TOOLS.has(tool)) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(args);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;

  const fileName = asString(o.path) ?? asString(o.file) ?? undefined;

  if (WRITE_TOOLS.has(tool)) {
    const content = asString(o.content) ?? asString(o.text);
    if (content === null) return null;
    return { fileName, oldText: "", newText: content };
  }

  // edit tools
  const oldText = asString(o.old_text) ?? asString(o.old_string);
  const newText = asString(o.new_text) ?? asString(o.new_string);
  if (oldText === null || newText === null) return null;
  return { fileName, oldText, newText };
}
