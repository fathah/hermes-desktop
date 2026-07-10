import HomeSection from "./HomeSection";

interface LastSessionSnapshot {
  id: string;
  title: string;
  profile: string;
  startedAt: number;
}

interface HomeResumeProps {
  lastSession: LastSessionSnapshot | null;
  onResume: (sessionId: string) => void | Promise<void>;
}

export default function HomeResume({ lastSession, onResume }: HomeResumeProps): React.JSX.Element | null {
  if (!lastSession) return null;

  return (
    <HomeSection title="Resume">
      <div className="content-resume-card-wrap">
        <button className="content-preset-card" onClick={() => void onResume(lastSession.id)}>
          <span className="content-pinned-card-kicker">Resume where you left off</span>
          <span className="content-pinned-card-title">{lastSession.title}</span>
          <span className="content-pinned-card-meta">
            {lastSession.profile} · {new Date(lastSession.startedAt * 1000).toLocaleString()}
          </span>
        </button>
      </div>
    </HomeSection>
  );
}
