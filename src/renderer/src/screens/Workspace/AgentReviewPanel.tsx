import { Check, X } from "lucide-react";

interface AgentWorkspaceProposal {
  id: string;
  path: string;
  baseContent: string;
  proposedContent: string;
  createdAt: number;
}

interface AgentReviewPanelProps {
  proposals: AgentWorkspaceProposal[];
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}

function lineCount(content: string): number {
  return content.split(/\r?\n/).length;
}

export default function AgentReviewPanel({
  proposals,
  onAccept,
  onReject,
}: AgentReviewPanelProps): React.JSX.Element | null {
  if (proposals.length === 0) return null;

  return (
    <section className="workspace-agent-review" aria-label="Agent edit review">
      <div className="workspace-agent-review-title">
        <span>Agent proposals</span>
        <strong>{proposals.length}</strong>
      </div>
      {proposals.map((proposal) => (
        <article key={proposal.id} className="workspace-agent-proposal">
          <div>
            <strong>{proposal.path}</strong>
            <small>
              {lineCount(proposal.baseContent)} lines to{" "}
              {lineCount(proposal.proposedContent)} lines
            </small>
          </div>
          <div className="workspace-agent-proposal-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onReject(proposal.id)}
            >
              <X size={14} />
              Reject
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => onAccept(proposal.id)}
            >
              <Check size={14} />
              Accept
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
