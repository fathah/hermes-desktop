import { getConnectionConfig } from "../config";
import {
  supportsCapability,
  UnsupportedConnectionModeError,
} from "../connection-capabilities";

/**
 * Throws when the active connection cannot serve workspace files. Workspace /
 * notes / skill-file operations read and write the on-disk vault directly,
 * which is only reachable when Hermes runs locally.
 *
 * The decision is driven by the `workspaceFiles` entry in the connection
 * capability matrix (single source of truth); the message is kept user-facing.
 * Shared by ipc/workspace.ts and ipc/notes.ts (previously duplicated verbatim).
 */
export function requireLocalWorkspace(): void {
  if (!supportsCapability("workspaceFiles")) {
    throw new UnsupportedConnectionModeError(
      getConnectionConfig().mode,
      "Workspace files are only available in local mode in this version.",
    );
  }
}
