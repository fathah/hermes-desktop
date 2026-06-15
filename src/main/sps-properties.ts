import { readFile } from "fs/promises";
import YAML from "yaml";
import { join } from "path";
import { exportPageMarkdownTo, isValidPageId } from "./sps-vault";
import type { SpsPropertyValue } from "../shared/sps-types";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const RESERVED_KEYS = new Set([
  "title",
  "icon",
  "cover",
  "source",
  "ingestedAt",
  "journal",
  "date",
  "time",
  "mood",
  "tags",
]);

export type SpsPropertyPatch = Record<string, SpsPropertyValue | undefined>;

export function patchPagePropertiesMarkdown(
  markdown: string,
  patch: SpsPropertyPatch,
): string {
  const { props, body } = splitFrontmatter(markdown);
  for (const [key, value] of Object.entries(patch)) {
    if (!isEditablePropertyKey(key)) continue;
    if (value === undefined) delete props[key];
    else props[key] = value;
  }
  return stringifyFrontmatter(props, body);
}

export async function updatePageProperties(
  vaultDir: string,
  pageId: string,
  patch: SpsPropertyPatch,
): Promise<boolean> {
  if (!isValidPageId(pageId)) return false;
  let markdown: string;
  try {
    markdown = await readFile(join(vaultDir, `${pageId}.md`), "utf-8");
  } catch {
    return false;
  }
  return exportPageMarkdownTo(
    vaultDir,
    pageId,
    patchPagePropertiesMarkdown(markdown, patch),
  );
}

function splitFrontmatter(markdown: string): {
  props: Record<string, unknown>;
  body: string;
} {
  const match = FRONTMATTER_RE.exec(markdown);
  if (!match) return { props: {}, body: markdown };
  try {
    const parsed = YAML.parse(match[1]);
    const props =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    return { props, body: markdown.slice(match[0].length) };
  } catch {
    return { props: {}, body: markdown.slice(match[0].length) };
  }
}

function stringifyFrontmatter(
  props: Record<string, unknown>,
  body: string,
): string {
  const keys = Object.keys(props).filter((key) => props[key] !== undefined);
  if (keys.length === 0) return body;
  const sorted: Record<string, unknown> = {};
  for (const key of keys.sort()) sorted[key] = props[key];
  return `---\n${YAML.stringify(sorted).trim()}\n---\n${body.startsWith("\n") ? body : `\n${body}`}`;
}

function isEditablePropertyKey(key: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(key) && !RESERVED_KEYS.has(key);
}
