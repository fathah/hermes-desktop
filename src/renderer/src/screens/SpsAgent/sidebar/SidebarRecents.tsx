// SidebarRecents.tsx — recent AI chat sessions, from the Hermes session store
// (list-sessions). A search box filters across ALL sessions (search-sessions),
// not just the recent 8 — this is the in-workspace replacement for the deleted
// admin Sessions screen. Clicking a row opens the AI Chats surface on that
// session; right-click (or the hover ⋯) renames or deletes it via the Hermes
// session API. Renders nothing extra when hermesAPI is absent (demo/standalone).
import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { InlineRename } from "../components/InlineRename";
import { useStore } from "../store";
import type { SessionRow } from "../types";

const RECENTS_LIMIT = 8;
const SEARCH_LIMIT = 25;
const SEARCH_DEBOUNCE_MS = 250;

// A search-sessions hit (subset of the preload shape) reduced to what the row
// list needs. `searchSessions` keys the id as `sessionId` and carries a match
// `snippet`; the recents list speaks the lighter `SessionRow` shape.
interface SessionSearchHit {
  sessionId: string;
  title: string | null;
  snippet: string;
}

/** Map a session-search hit onto the display-only recents row shape. */
export function searchHitToRow(hit: SessionSearchHit): SessionRow {
  return { id: hit.sessionId, title: hit.title, preview: hit.snippet };
}

export function SidebarRecents() {
  const [recents, setRecents] = useState<SessionRow[]>([]);
  const [query, setQuery] = useState("");
  // null = not searching (show recents); array = current search results.
  const [results, setResults] = useState<SessionRow[] | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  const setSurface = useStore((s) => s.setSurface);
  const setActiveChatSession = useStore((s) => s.setActiveChatSession);
  const activeChatSession = useStore((s) => s.activeChatSession);
  const startNewChat = useStore((s) => s.startNewChat);

  // Load the recent sessions once (the default, no-query view).
  useEffect(() => {
    let cancelled = false;
    const api = window.hermesAPI;
    if (!api?.listSessions) return;
    api
      .listSessions(RECENTS_LIMIT, 0)
      .then((rows) => {
        if (!cancelled) setRecents(rows.slice(0, RECENTS_LIMIT));
      })
      .catch(() => {
        /* offline / no gateway — leave empty */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced full-history search. Empty query drops back to the recents view.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const api = window.hermesAPI;
    if (!api?.searchSessions) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .searchSessions(q, SEARCH_LIMIT)
        .then((hits) => {
          if (!cancelled) setResults(hits.map(searchHitToRow));
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const searching = query.trim().length > 0;
  const display = searching ? (results ?? []) : recents;

  const labelFor = (s: SessionRow): string =>
    s.title || s.preview || "Untitled chat";

  const openSession = (id: string, title: string): void => {
    setActiveChatSession(id, title);
    setSurface("chats");
  };

  const openMenu = (e: React.MouseEvent, id: string): void => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ id, x: e.clientX, y: e.clientY });
  };

  const startRename = (id: string): void => {
    setMenu(null);
    setRenamingId(id);
  };

  // Renames/deletes can target a row from either the recents or the search
  // results, so apply the change to both lists to keep them consistent.
  const patchTitle = (id: string, title: string): void => {
    const apply = (rows: SessionRow[]): SessionRow[] =>
      rows.map((s) => (s.id === id ? { ...s, title } : s));
    setRecents(apply);
    setResults((r) => (r ? apply(r) : r));
  };

  const dropRow = (id: string): void => {
    const drop = (rows: SessionRow[]): SessionRow[] =>
      rows.filter((s) => s.id !== id);
    setRecents(drop);
    setResults((r) => (r ? drop(r) : r));
  };

  const commitRename = async (id: string, title: string): Promise<void> => {
    setRenamingId(null);
    const api = window.hermesAPI;
    if (!api?.updateSessionTitle) return;
    try {
      await api.updateSessionTitle(id, title);
      patchTitle(id, title);
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
      dropRow(id);
      // Don't strand the surface on a chat that no longer exists.
      if (activeChatSession === id) startNewChat();
    } catch {
      /* gateway offline — leave the list unchanged */
    }
  };

  // Nothing to show and nothing to search — keep the original empty hint.
  const showSearch = recents.length > 0 || searching;

  return (
    <>
      {showSearch && (
        <div className="nav-item nav-recents-search">
          <Icon name="search" size={15} />
          <input
            type="text"
            className="nav-recents-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats…"
            aria-label="Search chats"
            style={{
              flex: 1,
              minWidth: 0,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "inherit",
              font: "inherit",
              padding: 0,
            }}
          />
          {searching && (
            <button
              type="button"
              className="nav-add"
              title="Clear search"
              aria-label="Clear search"
              onClick={() => setQuery("")}
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
      )}

      {display.length === 0 ? (
        <div className="nav-item nav-empty">
          <Icon name={searching ? "search" : "clock"} size={17} />
          <span className="nav-label">
            {searching ? "No matching chats" : "No recent chats"}
          </span>
        </div>
      ) : (
        display.map((s) => {
          const label = labelFor(s);
          return (
            <div
              key={s.id}
              className="nav-item"
              onContextMenu={(e) => openMenu(e, s.id)}
              title={label}
            >
              {renamingId === s.id ? (
                <>
                  <Icon name="comment" size={17} />
                  <InlineRename
                    initial={label}
                    onSubmit={(v) => void commitRename(s.id, v)}
                    onCancel={() => setRenamingId(null)}
                  />
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="nav-item-main"
                    onClick={() => openSession(s.id, label)}
                  >
                    <Icon name="comment" size={17} />
                    <span className="nav-label">{label}</span>
                  </button>
                  <button
                    type="button"
                    className="nav-add"
                    title="More"
                    aria-label="More actions"
                    onClick={(e) => {
                      e.stopPropagation();
                      openMenu(e, s.id);
                    }}
                  >
                    <Icon name="dots" size={14} />
                  </button>
                </>
              )}
            </div>
          );
        })
      )}

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
            <div className="menu-mini" onClick={() => startRename(menu.id)}>
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
