import { getConnectionConfig } from "./config";

export type ConnectionMode = "local" | "remote" | "ssh";

/**
 * Feature-parity matrix: which connection modes actually implement each
 * capability. The desktop is **local-first**; **SSH** is built out
 * incrementally; **remote-URL** mode is not a target and implements only the
 * chat path (handled directly in ipc/chat.ts, not through this matrix).
 *
 * This is the single source of truth for "what works where." Previously the
 * answer was scattered and implicit — `registerDualHandler` silently routed
 * unsupported modes to the local implementation, and local-only gates were
 * ad-hoc `getConnectionConfig().mode !== "local"` throws. A capability is
 * *gated* (via {@link requireCapability}) only when it is local-only; the
 * dual-mode features are enforced structurally by `registerDualHandler`
 * having (or deliberately not having) an SSH implementation per channel.
 */
export const CONNECTION_CAPABILITIES = {
  /** Vault / notes / skill-file editing — reads & writes local disk directly. */
  workspaceFiles: ["local"],
  /** Editing long-term memory, focus, and the daily-context hook. */
  memoryWrite: ["local"],
  /** Reading memory and the soul prompt. */
  memoryRead: ["local", "ssh"],
  /** Listing / searching / reading chat sessions. */
  sessions: ["local", "ssh"],
  /** Installing, removing, and reading installed skills. */
  skillsInstall: ["local", "ssh"],
  /** Toolset enable/disable. */
  toolsets: ["local", "ssh"],
} as const satisfies Record<string, readonly ConnectionMode[]>;

export type Capability = keyof typeof CONNECTION_CAPABILITIES;

/**
 * Thrown when an operation is invoked under a connection mode that does not
 * implement it — either a local-only capability accessed remotely/over SSH,
 * or a `registerDualHandler` channel invoked in (unsupported) remote mode.
 */
export class UnsupportedConnectionModeError extends Error {
  constructor(
    readonly mode: ConnectionMode,
    detail: string,
  ) {
    super(detail);
    this.name = "UnsupportedConnectionModeError";
  }
}

/** True iff `mode` (default: the active connection mode) implements `cap`. */
export function supportsCapability(
  cap: Capability,
  mode: ConnectionMode = getConnectionConfig().mode,
): boolean {
  return (CONNECTION_CAPABILITIES[cap] as readonly ConnectionMode[]).includes(
    mode,
  );
}

/**
 * Throw {@link UnsupportedConnectionModeError} when the active connection mode
 * does not implement `cap`. Use to gate handlers whose implementation only
 * exists for some modes (e.g. local-only file operations).
 */
export function requireCapability(cap: Capability): void {
  const mode = getConnectionConfig().mode;
  if (!supportsCapability(cap, mode)) {
    throw new UnsupportedConnectionModeError(
      mode,
      `This operation (${cap}) is not available over a ${mode} connection in this version.`,
    );
  }
}

/**
 * Routing decision for `registerDualHandler`: which implementation a dual-mode
 * IPC channel should use for the given connection. `ssh` when SSH is configured,
 * `remote-unsupported` when in remote-URL mode (no implementation — caller must
 * raise {@link UnsupportedConnectionModeError} rather than silently use local),
 * `local` otherwise. Pure so the routing policy can be unit-tested without
 * Electron's `ipcMain`.
 */
export function dualHandlerTarget(conn: {
  mode: ConnectionMode;
  ssh?: unknown;
}): "local" | "ssh" | "remote-unsupported" {
  if (conn.mode === "ssh" && conn.ssh) return "ssh";
  if (conn.mode === "remote") return "remote-unsupported";
  return "local";
}
