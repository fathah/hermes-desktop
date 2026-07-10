import HomeSection from "./HomeSection";

interface WorkflowPreset {
  id: string;
  label: string;
  presetId: string;
  promptText: string;
  profile: string;
  createdAt: number;
  startup: boolean;
}

interface HomeWorkflowCombosProps {
  workflows: WorkflowPreset[];
  onRunWorkflow: (workflow: WorkflowPreset) => void;
  onRenameWorkflow: (workflowId: string) => void;
  onDeleteWorkflow: (workflowId: string) => void;
  onSetStartupWorkflow: (workflowId: string | null) => void;
}

export default function HomeWorkflowCombos({
  workflows,
  onRunWorkflow,
  onRenameWorkflow,
  onDeleteWorkflow,
  onSetStartupWorkflow,
}: HomeWorkflowCombosProps): React.JSX.Element | null {
  if (workflows.length === 0) return null;

  return (
    <HomeSection title="Workflows">
      <div className="content-presets-row">
        {workflows.map((workflow) => (
          <div key={workflow.id} className="content-launcher-card-wrap">
            <button className="content-preset-card" onClick={() => onRunWorkflow(workflow)}>
              <span className="content-pinned-card-kicker">Workflow</span>
              <span className="content-pinned-card-title">{workflow.label}</span>
              <span className="content-pinned-card-meta">
                {workflow.profile} · {new Date(workflow.createdAt).toLocaleString()}
              </span>
            </button>
            <div className="content-preset-actions">
              <button className="content-launcher-pin active" onClick={() => onRunWorkflow(workflow)}>
                Run
              </button>
              <button className={`content-launcher-pin ${workflow.startup ? "active" : ""}`} onClick={() => onSetStartupWorkflow(workflow.startup ? null : workflow.id)}>
                {workflow.startup ? "Startup workflow" : "Set startup"}
              </button>
              <button className="content-launcher-pin" onClick={() => onRenameWorkflow(workflow.id)}>
                Rename
              </button>
              <button className="content-launcher-pin" onClick={() => onDeleteWorkflow(workflow.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </HomeSection>
  );
}
