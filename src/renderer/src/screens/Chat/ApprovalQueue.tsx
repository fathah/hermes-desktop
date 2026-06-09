import { ShieldAlert } from "lucide-react";
import {
  remainingSeconds,
  type ApprovalState,
  type ApprovalChoice,
} from "../../../../shared/approval";

/**
 * Command-approval cards (idea B1). Renders any pending dangerous-command
 * approvals with the matched danger pattern and Allow / Allow-once / Always /
 * Deny actions. "Always" remembers the command as safe (handled in the reducer).
 * When an opt-in timeout is set, each card shows a live countdown to auto-deny.
 */
export function ApprovalQueue({
  state,
  onRespond,
  timeoutSeconds = 0,
  now = 0,
}: {
  state: ApprovalState;
  onRespond: (id: string, choice: ApprovalChoice) => void;
  timeoutSeconds?: number;
  now?: number;
}): React.JSX.Element | null {
  if (state.queue.length === 0) return null;
  return (
    <div
      className="chat-approval-queue"
      role="region"
      aria-label="Command approvals"
      aria-live="assertive"
    >
      {state.queue.map((req) => {
        const left = remainingSeconds(req.enqueuedAt, now, timeoutSeconds);
        return (
          <div
            key={req.id}
            className="chat-approval-card"
            role="alertdialog"
            aria-label={
              req.command
                ? `Approve command: ${req.command}`
                : "Approve command"
            }
          >
            <div className="chat-approval-head">
              <ShieldAlert size={15} />
              <span className="chat-approval-title">Approve command?</span>
              {req.patternKey && (
                <span className="chat-approval-pattern">{req.patternKey}</span>
              )}
              {left !== null && (
                <span
                  className="chat-approval-countdown"
                  title="Auto-denies when the timer runs out"
                >
                  auto-deny in {left}s
                </span>
              )}
            </div>
            {req.command && (
              <pre className="chat-approval-command">{req.command}</pre>
            )}
            {req.description && (
              <div className="chat-approval-desc">{req.description}</div>
            )}
            <div className="chat-approval-actions">
              <button
                className="btn btn-sm chat-approval-deny"
                onClick={() => onRespond(req.id, "deny")}
              >
                Deny
              </button>
              <button
                className="btn btn-sm"
                onClick={() => onRespond(req.id, "once")}
              >
                Allow once
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => onRespond(req.id, "always")}
              >
                Always allow
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
