// vaultStore.ts — Part 2 / S6: the vault-as-authoritative load/save path, plus a
// safe, symmetric migrate (blob → vault) and rollback (vault → blob).
//
// Safety rails:
//   • migrate runs a parity pre-check and REFUSES if content/structure would not
//     round-trip (parity.ok includes blockAnchorsOk — comment-anchored block ids
//     are persisted in markdown by F2, so anchored comments no longer block).
//   • migrate backs up the JSON blob (timestamped) before writing the vault.
//   • migrate and rollback are inverses, so neither direction loses edits.
//   • the blob is never deleted — rollback just makes it authoritative again.
import {
  workspaceToVault,
  vaultToWorkspace,
  workspaceManifest,
  workspaceParity,
  commentAnchorIds,
  type VaultSnapshot,
} from "../editor/workspaceVault";
import { pageToMarkdown } from "../editor/pageMarkdown";
import type { Workspace } from "../types";

/** Read the authoritative vault into a workspace, or null if not populated. */
export async function readVaultWorkspace(): Promise<Workspace | null> {
  const api = window.hermesAPI;
  if (!api?.spsVaultRead) return null;
  try {
    const { pages, manifest } = await api.spsVaultRead();
    if (!manifest || Object.keys(pages).length === 0) return null;
    const snapshot: VaultSnapshot = { pages, manifest: JSON.parse(manifest) };
    return vaultToWorkspace(snapshot);
  } catch {
    return null;
  }
}

/** Write a whole workspace to the vault (every page file + the manifest). */
export async function writeVaultWorkspace(ws: Workspace): Promise<void> {
  const api = window.hermesAPI;
  if (!api?.spsExportPage || !api.spsVaultWriteManifest) return;
  const { pages } = workspaceToVault(ws);
  await Promise.all(
    Object.entries(pages).map(([id, md]) => api.spsExportPage(id, md)),
  );
  await api.spsVaultWriteManifest(JSON.stringify(workspaceManifest(ws)));
}

/** Persist a single page + the manifest while in vault mode (debounced save). */
export async function saveVaultPage(
  ws: Workspace,
  pageId: string,
): Promise<void> {
  const api = window.hermesAPI;
  if (!api?.spsExportPage || !api.spsVaultWriteManifest) return;
  const md = pageToMarkdown(
    ws.meta[pageId] ?? {},
    ws.docs[pageId] ?? [],
    commentAnchorIds(ws.comments),
  );
  await api.spsExportPage(pageId, md);
  await api.spsVaultWriteManifest(JSON.stringify(workspaceManifest(ws)));
}

export interface MigrationResult {
  ok: boolean;
  reason?: string;
  backup?: string | null;
}

/** Migrate the blob workspace into the vault, with a parity gate + backup. */
export async function migrateToVault(ws: Workspace): Promise<MigrationResult> {
  const report = workspaceParity(ws);
  if (!report.ok) {
    // F2 persists ids for comment-anchored blocks, so anchored comments no
    // longer block cutover; parity.ok already incorporates blockAnchorsOk.
    return { ok: false, reason: "Content would not round-trip losslessly" };
  }
  const api = window.hermesAPI;
  const backup = api?.spsBackupWorkspace
    ? await api.spsBackupWorkspace()
    : null;
  await writeVaultWorkspace(ws);
  return { ok: true, backup };
}

/** Roll back to the blob: reconstruct the blob from the vault, then it's truth. */
export async function rollbackToBlob(): Promise<Workspace | null> {
  const ws = await readVaultWorkspace();
  if (!ws) return null;
  const api = window.hermesAPI;
  if (api?.spsSave) await api.spsSave(ws);
  return ws;
}
