// DiffBlock.tsx — AI tracked-change (old struck-through / new). Ported from editor.jsx.
import { Icon } from "../components/Icon";
import type { Block } from "../types";

interface Props {
  block: Block;
  onDecision: (proposalId: string, accept: boolean) => void;
}

export function DiffBlock({ block, onDecision }: Props) {
  const diff = block.diff!;
  return (
    <div className="diff-block">
      <div className="diff-head">
        <Icon name="sparkle" size={12} /> {diff.label || "Tracked change"}
        <div className="proposed-actions">
          <button
            className="pa-btn pa-reject"
            onClick={() => onDecision(diff.proposalId, false)}
          >
            Reject
          </button>
          <button
            className="pa-btn pa-accept"
            onClick={() => onDecision(diff.proposalId, true)}
          >
            <Icon name="check" size={12} /> Accept
          </button>
        </div>
      </div>
      <div
        className="diff-old"
        dangerouslySetInnerHTML={{ __html: diff.oldHtml }}
      />
      <div
        className="diff-new"
        dangerouslySetInnerHTML={{ __html: diff.newHtml }}
      />
    </div>
  );
}
