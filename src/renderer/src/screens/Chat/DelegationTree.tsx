import type { DelegateNode } from "../../lib/delegation";

/**
 * Live subagent delegation tree (idea B3). Renders the parent→child tree built
 * by the pure reducer from `hermes.delegate.progress` events, each node showing
 * its goal/tool and run status.
 */
export function DelegationTree({
  tree,
}: {
  tree: DelegateNode[];
}): React.JSX.Element | null {
  if (tree.length === 0) return null;
  const summary = summarizeTree(tree);

  return (
    <details className="chat-delegation">
      <summary className="chat-delegation-summary">
        <span className="chat-delegation-title">Delegated work</span>
        <span className="chat-delegation-counts">· {summary}</span>
      </summary>
      <div className="chat-delegation-body">
        {tree.map((node) => (
          <DelegationNode key={node.id} node={node} depth={0} />
        ))}
      </div>
    </details>
  );
}

function summarizeTree(tree: DelegateNode[]): string {
  const counts = countStatuses(tree);
  const parts = [
    counts.running > 0 ? `${counts.running} running` : null,
    counts.done > 0 ? `${counts.done} done` : null,
    counts.error > 0
      ? `${counts.error} ${counts.error === 1 ? "error" : "errors"}`
      : null,
  ].filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(", ") : "No active delegated work";
}

function countStatuses(
  nodes: DelegateNode[],
): Record<DelegateNode["status"], number> {
  const counts: Record<DelegateNode["status"], number> = {
    running: 0,
    done: 0,
    error: 0,
  };

  for (const node of nodes) {
    counts[node.status] += 1;
    const childCounts = countStatuses(node.children);
    counts.running += childCounts.running;
    counts.done += childCounts.done;
    counts.error += childCounts.error;
  }

  return counts;
}

function DelegationNode({
  node,
  depth,
}: {
  node: DelegateNode;
  depth: number;
}): React.JSX.Element {
  return (
    <div className="chat-delegation-node" style={{ marginLeft: depth * 16 }}>
      <div className="chat-delegation-row">
        <span
          className={`chat-delegation-status chat-delegation-status--${node.status}`}
        />
        <span className="chat-delegation-goal">
          {node.goal || node.label || node.id}
        </span>
        {node.tool && <span className="chat-delegation-tool">{node.tool}</span>}
      </div>
      {node.children.map((child) => (
        <DelegationNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}
