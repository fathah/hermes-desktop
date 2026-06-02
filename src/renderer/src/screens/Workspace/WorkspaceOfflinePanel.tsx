interface WorkspaceOfflinePanelProps {
  dirty: boolean;
  conflictPending: boolean;
  proposalCount: number;
  lastSavedLabel: string;
}

export default function WorkspaceOfflinePanel({
  dirty,
  conflictPending,
  proposalCount,
  lastSavedLabel,
}: WorkspaceOfflinePanelProps): React.JSX.Element {
  return (
    <section className="workspace-status-panel" aria-label="Workspace status">
      <span>Local workspace ready</span>
      <span>File watcher active</span>
      <span>{dirty ? "Unsaved edits" : "Saved"}</span>
      {conflictPending && <span>Conflict pending</span>}
      <span>
        {proposalCount} agent proposal{proposalCount === 1 ? "" : "s"}
      </span>
      <span>Last saved {lastSavedLabel}</span>
    </section>
  );
}
