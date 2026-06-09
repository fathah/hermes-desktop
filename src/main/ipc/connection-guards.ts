import { getConnectionConfig } from "../config";

/**
 * Throws when the active connection is not local-mode. Workspace/notes file
 * operations read and write the on-disk vault directly, which is only reachable
 * when Hermes runs locally.
 *
 * Shared by ipc/workspace.ts and ipc/notes.ts (previously duplicated verbatim).
 * Tier 1.3 will fold this into the broader connection-capability map.
 */
export function requireLocalWorkspace(): void {
  const conn = getConnectionConfig();
  if (conn.mode !== "local") {
    throw new Error(
      "Workspace files are only available in local mode in this version.",
    );
  }
}
