import { ShieldAlert } from "lucide-react";
import type {
  ApprovalState,
  ApprovalChoice,
} from "../../../../shared/approval";

/**
 * Command-approval cards (idea B1). Renders any pending dangerous-command
 * approvals with the matched danger pattern and Allow / Allow-once / Always /
 * Deny actions. "Always" remembers the command as safe (handled in the reducer).
 */
export function ApprovalQueue({
  state,
  onRespond,
}: {
  state: ApprovalState;
  onRespond: (id: string, choice: ApprovalChoice) => void;
}): React.JSX.Element | null {
  if (state.queue.length === 0) return null;
  return (
    <div className="chat-approval-queue">
      {state.queue.map((req) => (
        <div key={req.id} className="chat-approval-card">
          <div className="chat-approval-head">
            <ShieldAlert size={15} />
            <span className="chat-approval-title">Approve command?</span>
            {req.patternKey && (
              <span className="chat-approval-pattern">{req.patternKey}</span>
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
      ))}
    </div>
  );
}
