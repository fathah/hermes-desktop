import { describe, it, expect } from "vitest";
import {
  initApprovalState,
  enqueueApproval,
  resolveApproval,
  isRemembered,
  safeKey,
  timeoutChoice,
  type PendingApproval,
} from "../src/shared/approval";

const req = (over: Partial<PendingApproval> = {}): PendingApproval => ({
  id: "a1",
  command: "rm -rf /tmp/x",
  patternKey: "rm_recursive",
  ...over,
});

describe("enqueueApproval", () => {
  it("queues a fresh request", () => {
    const { state, autoResponse } = enqueueApproval(initApprovalState(), req());
    expect(autoResponse).toBeUndefined();
    expect(state.queue).toHaveLength(1);
  });

  it("ignores duplicate ids", () => {
    let s = initApprovalState();
    s = enqueueApproval(s, req()).state;
    s = enqueueApproval(s, req()).state;
    expect(s.queue).toHaveLength(1);
  });

  it("auto-approves a remembered-safe request instead of queueing", () => {
    const base = initApprovalState(["rm_recursive"]);
    const { state, autoResponse } = enqueueApproval(base, req());
    expect(state.queue).toHaveLength(0);
    expect(autoResponse).toEqual({ id: "a1", choice: "always" });
  });
});

describe("resolveApproval", () => {
  it("removes the request and returns the choice", () => {
    const base = enqueueApproval(initApprovalState(), req()).state;
    const { state, response } = resolveApproval(base, "a1", "once");
    expect(response).toEqual({ id: "a1", choice: "once" });
    expect(state.queue).toHaveLength(0);
    expect(state.safe).toEqual([]);
  });

  it("promotes the key into safe on 'always'", () => {
    const base = enqueueApproval(initApprovalState(), req()).state;
    const { state } = resolveApproval(base, "a1", "always");
    expect(state.safe).toContain("rm_recursive");
    // a subsequent matching request now auto-approves
    expect(isRemembered(state, req({ id: "a2" }))).toBe(true);
  });

  it("does not promote on deny", () => {
    const base = enqueueApproval(initApprovalState(), req()).state;
    const { state } = resolveApproval(base, "a1", "deny");
    expect(state.safe).toEqual([]);
  });

  it("is idempotent for an unknown id (gateway may have timed out)", () => {
    const { response, state } = resolveApproval(
      initApprovalState(),
      "ghost",
      "deny",
    );
    expect(response).toEqual({ id: "ghost", choice: "deny" });
    expect(state.queue).toEqual([]);
  });
});

describe("safeKey / timeout", () => {
  it("prefers patternKey, falls back to command", () => {
    expect(safeKey(req())).toBe("rm_recursive");
    expect(safeKey(req({ patternKey: undefined }))).toBe("rm -rf /tmp/x");
  });
  it("times out to deny", () => {
    expect(timeoutChoice()).toBe("deny");
  });
});
