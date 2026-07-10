import HomeSection from "./HomeSection";

interface LauncherCard {
  key: string;
  label: string;
  description: string;
  onClick: () => void;
}

interface PinnedSession {
  id: string;
  title: string;
}

interface RecentShellSession {
  id: string;
  title: string;
  startedAt: number;
}

interface HomeLaunchersProps {
  pinnedCards: LauncherCard[];
  launcherCards: LauncherCard[];
  pinnedActionIds: string[];
  pinnedSessions: PinnedSession[];
  recentSessions: RecentShellSession[];
  onTogglePinnedAction: (actionId: string) => void;
  onResumeRecentSession: (sessionId: string) => void | Promise<void>;
  onTogglePinnedSession: (session: PinnedSession) => void;
}

function actionIdForCard(cardKey: string): string {
  if (cardKey === "new-chat") return "action:new-chat";
  if (cardKey === "resume-sessions") return "action:search-sessions";
  return "action:snap-window";
}

export default function HomeLaunchers({
  pinnedCards,
  launcherCards,
  pinnedActionIds,
  pinnedSessions,
  recentSessions,
  onTogglePinnedAction,
  onResumeRecentSession,
  onTogglePinnedSession,
}: HomeLaunchersProps): React.JSX.Element | null {
  if (pinnedCards.length === 0 && pinnedSessions.length === 0 && launcherCards.length === 0 && recentSessions.length === 0) {
    return null;
  }

  return (
    <HomeSection title="Launchers">
      {pinnedCards.length > 0 && (
        <div className="content-pinned-row">
          {pinnedCards.map((card) => (
            <button key={card.key} className="content-pinned-card" onClick={card.onClick}>
              <span className="content-pinned-card-kicker">Pinned</span>
              <span className="content-pinned-card-title">{card.label}</span>
              <span className="content-pinned-card-meta">{card.description}</span>
            </button>
          ))}
        </div>
      )}

      {pinnedSessions.length > 0 && (
        <div className="content-pinned-row">
          {pinnedSessions.map((session) => (
            <button
              key={session.id}
              className="content-pinned-card"
              onClick={() => void onResumeRecentSession(session.id)}
            >
              <span className="content-pinned-card-kicker">Pinned session</span>
              <span className="content-pinned-card-title">{session.title}</span>
              <span className="content-pinned-card-meta">One-click resume</span>
            </button>
          ))}
        </div>
      )}

      {launcherCards.length > 0 && (
        <div className="content-launcher-row">
          {launcherCards.map((card) => {
            const actionId = actionIdForCard(card.key);
            const pinned = pinnedActionIds.includes(actionId);
            return (
              <div key={card.key} className="content-launcher-card-wrap">
                <button className="content-launcher-card" onClick={card.onClick}>
                  <span className="content-launcher-card-label">{card.label}</span>
                  <span className="content-launcher-card-description">{card.description}</span>
                </button>
                <button
                  className={`content-launcher-pin ${pinned ? "active" : ""}`}
                  onClick={() => onTogglePinnedAction(actionId)}
                >
                  {pinned ? "Unpin" : "Pin"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {recentSessions.length > 0 && (
        <div className="content-recents-row">
          {recentSessions.map((session) => {
            const pinned = pinnedSessions.some((item) => item.id === session.id);
            return (
              <div key={session.id} className="content-launcher-card-wrap">
                <button className="content-recent-card" onClick={() => void onResumeRecentSession(session.id)}>
                  <span className="content-recent-card-kicker">Recent session</span>
                  <span className="content-recent-card-title">{session.title}</span>
                  <span className="content-recent-card-meta">
                    {new Date(session.startedAt * 1000).toLocaleDateString()} · Resume
                  </span>
                </button>
                <button
                  className={`content-launcher-pin ${pinned ? "active" : ""}`}
                  onClick={() => onTogglePinnedSession({ id: session.id, title: session.title })}
                >
                  {pinned ? "Unpin" : "Pin"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </HomeSection>
  );
}
