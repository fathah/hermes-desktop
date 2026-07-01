import { readFile } from "fs/promises";
import { join } from "path";
import { exportPageMarkdownTo, isValidPageId } from "./sps-vault";
import type { SpsPropertyValue } from "../shared/sps-types";
import {
  parseYamlFrontmatterMarkdown,
  stringifySortedYamlFrontmatter,
} from "../shared/sps-frontmatter";

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
  const { props, body } = parseYamlFrontmatterMarkdown(markdown);
  for (const [key, value] of Object.entries(patch)) {
    if (!isEditablePropertyKey(key)) continue;
    if (value === undefined) delete props[key];
    else props[key] = value;
  }
  return stringifySortedYamlFrontmatter(props, body);
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

function isEditablePropertyKey(key: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(key) && !RESERVED_KEYS.has(key);
}
