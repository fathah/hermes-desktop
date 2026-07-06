// sps-backups.ts — whole-workspace snapshot & restore (MED-11).
//
// A snapshot copies the three AUTHORITATIVE artifacts — workspace.json,
// _manifest.json, and vault/**/*.md — into
// <profileHome>/sps-agent/backups/<epochMs>/. The derived .note-index.db is
// NEVER included (WAL-mode, locked, and fully rebuildable from the markdown);
// after a restore the caller triggers an index rebuild instead.
//
// Restore doctrine (mirrors self-healing.ts): before overwriting anything, a
// fresh safety snapshot of the CURRENT state is taken — if that snapshot cannot
// be written the restore is refused, because a still-broken state beats an
// unrecoverable one.
//
// The vault may be repointed at an external Obsidian folder, so only markdown
// files are touched: dot-directories (.obsidian, .trash) and binary assets are
// neither snapshotted nor deleted on restore.
import { promises as fs } from "fs";
import { dirname, join, relative } from "path";
import { profileHome, getActiveProfileNameSync } from "./utils";
import { resolveSpsVaultDir } from "./sps-storage";
import type {
  WorkspaceBackupInfo,
  WorkspaceRestoreResult,
} from "../shared/sps-types";

export const WORKSPACE_BACKUP_KEEP = 10;

export type {
  WorkspaceBackupInfo,
  WorkspaceRestoreResult,
} from "../shared/sps-types";

interface WorkspacePaths {
  workspaceJson: string;
  manifestJson: string;
  vaultDir: string;
  /** Never walk into these (guards against a vault that contains backups/). */
  excludeDirs?: string[];
}

function sanitizeProfile(profile?: string): string {
  return profile || getActiveProfileNameSync();
}

export function workspaceBackupsDir(profile?: string): string {
  return join(profileHome(sanitizeProfile(profile)), "sps-agent", "backups");
}

function workspacePaths(profile?: string): WorkspacePaths {
  const base = join(profileHome(sanitizeProfile(profile)), "sps-agent");
  // The manifest lives INSIDE the (possibly repointed) vault directory —
  // always resolve via resolveSpsVaultDir, never assume the default layout.
  const vaultDir = resolveSpsVaultDir(profile);
  return {
    workspaceJson: join(base, "workspace.json"),
    manifestJson: join(vaultDir, "_manifest.json"),
    vaultDir,
    excludeDirs: [workspaceBackupsDir(profile)],
  };
}

/** Pure: which snapshot ids to delete so only the newest `keep` survive. */
export function selectSnapshotIdsToPrune(
  ids: string[],
  keep: number,
): string[] {
  const stamped = ids
    .map((id) => ({ id, stamp: Number(id) }))
    .filter((entry) => Number.isFinite(entry.stamp))
    .sort((a, b) => b.stamp - a.stamp);
  return stamped.slice(Math.max(0, keep)).map((entry) => entry.id);
}

/** Recursively collect vault-relative markdown paths, skipping dot-entries. */
async function collectMarkdownFiles(
  root: string,
  excludeDirs: string[] = [],
  dir = root,
): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (excludeDirs.includes(full)) continue;
      found.push(...(await collectMarkdownFiles(root, excludeDirs, full)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      found.push(relative(root, full));
    }
  }
  return found;
}

async function copyInto(src: string, dest: string): Promise<number> {
  await fs.mkdir(dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
  const stat = await fs.stat(dest);
  return stat.size;
}

/**
 * Core snapshot (path-parameterized so it is vitest-testable without Electron):
 * copy the authoritative artifacts into `destDir`. Throws when nothing exists
 * to snapshot or a copy fails — callers treat a throw as "no backup, abort".
 */
export async function snapshotWorkspaceTo(
  paths: WorkspacePaths,
  destDir: string,
): Promise<{ bytes: number; fileCount: number }> {
  const vaultFiles = await collectMarkdownFiles(
    paths.vaultDir,
    paths.excludeDirs ?? [],
  );
  const haveWorkspace = await exists(paths.workspaceJson);
  const haveManifest = await exists(paths.manifestJson);
  if (!haveWorkspace && !haveManifest && vaultFiles.length === 0) {
    throw new Error("Nothing to back up — no workspace artifacts found.");
  }

  await fs.mkdir(destDir, { recursive: true });
  let bytes = 0;
  let fileCount = 0;
  if (haveWorkspace) {
    bytes += await copyInto(
      paths.workspaceJson,
      join(destDir, "workspace.json"),
    );
    fileCount += 1;
  }
  if (haveManifest) {
    bytes += await copyInto(
      paths.manifestJson,
      join(destDir, "_manifest.json"),
    );
    fileCount += 1;
  }
  for (const rel of vaultFiles) {
    bytes += await copyInto(
      join(paths.vaultDir, rel),
      join(destDir, "vault", rel),
    );
    fileCount += 1;
  }
  return { bytes, fileCount };
}

/**
 * Core restore: replace the authoritative artifacts with the snapshot's.
 * Markdown files present now but absent from the snapshot are deleted so the
 * vault returns to exactly snapshot time; non-markdown files are untouched.
 */
export async function restoreSnapshotFrom(
  snapDir: string,
  paths: WorkspacePaths,
): Promise<void> {
  const snapVaultDir = join(snapDir, "vault");
  const snapWorkspace = join(snapDir, "workspace.json");
  const snapManifest = join(snapDir, "_manifest.json");
  const snapFiles = await collectMarkdownFiles(snapVaultDir);
  const haveWorkspace = await exists(snapWorkspace);
  const haveManifest = await exists(snapManifest);
  if (!haveWorkspace && !haveManifest && snapFiles.length === 0) {
    throw new Error("Snapshot is empty or unreadable.");
  }

  if (haveWorkspace) {
    await copyInto(snapWorkspace, paths.workspaceJson);
  }
  if (haveManifest) {
    await copyInto(snapManifest, paths.manifestJson);
  } else {
    await fs.rm(paths.manifestJson, { force: true });
  }

  const currentFiles = await collectMarkdownFiles(
    paths.vaultDir,
    paths.excludeDirs ?? [],
  );
  const inSnapshot = new Set(snapFiles);
  for (const rel of currentFiles) {
    if (!inSnapshot.has(rel)) {
      await fs.rm(join(paths.vaultDir, rel), { force: true });
    }
  }
  for (const rel of snapFiles) {
    await copyInto(join(snapVaultDir, rel), join(paths.vaultDir, rel));
  }
}

export async function listSnapshotsIn(
  backupsDir: string,
): Promise<WorkspaceBackupInfo[]> {
  let names: string[];
  try {
    names = await fs.readdir(backupsDir);
  } catch {
    return [];
  }
  const infos: WorkspaceBackupInfo[] = [];
  for (const name of names) {
    const stamp = Number(name);
    if (!Number.isFinite(stamp) || stamp <= 0) continue;
    const dir = join(backupsDir, name);
    const { bytes, fileCount } = await measureDir(dir);
    infos.push({ id: name, createdAt: stamp, bytes, fileCount });
  }
  infos.sort((a, b) => b.createdAt - a.createdAt);
  return infos;
}

async function measureDir(
  dir: string,
): Promise<{ bytes: number; fileCount: number }> {
  let bytes = 0;
  let fileCount = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { bytes, fileCount };
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await measureDir(full);
      bytes += sub.bytes;
      fileCount += sub.fileCount;
    } else if (entry.isFile()) {
      try {
        bytes += (await fs.stat(full)).size;
        fileCount += 1;
      } catch {
        // best-effort sizing
      }
    }
  }
  return { bytes, fileCount };
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/** Reject anything that is not a plain epoch-ms id (IPC path-traversal guard). */
function isValidSnapshotId(id: string): boolean {
  return /^\d{10,17}$/.test(id);
}

// ---- profile-resolved wrappers (the IPC surface) ---------------------------

export async function listWorkspaceBackups(
  profile?: string,
): Promise<WorkspaceBackupInfo[]> {
  return listSnapshotsIn(workspaceBackupsDir(profile));
}

export async function createWorkspaceSnapshot(
  profile?: string,
): Promise<WorkspaceBackupInfo | null> {
  const id = String(Date.now());
  const destDir = join(workspaceBackupsDir(profile), id);
  try {
    const { bytes, fileCount } = await snapshotWorkspaceTo(
      workspacePaths(profile),
      destDir,
    );
    await pruneWorkspaceSnapshots(profile);
    return { id, createdAt: Number(id), bytes, fileCount };
  } catch {
    // Remove a half-written snapshot so it never lists as restorable.
    await fs.rm(destDir, { recursive: true, force: true }).catch(() => {});
    return null;
  }
}

async function pruneWorkspaceSnapshots(profile?: string): Promise<void> {
  const dir = workspaceBackupsDir(profile);
  const infos = await listSnapshotsIn(dir);
  const stale = selectSnapshotIdsToPrune(
    infos.map((info) => info.id),
    WORKSPACE_BACKUP_KEEP,
  );
  await Promise.all(
    stale.map((id) =>
      fs.rm(join(dir, id), { recursive: true, force: true }).catch(() => {}),
    ),
  );
}

export async function restoreWorkspaceSnapshot(
  id: string,
  profile?: string,
): Promise<WorkspaceRestoreResult> {
  if (!isValidSnapshotId(id)) {
    return { ok: false, error: "Invalid snapshot id." };
  }
  const snapDir = join(workspaceBackupsDir(profile), id);
  if (!(await exists(snapDir))) {
    return { ok: false, error: "Snapshot not found." };
  }
  // Safety snapshot of the current state first — refuse to restore without it.
  const safety = await createWorkspaceSnapshot(profile);
  if (!safety) {
    return {
      ok: false,
      error:
        "Refused: could not write a safety backup of the current state first.",
    };
  }
  try {
    await restoreSnapshotFrom(snapDir, workspacePaths(profile));
    return { ok: true, safetySnapshotId: safety.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      safetySnapshotId: safety.id,
    };
  }
}
