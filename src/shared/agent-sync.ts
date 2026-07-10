// Shared shapes for cloud agent sync (desktop profiles ↔ hermes-one-backend
// /api/agents), used across the main process, preload bridge, and renderer.

/** Per-agent outcome of one sync pass. */
export interface AgentSyncOutcome {
  /** Local profile name ("default" included), or the sanitized name for a pull-created profile. */
  profile: string;
  /** Cloud agent id the profile is (now) linked to, when linked. */
  agentId?: string;
  action:
    | "up-to-date"
    | "pushed"
    | "pulled"
    | "created-remote"
    | "created-local"
    | "unlinked"
    | "error";
  /** Human-readable notes: skipped oversize parts, name mismatches, errors. */
  warnings: string[];
}

export interface AgentSyncResult {
  status: "ok" | "signed-out" | "unauthorized" | "error";
  /** Set when status is "error" (network/server failure before any per-agent work). */
  error?: string;
  outcomes: AgentSyncOutcome[];
  /** Epoch ms when the pass finished. */
  finishedAt: number;
}

/** What the renderer polls to render the sync affordance. */
export interface AgentSyncStatus {
  signedIn: boolean;
  /** Email/name of the signed-in user, for display. */
  accountLabel: string | null;
  running: boolean;
  lastResult: AgentSyncResult | null;
}
