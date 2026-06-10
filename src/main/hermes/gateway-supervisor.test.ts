import { describe, it, expect } from "vitest";
import {
  DEFAULT_SUPERVISOR_CONFIG,
  decideSupervisorAction,
  initialSupervisorState,
  type SupervisorConfig,
} from "./gateway-supervisor";

// Pure state-machine spec for the gateway health supervisor (Phase 1.1).
// Effects (timers, fetch, kill, startGateway, renderer broadcast) live in
// gateway-process.ts and call into this module — this file only proves the
// decision logic, which is why it is vitest-safe (no better-sqlite3, no Electron).

const config: SupervisorConfig = {
  ...DEFAULT_SUPERVISOR_CONFIG,
  failureThreshold: 3,
  maxRestartAttempts: 3,
  baseBackoffMs: 2000,
  maxBackoffMs: 30000,
};

const healthy = { healthy: true, streamOpen: false };
const failing = { healthy: false, streamOpen: false };
const failingMidStream = { healthy: false, streamOpen: true };

describe("gateway supervisor decision logic", () => {
  it("starts in a healthy, zeroed state", () => {
    const state = initialSupervisorState();
    expect(state.status).toBe("healthy");
    expect(state.consecutiveFailures).toBe(0);
    expect(state.restartAttempts).toBe(0);
  });

  it("a healthy probe keeps status healthy and takes no action", () => {
    const start = initialSupervisorState();
    const decision = decideSupervisorAction(start, healthy, config);
    expect(decision.action.type).toBe("none");
    expect(decision.state.status).toBe("healthy");
    expect(decision.state.consecutiveFailures).toBe(0);
    expect(decision.statusChanged).toBe(false);
  });

  it("a single failure increments the counter without restarting (below threshold)", () => {
    const start = initialSupervisorState();
    const decision = decideSupervisorAction(start, failing, config);
    expect(decision.action.type).toBe("none");
    expect(decision.state.consecutiveFailures).toBe(1);
    expect(decision.state.status).toBe("unhealthy");
    expect(decision.statusChanged).toBe(true);
  });

  it("the third consecutive failure (no open stream) triggers a restart", () => {
    let state = initialSupervisorState();
    state = decideSupervisorAction(state, failing, config).state;
    state = decideSupervisorAction(state, failing, config).state;
    const decision = decideSupervisorAction(state, failing, config);
    expect(decision.action.type).toBe("restart");
    expect(decision.state.status).toBe("recovering");
    expect(decision.state.restartAttempts).toBe(1);
    // counter resets so the next probe window starts fresh after the restart
    expect(decision.state.consecutiveFailures).toBe(0);
  });

  it("never restarts while an interactive stream is open, even past threshold", () => {
    let state = initialSupervisorState();
    state = decideSupervisorAction(state, failingMidStream, config).state;
    state = decideSupervisorAction(state, failingMidStream, config).state;
    const decision = decideSupervisorAction(state, failingMidStream, config);
    expect(decision.action.type).toBe("none");
    expect(decision.state.status).toBe("unhealthy");
    expect(decision.state.restartAttempts).toBe(0);
  });

  it("a healthy probe resets every counter back to healthy", () => {
    let state = initialSupervisorState();
    state = decideSupervisorAction(state, failing, config).state;
    state = decideSupervisorAction(state, failing, config).state;
    const recovered = decideSupervisorAction(state, healthy, config);
    expect(recovered.state.status).toBe("healthy");
    expect(recovered.state.consecutiveFailures).toBe(0);
    expect(recovered.state.restartAttempts).toBe(0);
    expect(recovered.statusChanged).toBe(true);
  });

  it("applies exponential backoff per restart attempt, capped at maxBackoffMs", () => {
    const backoffs: number[] = [];
    let state = initialSupervisorState();
    // Drive three restarts; each needs three failures to cross the threshold.
    for (let attempt = 0; attempt < 3; attempt++) {
      let decision = decideSupervisorAction(state, failing, config);
      decision = decideSupervisorAction(decision.state, failing, config);
      decision = decideSupervisorAction(decision.state, failing, config);
      expect(decision.action.type).toBe("restart");
      if (decision.action.type === "restart") {
        backoffs.push(decision.action.backoffMs);
      }
      state = decision.state;
    }
    expect(backoffs[0]).toBe(2000);
    expect(backoffs[1]).toBe(4000);
    expect(backoffs[2]).toBe(8000);
    expect(backoffs.every((ms) => ms <= config.maxBackoffMs)).toBe(true);
  });

  it("marks the gateway down once restart attempts are exhausted", () => {
    let state = initialSupervisorState();
    // Exhaust the 3 restart attempts.
    for (let attempt = 0; attempt < 3; attempt++) {
      let decision = decideSupervisorAction(state, failing, config);
      decision = decideSupervisorAction(decision.state, failing, config);
      decision = decideSupervisorAction(decision.state, failing, config);
      state = decision.state;
    }
    // One more failure window with attempts spent -> mark down, no further restart.
    let next = decideSupervisorAction(state, failing, config);
    next = decideSupervisorAction(next.state, failing, config);
    next = decideSupervisorAction(next.state, failing, config);
    expect(next.action.type).toBe("mark-down");
    expect(next.state.status).toBe("down");
  });

  it("recovers from down when the gateway becomes healthy again (e.g. manual restart)", () => {
    let state = initialSupervisorState();
    state = {
      ...state,
      status: "down",
      restartAttempts: 3,
      consecutiveFailures: 9,
    };
    const decision = decideSupervisorAction(state, healthy, config);
    expect(decision.state.status).toBe("healthy");
    expect(decision.state.restartAttempts).toBe(0);
    expect(decision.statusChanged).toBe(true);
  });
});
