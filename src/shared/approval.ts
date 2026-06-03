/**
 * Approval queue state machine (idea B1) — pure core.
 *
 * The gateway emits `approval.request` for dangerous commands and resolves them
 * via `POST /v1/runs/{run_id}/approval` with choice once|session|always|deny.
 * This module models the desktop-side queue: enqueue requests, auto-skip ones
 * matching a remembered-safe key, resolve a choice (promoting "always" into the
 * persisted safe set), and a default-deny for timeouts.
 *
 * Pure + testable; the IPC reply + UI live elsewhere.
 */

export type ApprovalChoice = "once" | "session" | "always" | "deny";

export interface PendingApproval {
  id: string;
  command?: string;
  toolName?: string;
  patternKey?: string;
  description?: string;
}

export interface ApprovalState {
  queue: PendingApproval[];
  /** Remembered-safe keys (patternKey or command) — auto-approved henceforth. */
  safe: string[];
}

export function initApprovalState(safe: string[] = []): ApprovalState {
  return { queue: [], safe: [...new Set(safe)] };
}

/** The key used for remember-safe matching: prefer patternKey, else command. */
export function safeKey(req: PendingApproval): string | undefined {
  return req.patternKey || req.command || undefined;
}

/** Would this request be auto-approved by a remembered-safe entry? */
export function isRemembered(
  state: ApprovalState,
  req: PendingApproval,
): boolean {
  const key = safeKey(req);
  return key !== undefined && state.safe.includes(key);
}

export interface EnqueueResult {
  state: ApprovalState;
  /** When the request matches a remembered-safe key, auto-resolve with this. */
  autoResponse?: { id: string; choice: ApprovalChoice };
}

/**
 * Add a request to the queue, unless it matches a remembered-safe key — in
 * which case it's auto-approved (choice "always") and not queued. Duplicate ids
 * are ignored.
 */
export function enqueueApproval(
  state: ApprovalState,
  req: PendingApproval,
): EnqueueResult {
  if (isRemembered(state, req)) {
    return { state, autoResponse: { id: req.id, choice: "always" } };
  }
  if (state.queue.some((q) => q.id === req.id)) return { state };
  return { state: { ...state, queue: [...state.queue, req] } };
}

export interface ResolveResult {
  state: ApprovalState;
  /** The response to send to the gateway. */
  response: { id: string; choice: ApprovalChoice };
}

/**
 * Resolve a queued request with a choice. Removes it from the queue; "always"
 * promotes its key into the persisted safe set. Resolving an unknown id still
 * returns a response (idempotent — the gateway may have timed it out).
 */
export function resolveApproval(
  state: ApprovalState,
  id: string,
  choice: ApprovalChoice,
): ResolveResult {
  const req = state.queue.find((q) => q.id === id);
  const queue = state.queue.filter((q) => q.id !== id);
  let safe = state.safe;
  if (choice === "always" && req) {
    const key = safeKey(req);
    if (key && !safe.includes(key)) safe = [...safe, key];
  }
  return { state: { queue, safe }, response: { id, choice } };
}

/** Default-deny response for a timed-out request (UI calls resolveApproval). */
export function timeoutChoice(): ApprovalChoice {
  return "deny";
}
