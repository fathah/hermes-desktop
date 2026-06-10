// Phase 1.1 — Gateway supervision (pure decision logic).
//
// The old health poll (gateway-process.startHealthPolling) self-cancelled the
// instant the gateway first reported healthy, so a *hang* after startup (process
// alive, /health unresponsive) was never re-detected. This module is the brain of
// a permanent supervisor: a pure state machine that, given the latest health
// probe and whether an interactive stream is open, decides whether to do nothing,
// restart the gateway (with exponential backoff, bounded attempts), or surface a
// persistent "down" state. All side effects (timers, fetch, kill, startGateway,
// renderer broadcast) live in gateway-process.ts, which keeps this testable under
// vitest without Electron or better-sqlite3.

import type { GatewayHealthStatus } from "../../shared/gateway";

export type { GatewayHealthStatus };

export interface SupervisorState {
  status: GatewayHealthStatus;
  consecutiveFailures: number;
  restartAttempts: number;
}

export interface SupervisorConfig {
  // How many consecutive failed probes before we act.
  failureThreshold: number;
  // How many auto-restarts to attempt before giving up and marking "down".
  maxRestartAttempts: number;
  // First restart waits this long; each subsequent attempt doubles it.
  baseBackoffMs: number;
  // Upper bound on the exponential backoff.
  maxBackoffMs: number;
}

export interface SupervisorObservation {
  // Result of the latest /health probe.
  healthy: boolean;
  // True while an interactive chat stream is mid-flight — we never silent-restart
  // underneath an open stream (it would kill the user's in-progress turn).
  streamOpen: boolean;
}

export type SupervisorAction =
  | { type: "none" }
  | { type: "restart"; backoffMs: number }
  | { type: "mark-down" };

export interface SupervisorDecision {
  action: SupervisorAction;
  state: SupervisorState;
  // True when status changed vs the input state — the effect layer emits
  // "gateway-health-changed" to the renderer only on a real transition.
  statusChanged: boolean;
}

export const DEFAULT_SUPERVISOR_CONFIG: SupervisorConfig = {
  failureThreshold: 3,
  maxRestartAttempts: 3,
  baseBackoffMs: 2000,
  maxBackoffMs: 30000,
};

export function initialSupervisorState(): SupervisorState {
  return {
    status: "healthy",
    consecutiveFailures: 0,
    restartAttempts: 0,
  };
}

function backoffForAttempt(attempt: number, config: SupervisorConfig): number {
  // attempt is 1-based: attempt 1 -> base, attempt 2 -> base*2, ...
  const exponent = Math.max(0, attempt - 1);
  const raw = config.baseBackoffMs * 2 ** exponent;
  return Math.min(config.maxBackoffMs, raw);
}

export function decideSupervisorAction(
  state: SupervisorState,
  observation: SupervisorObservation,
  config: SupervisorConfig = DEFAULT_SUPERVISOR_CONFIG,
): SupervisorDecision {
  // Healthy probe always wins: it clears every counter and recovers from any
  // prior status (including a manual restart that fixed a "down" gateway).
  if (observation.healthy) {
    const nextState: SupervisorState = {
      status: "healthy",
      consecutiveFailures: 0,
      restartAttempts: 0,
    };
    const statusChanged = state.status !== nextState.status;
    return { action: { type: "none" }, state: nextState, statusChanged };
  }

  const failures = state.consecutiveFailures + 1;
  const belowThreshold = failures < config.failureThreshold;

  // Not enough consecutive failures yet — just count and keep probing.
  if (belowThreshold) {
    const nextState: SupervisorState = {
      ...state,
      status: "unhealthy",
      consecutiveFailures: failures,
    };
    const statusChanged = state.status !== nextState.status;
    return { action: { type: "none" }, state: nextState, statusChanged };
  }

  // Threshold crossed but a stream is open — defer, never restart mid-turn.
  if (observation.streamOpen) {
    const nextState: SupervisorState = {
      ...state,
      status: "unhealthy",
      consecutiveFailures: failures,
    };
    const statusChanged = state.status !== nextState.status;
    return { action: { type: "none" }, state: nextState, statusChanged };
  }

  // Threshold crossed, no open stream — restart if attempts remain.
  const attemptsRemaining = state.restartAttempts < config.maxRestartAttempts;
  if (attemptsRemaining) {
    const attempt = state.restartAttempts + 1;
    const backoffMs = backoffForAttempt(attempt, config);
    const nextState: SupervisorState = {
      status: "recovering",
      consecutiveFailures: 0,
      restartAttempts: attempt,
    };
    const statusChanged = state.status !== nextState.status;
    return {
      action: { type: "restart", backoffMs },
      state: nextState,
      statusChanged,
    };
  }

  // Out of attempts — mark down and stop auto-restarting until a healthy probe.
  const nextState: SupervisorState = {
    ...state,
    status: "down",
    consecutiveFailures: failures,
  };
  const statusChanged = state.status !== nextState.status;
  return { action: { type: "mark-down" }, state: nextState, statusChanged };
}
