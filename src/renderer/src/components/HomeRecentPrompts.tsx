import HomeSection from "./HomeSection";

interface RecentPrompt {
  id: string;
  text: string;
  profile: string;
  timestamp: number;
}

interface HomeRecentPromptsProps {
  prompts: RecentPrompt[];
  onRecall: (prompt: RecentPrompt) => void;
  onRerun: (prompt: RecentPrompt) => void;
}

export default function HomeRecentPrompts({
  prompts,
  onRecall,
  onRerun,
}: HomeRecentPromptsProps): React.JSX.Element | null {
  if (prompts.length === 0) return null;

  return (
    <HomeSection title="Recent prompts">
      <div className="content-presets-row">
        {prompts.slice(0, 3).map((prompt) => (
          <div key={prompt.id} className="content-launcher-card-wrap">
            <button className="content-preset-card" onClick={() => onRecall(prompt)}>
              <span className="content-pinned-card-kicker">Recent prompt</span>
              <span className="content-pinned-card-title">{prompt.text.slice(0, 72)}</span>
              <span className="content-pinned-card-meta">
                {prompt.profile} · {new Date(prompt.timestamp).toLocaleString()}
              </span>
            </button>
            <div className="content-preset-actions">
              <button className="content-launcher-pin active" onClick={() => onRerun(prompt)}>
                Rerun
              </button>
            </div>
          </div>
        ))}
      </div>
    </HomeSection>
  );
}
