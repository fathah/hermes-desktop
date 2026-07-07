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
import { safeWriteFileAsync } from "./utils";

// Page ids are internal handles ("home", "b<seed><n>"). Validate strictly so a
// crafted id can never escape the vault directory.
const PAGE_ID_RE = /^[A-Za-z0-9_-]+$/;

export function isValidPageId(pageId: string): boolean {
  return PAGE_ID_RE.test(pageId);
}

/**
 * Optional callback invoked when a mirror WRITE fails for a real fs reason (not a
 * rejected id). Lets the electron-side caller record the divergence without this
 * module importing HERMES_HOME / Electron — keeping it pure and unit-testable.
 */
export type MirrorWriteErrorSink = (error: unknown) => void;

/** A database folder and a row id are each a single id-safe path segment. */
function isValidSegment(seg: string): boolean {
  return PAGE_ID_RE.test(seg);
}

/** `assets` is reserved for sidecar files — never a database folder. */
function isReservedFolder(seg: string): boolean {
  return seg === ASSETS_DIR;
}

export function pageFilename(pageId: string): string {
  return `${pageId}.md`;
}

/** Write a page's markdown into a vault directory. Returns false on a bad id. */
export async function exportPageMarkdownTo(
  dir: string,
  pageId: string,
  markdown: string,
  onError?: MirrorWriteErrorSink,
): Promise<boolean> {
  if (!isValidPageId(pageId)) return false;
  try {
    await safeWriteFileAsync(join(dir, pageFilename(pageId)), markdown);
    return true;
  } catch (err) {
    onError?.(err);
    return false;
  }
}

/** Delete a page's markdown file from a vault directory (F3 orphan cleanup).
 *  Id-validated and traversal-safe; best-effort (missing file ⇒ still false). */
export async function deletePageIn(
  dir: string,
  pageId: string,
): Promise<boolean> {
  if (!isValidPageId(pageId)) return false;
  try {
    await fs.rm(join(dir, pageFilename(pageId)));
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
  onError?: MirrorWriteErrorSink,
): Promise<boolean> {
  if (!isValidSegment(dbFolder) || !isValidSegment(rowId)) return false;
  if (isReservedFolder(dbFolder)) return false;
  try {
    await safeWriteFileAsync(
      join(vaultDir, dbFolder, pageFilename(rowId)),
      markdown,
    );
    return true;
  } catch (err) {
    onError?.(err);
    return false;
  }
}

/** Read a database row's markdown, or null if absent / bad segment. */
export async function readRowMarkdownFrom(
  vaultDir: string,
  dbFolder: string,
  rowId: string,
): Promise<string | null> {
  if (!isValidSegment(dbFolder) || !isValidSegment(rowId)) return null;
  if (isReservedFolder(dbFolder)) return null;
  try {
    return await fs.readFile(
      join(vaultDir, dbFolder, pageFilename(rowId)),
      "utf-8",
    );
  } catch {
    return null;
  }
}

/** Delete a database row file. Returns false on a bad segment. */
export async function deleteRowIn(
  vaultDir: string,
  dbFolder: string,
  rowId: string,
): Promise<boolean> {
  if (!isValidSegment(dbFolder) || !isValidSegment(rowId)) return false;
  if (isReservedFolder(dbFolder)) return false;
  try {
    await fs.rm(join(vaultDir, dbFolder, pageFilename(rowId)));
    return true;
  } catch {
    return false;
  }
}

/** Delete a whole database row folder (F3 — when its block is removed). The
 *  folder is a single id-safe segment, so this can't escape the vault; a bad
 *  segment or missing folder ⇒ false. Recursive: removes the folder + its rows. */
export async function deleteDbFolderIn(
  vaultDir: string,
  dbFolder: string,
): Promise<boolean> {
  if (!isValidSegment(dbFolder)) return false;
  try {
    await fs.rm(join(vaultDir, dbFolder), { recursive: true });
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
  if (isReservedFolder(dbFolder)) return [];
  try {
    const names = await fs.readdir(join(vaultDir, dbFolder));
    return names
      .filter((n) => n.endsWith(".md"))
      .map((n) => n.replace(/\.md$/, ""));
  } catch {
    return [];
  }
}

// ── Sidecar assets — <vaultDir>/assets/<pageId>/<file> ──────────────────────────
//
// Diagram scenes (Excalidraw) and their rendered previews live BESIDE the notes,
// never inline in the markdown, so the .md files stay clean and Obsidian-
// renderable. `assets` is a reserved vault folder: it is never a page (page
// reads only see root .md files) and never a database folder (guarded below).
export const ASSETS_DIR = "assets";

// An asset filename: one id-safe stem plus a dotted extension, no traversal.
const ASSET_FILE_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9.]+$/;

function isValidAssetFile(name: string): boolean {
  return ASSET_FILE_RE.test(name) && !name.includes("..");
}

/** Write a per-page sidecar asset. Both id segments must be safe (no traversal). */
export async function writeAssetTo(
  vaultDir: string,
  pageId: string,
  filename: string,
  data: string,
  onError?: MirrorWriteErrorSink,
): Promise<boolean> {
  if (!isValidPageId(pageId) || !isValidAssetFile(filename)) return false;
  try {
    await safeWriteFileAsync(
      join(vaultDir, ASSETS_DIR, pageId, filename),
      data,
    );
    return true;
  } catch (err) {
    onError?.(err);
    return false;
  }
}

/** Read a per-page sidecar asset back, or null if absent / bad id. */
export async function readAssetFrom(
  vaultDir: string,
  pageId: string,
  filename: string,
): Promise<string | null> {
  if (!isValidPageId(pageId) || !isValidAssetFile(filename)) return null;
  try {
    return await fs.readFile(
      join(vaultDir, ASSETS_DIR, pageId, filename),
      "utf-8",
    );
  } catch {
    return null;
  }
}

// ── S6: the vault as the authoritative store (page files + a structure manifest) ─

const MANIFEST_FILE = "_manifest.json";
export const SNAPSHOT_JOURNAL_FILE = "_manifest.pending.json";

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
  onError?: MirrorWriteErrorSink,
): Promise<boolean> {
  try {
    await safeWriteFileAsync(join(vaultDir, MANIFEST_FILE), json);
    return true;
  } catch (err) {
    onError?.(err);
    return false;
  }
}

export interface VaultSnapshotWrite {
  pages: Record<string, string>;
  manifest: string;
}

/** Write page files plus the manifest behind a small pending journal. */
export async function writeVaultSnapshot(
  vaultDir: string,
  snapshot: VaultSnapshotWrite,
  onError?: MirrorWriteErrorSink,
): Promise<boolean> {
  const pageIds = Object.keys(snapshot.pages);
  if (pageIds.some((pageId) => !isValidPageId(pageId))) return false;

  const journalPath = join(vaultDir, SNAPSHOT_JOURNAL_FILE);
  try {
    await safeWriteFileAsync(
      journalPath,
      JSON.stringify({ startedAt: Date.now(), pageIds }, null, 2),
    );
  } catch (err) {
    onError?.(err);
    return false;
  }

  for (const [pageId, markdown] of Object.entries(snapshot.pages)) {
    const ok = await exportPageMarkdownTo(vaultDir, pageId, markdown, onError);
    if (!ok) return false;
  }

  if (!(await writeVaultManifest(vaultDir, snapshot.manifest, onError))) {
    return false;
  }

  try {
    await fs.rm(journalPath, { force: true });
    return true;
  } catch (err) {
    onError?.(err);
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
