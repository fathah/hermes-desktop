// SidebarRecents.tsx — recent AI chat sessions, from the Hermes session store
// (list-sessions). Clicking a row opens the AI Chats surface on that session.
// Renders nothing extra when hermesAPI is absent (demo/standalone preview).
import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { useStore } from "../store";

interface SessionRow {
  id: string;
  title: string | null;
  preview: string;
}

export function SidebarRecents() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const setSurface = useStore((s) => s.setSurface);
  const setActiveChatSession = useStore((s) => s.setActiveChatSession);

  useEffect(() => {
    let cancelled = false;
    const api = window.hermesAPI;
    if (!api?.listSessions) return;
    api
      .listSessions(8, 0)
      .then((rows) => {
        if (!cancelled) setSessions(rows.slice(0, 8));
      })
      .catch(() => {
        /* offline / no gateway — leave empty */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openSession = (id: string): void => {
    setActiveChatSession(id);
    setSurface("chats");
  };

  if (sessions.length === 0) {
    return (
      <div className="nav-item nav-empty">
        <Icon name="clock" size={17} />
        <span className="nav-label">No recent chats</span>
      </div>
    );
  }

  return (
    <>
      {sessions.map((s) => {
        const label = s.title || s.preview || "Untitled chat";
        return (
          <div
            key={s.id}
            className="nav-item"
            onClick={() => openSession(s.id)}
            title={label}
          >
            <Icon name="comment" size={17} />
            <span className="nav-label">{label}</span>
          </div>
        );
      })}
    </>
  );
}
