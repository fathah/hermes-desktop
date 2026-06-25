export const REQUEST_TIMEOUT_MS = 120_000;
export const STREAM_NO_CONTENT_DEADLINE_MS = 180_000;

export function requestTimeoutForAttempt(
  deadlineAt: number,
  now = Date.now(),
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
): number {
  const remaining = Math.max(0, deadlineAt - now);
  return Math.min(requestTimeoutMs, remaining);
}

export function retryDelayWithinDeadline(
  requestedDelayMs: number,
  deadlineAt: number,
  now = Date.now(),
): number | null {
  const remaining = deadlineAt - now;
  if (remaining <= 0) return null;
  return Math.min(requestedDelayMs, remaining);
}
