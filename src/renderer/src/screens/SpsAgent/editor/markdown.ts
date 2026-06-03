// markdown.ts — inline markdown-shortcut detection. Ported from editor.jsx detectMarkdown.
import type { BlockType } from "../types";

const MAP: Record<string, BlockType> = {
  "# ": "h1",
  "## ": "h2",
  "### ": "h3",
  "- ": "li",
  "* ": "li",
  "1. ": "numli",
  "> ": "quote",
  "[] ": "todo",
  "[ ] ": "todo",
  "```": "code",
  "--- ": "divider",
};

export function detectMarkdown(text: string): { type: BlockType } | null {
  for (const k of Object.keys(MAP)) {
    if (text === k || text === k.trimEnd()) {
      if (k === "```" && text !== "```") continue;
      return { type: MAP[k] };
    }
  }
  if (text === "```") return { type: "code" };
  if (text === "> ") return { type: "quote" };
  return null;
}
