import HomeSection from "./HomeSection";

interface WorkflowPreset {
  id: string;
  label: string;
  presetId: string;
  promptText: string;
  profile: string;
  createdAt: number;
}

interface HomeWorkflowCombosProps {
  workflows: WorkflowPreset[];
  onRunWorkflow: (workflow: WorkflowPreset) => void;
  onDeleteWorkflow: (workflowId: string) => void;
}

export default function HomeWorkflowCombos({
  workflows,
  onRunWorkflow,
  onDeleteWorkflow,
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
