interface WorkspacePanelProps {
  contextFolder?: string | null;
  toolOutput?: string;
}

function WorkspacePanel({ contextFolder, toolOutput }: WorkspacePanelProps): React.JSX.Element | null {
  if (!contextFolder && !toolOutput) return null;

  return (
    <aside className="workspace-panel">
      <h3 className="workspace-panel-title">Workspace</h3>
      {contextFolder && (
        <div className="workspace-panel-section">
          <div className="workspace-panel-label">Context folder</div>
          <code className="workspace-panel-path">{contextFolder}</code>
        </div>
      )}
      {toolOutput && (
        <div className="workspace-panel-section">
          <div className="workspace-panel-label">Latest tool output</div>
          <pre className="workspace-panel-output">{toolOutput}</pre>
        </div>
      )}
    </aside>
  );
}

export default WorkspacePanel;
