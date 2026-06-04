// storageActions.ts — F5: the shared migrate/rollback orchestration used by BOTH
// the command palette and the Storage settings panel, so there is one safe code
// path (parity gate + backup on migrate; blob save on rollback). The last backup
// path is persisted so the panel can show it across reloads.
import { migrateToVault } from "./vaultStore";
import {
  getStorageMode,
  setStorageMode,
  type StorageMode,
} from "./storageMode";
import { saveWorkspace } from "./persistence";
import type { Workspace } from "../types";

const BACKUP_KEY = "sps-agent-last-backup-v1";

/** The path of the most recent pre-migration JSON-blob backup, or null. */
export function getLastBackup(): string | null {
  try {
    return localStorage.getItem(BACKUP_KEY);
  } catch {
    return null;
  }
}

function setLastBackup(path: string): void {
  try {
    localStorage.setItem(BACKUP_KEY, path);
  } catch {
    /* ignore */
  }
}

export interface StorageToggleResult {
  ok: boolean;
  /** The authoritative mode AFTER the attempt (unchanged on a refused migrate). */
  mode: StorageMode;
  /** Human-readable outcome, for the toast / panel. */
  message: string;
  backup?: string | null;
}

/** Toggle the authoritative store: blob → vault (migrate, with the parity gate +
 *  a JSON-blob backup) or vault → blob (rollback). Pure orchestration — the
 *  caller surfaces `message`. Never throws. */
export async function toggleStorageMode(
  ws: Workspace,
): Promise<StorageToggleResult> {
  if (getStorageMode() === "blob") {
    const res = await migrateToVault(ws);
    if (!res.ok) {
      return {
        ok: false,
        mode: "blob",
        message: `Migration refused: ${res.reason}`,
      };
    }
    setStorageMode("vault");
    if (res.backup) setLastBackup(res.backup);
    return {
      ok: true,
      mode: "vault",
      backup: res.backup,
      message: `Migrated to markdown storage${res.backup ? " · blob backed up" : ""}`,
    };
  }
  saveWorkspace(ws); // persist current state to the blob before it's authoritative
  setStorageMode("blob");
  return { ok: true, mode: "blob", message: "Switched to JSON storage" };
}
