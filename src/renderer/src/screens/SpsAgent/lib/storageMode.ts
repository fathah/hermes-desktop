// storageMode.ts — Part 2 / S6: which store is authoritative for SPS content.
//   "blob"  — the JSON workspace.json is the source of truth (default; the vault
//             is an additive mirror).
//   "vault" — the markdown vault (page files + manifest) is the source of truth;
//             the editor loads from it and the blob is left as a backup.
// Persisted to localStorage, like the other SPS UI settings. Default "blob" so
// nothing changes until the user explicitly migrates.
const KEY = "sps-agent-storage-mode-v1";

export type StorageMode = "blob" | "vault";

export function getStorageMode(): StorageMode {
  try {
    return localStorage.getItem(KEY) === "vault" ? "vault" : "blob";
  } catch {
    return "blob";
  }
}

export function setStorageMode(mode: StorageMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* ignore */
  }
}
