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
import type { Dirent } from "fs";
import { join } from "path";

// Page ids are internal handles ("home", "b<seed><n>"). Validate strictly so a
// crafted id can never escape the vault directory.
const PAGE_ID_RE = /^[A-Za-z0-9_-]+$/;

export function isValidPageId(pageId: string): boolean {
  return PAGE_ID_RE.test(pageId);
}

/** A database folder and a row id are each a single id-safe path segment. */
function isValidSegment(seg: string): boolean {
  return PAGE_ID_RE.test(seg);
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

// ── S4: rows of a folder-backed database — <vaultDir>/<dbFolder>/<rowId>.md ──────

/** Write a database row's markdown. Both segments must be id-safe (no traversal). */
export async function exportRowMarkdownTo(
  vaultDir: string,
  dbFolder: string,
  rowId: string,
  markdown: string,
): Promise<boolean> {
  if (!isValidSegment(dbFolder) || !isValidSegment(rowId)) return false;
  try {
    const dir = join(vaultDir, dbFolder);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, pageFilename(rowId)), markdown, "utf-8");
    return true;
  } catch {
    return false;
  }
}

/** Delete a database row file. Returns false on a bad segment. */
export async function deleteRowIn(
  vaultDir: string,
  dbFolder: string,
  rowId: string,
): Promise<boolean> {
  if (!isValidSegment(dbFolder) || !isValidSegment(rowId)) return false;
  try {
    await fs.rm(join(vaultDir, dbFolder, pageFilename(rowId)));
    return true;
  } catch {
    return false;
  }
}

/** List the row ids in a database folder (filenames sans .md). */
export async function listRowIdsIn(
  vaultDir: string,
  dbFolder: string,
): Promise<string[]> {
  if (!isValidSegment(dbFolder)) return [];
  try {
    const names = await fs.readdir(join(vaultDir, dbFolder));
    return names
      .filter((n) => n.endsWith(".md"))
      .map((n) => n.replace(/\.md$/, ""));
  } catch {
    return [];
  }
}

// ── S6: the vault as the authoritative store (page files + a structure manifest) ─

const MANIFEST_FILE = "_manifest.json";

/** Read every root-level page file (sub-folders are database rows, not pages). */
export async function readVaultPages(
  vaultDir: string,
): Promise<Record<string, string>> {
  const pages: Record<string, string> = {};
  let entries: Dirent[];
  try {
    entries = (await fs.readdir(vaultDir, { withFileTypes: true })) as Dirent[];
  } catch {
    return pages;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const pageId = entry.name.replace(/\.md$/, "");
    if (!isValidPageId(pageId)) continue;
    try {
      pages[pageId] = await fs.readFile(join(vaultDir, entry.name), "utf-8");
    } catch {
      /* skip unreadable file */
    }
  }
  return pages;
}

/** Read the structure manifest JSON (or null if absent/unreadable). */
export async function readVaultManifest(
  vaultDir: string,
): Promise<string | null> {
  try {
    return await fs.readFile(join(vaultDir, MANIFEST_FILE), "utf-8");
  } catch {
    return null;
  }
}

/** Write the structure manifest JSON. */
export async function writeVaultManifest(
  vaultDir: string,
  json: string,
): Promise<boolean> {
  try {
    await fs.mkdir(vaultDir, { recursive: true });
    await fs.writeFile(join(vaultDir, MANIFEST_FILE), json, "utf-8");
    return true;
  } catch {
    return false;
  }
}

/** Copy a file to a timestamped sibling backup. Returns the backup path or null. */
export async function backupFile(
  path: string,
  stamp: number,
): Promise<string | null> {
  try {
    const backup = `${path}.bak-${stamp}`;
    await fs.copyFile(path, backup);
    return backup;
  } catch {
    return null;
  }
}
