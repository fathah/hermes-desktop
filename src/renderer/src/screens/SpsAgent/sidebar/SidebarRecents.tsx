// SidebarRecents.tsx — recent AI chat sessions, from the Hermes session store
// (list-sessions). Clicking a row opens the AI Chats surface on that session;
// right-click (or the hover ⋯) renames or deletes it via the Hermes session API.
// Renders nothing extra when hermesAPI is absent (demo/standalone preview).
import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import type { SessionRow } from "../types";

export function SidebarRecents() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  const setSurface = useStore((s) => s.setSurface);
  const setActiveChatSession = useStore((s) => s.setActiveChatSession);
  const activeChatSession = useStore((s) => s.activeChatSession);
  const startNewChat = useStore((s) => s.startNewChat);

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

  const labelFor = (s: SessionRow): string =>
    s.title || s.preview || "Untitled chat";

  const openSession = (id: string): void => {
    setActiveChatSession(id);
    setSurface("chats");
  };

  const openMenu = (e: React.MouseEvent, id: string): void => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ id, x: e.clientX, y: e.clientY });
  };

  const renameSession = async (id: string): Promise<void> => {
    setMenu(null);
    const api = window.hermesAPI;
    if (!api?.updateSessionTitle) return;
    const row = sessions.find((s) => s.id === id);
    const current = row?.title ?? row?.preview ?? "";
    const next = prompt("Rename chat", current);
    if (next == null) return;
    const title = next.trim();
    if (!title) return;
    try {
      await api.updateSessionTitle(id, title);
      setSessions((rows) =>
        rows.map((s) => (s.id === id ? { ...s, title } : s)),
      );
    } catch {
      /* gateway offline — leave the list unchanged */
    }
  };

  const removeSession = async (id: string): Promise<void> => {
    setMenu(null);
    const api = window.hermesAPI;
    if (!api?.deleteSession) return;
    try {
      await api.deleteSession(id);
      setSessions((rows) => rows.filter((s) => s.id !== id));
      // Don't strand the surface on a chat that no longer exists.
      if (activeChatSession === id) startNewChat();
    } catch {
      /* gateway offline — leave the list unchanged */
    }
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
        const label = labelFor(s);
        return (
          <div
            key={s.id}
            className="nav-item"
            onClick={() => openSession(s.id)}
            onContextMenu={(e) => openMenu(e, s.id)}
            title={label}
          >
            <Icon name="comment" size={17} />
            <span className="nav-label">{label}</span>
            <span
              className="nav-add"
              title="More"
              onClick={(e) => openMenu(e, s.id)}
            >
              <Icon name="dots" size={14} />
            </span>
          </div>
        );
      })}
      {menu && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 63 }}
            onMouseDown={() => setMenu(null)}
          />
          <div
            className="menu"
            style={{ left: menu.x, top: menu.y, zIndex: 64, minWidth: 180 }}
          >
            <div
              className="menu-mini"
              onClick={() => void renameSession(menu.id)}
            >
              <Icon name="text" size={15} /> Rename
            </div>
            <div className="menu-divider"></div>
            <div
              className="menu-mini danger"
              onClick={() => void removeSession(menu.id)}
            >
              <Icon name="trash" size={15} /> Delete
            </div>
          </div>
        </>
      )}
    </>
  );
}
