import { useEffect, useState, useCallback } from "react";
import {
  initApprovalState,
  enqueueApproval,
  resolveApproval,
  remainingSeconds,
  type ApprovalChoice,
  type ApprovalState,
} from "../../../../shared/approval";
import {
  initDelegationState,
  applyDelegateEvent,
  buildTree,
  type DelegateNode,
} from "../../../../shared/delegation";

/**
 * Subscribes to the gateway's approval (B1) and delegation (B3) SSE signals
 * (plumbed through `chat-approval-request` / `chat-delegate-progress`) and keeps
 * their pure reducers. Approvals matching a remembered-safe key are auto-resolved.
 *
 * NOTE: these events ride the runs/session-stream channel; the desktop's current
 * `/v1/chat/completions` path does not emit them yet (see plan B0). The wiring is
 * forward-compatible so it lights up once the chat path migrates.
 */
export function useChatSignals(profile?: string): {
  approvals: ApprovalState;
  respond: (id: string, choice: ApprovalChoice) => void;
  delegationTree: DelegateNode[];
  /** Opt-in auto-deny timeout (seconds); 0 = off (current behavior). */
  approvalTimeout: number;
  /** Ticking clock (epoch ms) so the countdown re-renders each second. */
  now: number;
} {
  const [approvals, setApprovals] = useState<ApprovalState>(() =>
    initApprovalState(),
  );
  const [delegation, setDelegation] = useState(() => initDelegationState());
  const [approvalTimeout, setApprovalTimeout] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    window.hermesAPI
      .getConfig("approval.timeout_seconds", profile)
      .then((v) => setApprovalTimeout(Math.max(0, parseInt(v || "0", 10) || 0)))
      .catch(() => setApprovalTimeout(0));
  }, [profile]);

  useEffect(() => {
    const offApproval = window.hermesAPI.onChatApprovalRequest((req) => {
      setApprovals((s) => {
        // Stamp the enqueue time so the countdown (and auto-deny) have a clock.
        const { state, autoResponse } = enqueueApproval(s, {
          ...req,
          enqueuedAt: Date.now(),
        });
        if (autoResponse) {
          void window.hermesAPI.respondApproval(
            autoResponse.id,
            autoResponse.choice,
            profile,
          );
        }
        return state;
      });
    });
    const offDelegate = window.hermesAPI.onChatDelegateProgress((p) => {
      setDelegation((s) => applyDelegateEvent(s, p));
    });
    return () => {
      offApproval();
      offDelegate();
    };
  }, [profile]);

  const respond = useCallback(
    (id: string, choice: ApprovalChoice) => {
      setApprovals((s) => {
        const { state, response } = resolveApproval(s, id, choice);
        void window.hermesAPI.respondApproval(
          response.id,
          response.choice,
          profile,
        );
        return state;
      });
    },
    [profile],
  );

  // One ticker drives both the visible countdown and the opt-in auto-deny. It
  // only runs while there are pending approvals AND a timeout is configured, so
  // there's no idle interval and timeout=0 preserves the current behavior.
  useEffect(() => {
    if (approvalTimeout <= 0 || approvals.queue.length === 0) return;
    const tick = (): void => {
      const t = Date.now();
      setNow(t);
      for (const req of approvals.queue) {
        if (remainingSeconds(req.enqueuedAt, t, approvalTimeout) === 0) {
          respond(req.id, "deny");
        }
      }
    };
    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  }, [approvalTimeout, approvals.queue, respond]);

  return {
    approvals,
    respond,
    delegationTree: buildTree(delegation),
    approvalTimeout,
    now,
  };
}
