// sps-vault.ts — Part 2 / S2b: the additive markdown mirror of SPS pages on disk.
//
// SPS edits are written to one markdown file per page under
// `<profile>/sps-agent/vault/<pageId>.md`, so the markdown substrate (and the
// note-index that watches it) materializes from live editing. This is a MIRROR:
// the JSON blob (sps-agent/workspace.json) stays authoritative; nothing here is
// read back as the source of truth yet. Worst case is a stale extra file.
//
// Pure fs/path only (no Electron) so it is unit-testable; index.ts supplies the
// per-profile vault directory.
import { promises as fs } from "fs";
import { join } from "path";

// Page ids are internal handles ("home", "b<seed><n>"). Validate strictly so a
// crafted id can never escape the vault directory.
const PAGE_ID_RE = /^[A-Za-z0-9_-]+$/;

export function isValidPageId(pageId: string): boolean {
  return PAGE_ID_RE.test(pageId);
}

export function pageFilename(pageId: string): string {
  return `${pageId}.md`;
}

/** Write a page's markdown into a vault directory. Returns false on a bad id. */
export async function exportPageMarkdownTo(
  dir: string,
  pageId: string,
  markdown: string,
): Promise<boolean> {
  if (!isValidPageId(pageId)) return false;
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, pageFilename(pageId)), markdown, "utf-8");
    return true;
  } catch {
    return false;
  }
}

/** Read a page's mirrored markdown back, or null if absent / bad id. */
export async function readPageMarkdownFrom(
  dir: string,
  pageId: string,
): Promise<string | null> {
  if (!isValidPageId(pageId)) return null;
  try {
    return await fs.readFile(join(dir, pageFilename(pageId)), "utf-8");
  } catch {
    return null;
  }
}
