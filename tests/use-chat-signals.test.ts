import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useChatSignals } from "../src/renderer/src/screens/Chat/useChatSignals";

// Minimal window.hermesAPI mock for the approval/delegation signal hook. We
// capture the approval callback so the test can fire a gateway event, and a
// respondApproval spy so we can assert the opt-in auto-deny fires on timeout.
type ApprovalCb = (req: { id: string; command?: string }) => void;

let approvalCb: ApprovalCb | null = null;
const respondApproval = vi.fn().mockResolvedValue(undefined);
const getConfig = vi.fn().mockResolvedValue("3"); // 3-second timeout

beforeEach(() => {
  approvalCb = null;
  respondApproval.mockClear();
  getConfig.mockClear();
  // Attach to the existing jsdom window — do NOT replace it (that would strip
  // the DOM @testing-library needs).
  (window as unknown as { hermesAPI: unknown }).hermesAPI = {
    onChatApprovalRequest: (cb: ApprovalCb) => {
      approvalCb = cb;
      return () => {};
    },
    onChatDelegateProgress: () => () => {},
    respondApproval,
    getConfig,
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useChatSignals — approval countdown + auto-deny", () => {
  it("enqueues an approval and stamps it", async () => {
    const { result } = renderHook(() => useChatSignals("default"));
    await waitFor(() => expect(getConfig).toHaveBeenCalled());
    act(() => approvalCb?.({ id: "a1", command: "rm -rf /tmp/x" }));
    expect(result.current.approvals.queue).toHaveLength(1);
    expect(result.current.approvals.queue[0].enqueuedAt).toBeTypeOf("number");
  });

  it("auto-denies once the configured timeout elapses", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useChatSignals("default"));
    // Flush the getConfig promise so approvalTimeout becomes 3.
    await act(async () => {
      await Promise.resolve();
    });
    act(() => approvalCb?.({ id: "a1", command: "rm -rf /tmp/x" }));
    expect(result.current.approvals.queue).toHaveLength(1);

    act(() => vi.advanceTimersByTime(3000));

    expect(respondApproval).toHaveBeenCalledWith("a1", "deny", "default");
    expect(result.current.approvals.queue).toHaveLength(0);
  });

  it("never auto-denies when the timeout is off (0)", async () => {
    getConfig.mockResolvedValueOnce("0");
    vi.useFakeTimers();
    const { result } = renderHook(() => useChatSignals("default"));
    await act(async () => {
      await Promise.resolve();
    });
    act(() => approvalCb?.({ id: "a1", command: "rm -rf /tmp/x" }));
    act(() => vi.advanceTimersByTime(120000));
    expect(respondApproval).not.toHaveBeenCalled();
    expect(result.current.approvals.queue).toHaveLength(1);
  });
});
