import type { DelegateNode } from "../../../../shared/delegation";

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
  return (
    <div className="chat-delegation">
      <div className="chat-delegation-title">Delegated work</div>
      {tree.map((node) => (
        <DelegationNode key={node.id} node={node} depth={0} />
      ))}
    </div>
  );
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
