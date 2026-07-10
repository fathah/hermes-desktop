import HomeSection from "./HomeSection";

interface LastSessionSnapshot {
  id: string;
  title: string;
  profile: string;
  startedAt: number;
}

interface WorkflowRecall {
  id: string;
  label: string;
  profile: string;
  promptText: string;
  startup: boolean;
  ranAt: number;
}

interface HomeResumeProps {
  lastSession: LastSessionSnapshot | null;
  lastWorkflow: WorkflowRecall | null;
  onResumeSession: (sessionId: string) => void | Promise<void>;
  onResumeWorkflow: (workflowId: string) => void;
}

export default function HomeResume({
  lastSession,
  lastWorkflow,
  onResumeSession,
  onResumeWorkflow,
}: HomeResumeProps): React.JSX.Element | null {
  if (!lastSession && !lastWorkflow) return null;

  return (
    <HomeSection title="Resume">
      <div className="content-resume-card-wrap">
        {lastSession && (
          <button className="content-preset-card" onClick={() => void onResumeSession(lastSession.id)}>
            <span className="content-pinned-card-kicker">Resume where you left off</span>
            <span className="content-pinned-card-title">{lastSession.title}</span>
            <span className="content-pinned-card-meta">
              {lastSession.profile} · {new Date(lastSession.startedAt * 1000).toLocaleString()}
            </span>
          </button>
        )}
        {lastWorkflow && (
          <button className="content-preset-card" onClick={() => onResumeWorkflow(lastWorkflow.id)}>
            <span className="content-pinned-card-kicker">
              {lastWorkflow.startup ? "Resume startup workflow" : "Resume last workflow"}
            </span>
            <span className="content-pinned-card-title">{lastWorkflow.label}</span>
            <span className="content-pinned-card-meta">
              {lastWorkflow.profile} · {new Date(lastWorkflow.ranAt).toLocaleString()}
            </span>
          </button>
        )}
      </div>
    </HomeSection>
  );
}
