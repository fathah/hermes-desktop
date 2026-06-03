import { useEffect, useState, useCallback } from "react";
import {
  initApprovalState,
  enqueueApproval,
  resolveApproval,
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
} {
  const [approvals, setApprovals] = useState<ApprovalState>(() =>
    initApprovalState(),
  );
  const [delegation, setDelegation] = useState(() => initDelegationState());

  useEffect(() => {
    const offApproval = window.hermesAPI.onChatApprovalRequest((req) => {
      setApprovals((s) => {
        const { state, autoResponse } = enqueueApproval(s, req);
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

  return { approvals, respond, delegationTree: buildTree(delegation) };
}
