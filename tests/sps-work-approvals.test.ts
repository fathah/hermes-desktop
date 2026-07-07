import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initApprovalState } from "../src/renderer/src/lib/approval";
import { useStore } from "../src/renderer/src/screens/SpsAgent/store";

const respondApproval = vi.fn().mockResolvedValue({ ok: true });

Object.defineProperty(window, "hermesAPI", {
  value: {
    respondApproval,
  },
  writable: true,
});

describe("SPS work approvals", () => {
  beforeEach(() => {
    respondApproval.mockClear();
    useStore.setState({
      workApprovals: initApprovalState(),
      workApprovalTimeout: 0,
      workApprovalNow: 0,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("enqueues manual approval requests and resolves an allow-once response", () => {
    useStore
      .getState()
      .enqueueWorkApproval({ id: "a1", command: "rm -rf /tmp/sps" });

    expect(useStore.getState().workApprovals.queue).toMatchObject([
      { id: "a1", command: "rm -rf /tmp/sps" },
    ]);
    expect(respondApproval).not.toHaveBeenCalled();

    useStore.getState().respondWorkApproval("a1", "once");

    expect(useStore.getState().workApprovals.queue).toHaveLength(0);
    expect(respondApproval).toHaveBeenCalledWith("a1", "once", undefined);
  });

  it("auto-denies queued approvals after the configured timeout", () => {
    useStore.setState({ workApprovalTimeout: 3 });
    useStore.getState().enqueueWorkApproval({
      id: "a1",
      command: "rm -rf /tmp/sps",
      enqueuedAt: 1000,
    });

    useStore.getState().tickWorkApprovalTimeouts(4500);

    expect(useStore.getState().workApprovals.queue).toHaveLength(0);
    expect(respondApproval).toHaveBeenCalledWith("a1", "deny", undefined);
  });

  it("remembers an always-allowed key and auto-responds to matching requests", () => {
    useStore.getState().enqueueWorkApproval({
      id: "a1",
      command: "danger",
      patternKey: "shell-danger",
    });
    useStore.getState().respondWorkApproval("a1", "always");
    respondApproval.mockClear();

    useStore.getState().enqueueWorkApproval({
      id: "a2",
      command: "danger again",
      patternKey: "shell-danger",
    });

    expect(useStore.getState().workApprovals.queue).toHaveLength(0);
    expect(respondApproval).toHaveBeenCalledWith("a2", "always", undefined);
  });
});
