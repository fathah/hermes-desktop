import type { ChatMessage } from "../Chat/Chat";

/**
 * One concurrently-running (or open) conversation. Several runs coexist so the
 * user can background a session — or a whole agent/profile — and return to it
 * live. `runId` is minted in the renderer and threaded through the main process
 * so streaming events route back to the right run.
 */
export interface ChatRun {
  runId: string;
  /** Immutable: the profile/agent this run was started under. */
  profile: string;
  /** Gateway session id, known once the first turn reports it. */
  sessionId: string | null;
  /** True while the agent is generating for this run. */
  loading: boolean;
  /** Best-effort title (first user message) for the active-sessions bar. */
  title?: string;
  /** Seed transcript when the run was opened from history. */
  seed?: ChatMessage[];
}

/** A blank chat that can be reassigned to another profile without losing work. */
export function isScratchRun(r: ChatRun): boolean {
  return !r.sessionId && !r.loading && !r.title;
}

/** Mint a fresh, empty run under the given profile. */
export function mintRun(profile: string, seed?: ChatMessage[]): ChatRun {
  return {
    runId:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `run-${crypto.randomUUID()}`
        : `run-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    profile,
    sessionId: null,
    loading: false,
    seed,
  };
}

/** Immutably patch one run's fields by id. */
export function patchRun(
  runs: ChatRun[],
  runId: string,
  patch: Partial<ChatRun>,
): ChatRun[] {
  return runs.map((r) => (r.runId === runId ? { ...r, ...patch } : r));
}

/**
 * Keep the selected shell profile and the visible chat run in sync.
 *
 * Existing conversations remain under the profile they started with; switching
 * profiles activates a scratch run for the new profile instead of showing a
 * stale conversation from the previous one.
 */
export function selectProfileRunTransition(
  runs: ChatRun[],
  activeRunId: string,
  profile: string,
): { activeRunId: string; runs: ChatRun[] } {
  const active = runs.find((r) => r.runId === activeRunId);
  if (!active || active.profile === profile) {
    return { activeRunId, runs };
  }

  if (isScratchRun(active)) {
    return {
      activeRunId,
      runs: runs.map((r) =>
        r.runId === activeRunId ? { ...r, profile } : r,
      ),
    };
  }

  const scratch = runs.find((r) => r.profile === profile && isScratchRun(r));
  if (scratch) {
    return { activeRunId: scratch.runId, runs };
  }

  const next = mintRun(profile);
  return { activeRunId: next.runId, runs: [...runs, next] };
}

/**
 * Open a persisted session without leaving behind the active blank placeholder.
 *
 * Profile switching may create a scratch run so the visible chat matches the
 * selected profile. If the next action is opening a saved session for that same
 * profile, the saved session should occupy that placeholder tab.
 */
export function openSessionRunTransition(
  runs: ChatRun[],
  activeRunId: string,
  run: ChatRun,
): { activeRunId: string; runs: ChatRun[] } {
  const active = runs.find((r) => r.runId === activeRunId);
  if (active && active.profile === run.profile && isScratchRun(active)) {
    return {
      activeRunId: run.runId,
      runs: runs.map((r) => (r.runId === activeRunId ? run : r)),
    };
  }

  return { activeRunId: run.runId, runs: [...runs, run] };
}

/** The first live run already bound to a given gateway session id, if any. */
export function findRunBySession(
  runs: ChatRun[],
  sessionId: string,
): ChatRun | undefined {
  return runs.find((r) => r.sessionId === sessionId);
}

/** Session ids of every currently-loading run (for sidebar spinners). */
export function loadingSessionIds(runs: ChatRun[]): Set<string> {
  const ids = new Set<string>();
  for (const r of runs) {
    if (r.loading && r.sessionId) ids.add(r.sessionId);
  }
  return ids;
}
