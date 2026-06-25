import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  memo,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../components/useI18n";
import {
  ChevronDown,
  ChevronRight,
  Circle,
  Folder,
  Loader,
  MoreHorizontal,
  Pin,
  X,
} from "../../assets/icons";
import SidebarSessionMenu, {
  type SidebarMenuProject,
  type SidebarMenuTarget,
} from "./SidebarSessionMenu";

interface RecentSession {
  id: string;
  title: string;
  contextFolder?: string | null;
}

// ChatGPT-style paged conversation list under the pinned app navigation.
export const RECENT_SESSIONS_PAGE_SIZE = 30;

// Re-sync cadence while the list is visible. Deliberately slower than the
// Sessions screen (30s) — the sidebar is always on screen, so this interval
// runs for the whole app lifetime when the section is expanded.
const RECENT_REFRESH_MS = 60_000;

// Minimum gap between event-driven refreshes (focus, session switch) so a
// burst of focus/blur events doesn't hammer state.db.
const REFRESH_THROTTLE_MS = 5_000;
const INFINITE_SCROLL_THRESHOLD_PX = 180;
const PROJECTS_OPEN_KEY = "hermes.sidebar.projectsOpen";
const CHATS_OPEN_KEY = "hermes.sidebar.chatsOpen";
const FOLDERS_CLOSED_KEY = "hermes.sidebar.closedProjectFolders";
const PINNED_OPEN_KEY = "hermes.sidebar.pinnedOpen";
// Pinned session ids live in localStorage like the disclosure state — pinning
// is a desktop-only UI affordance, not part of the agent session schema.
const PINNED_IDS_KEY = "hermes.sidebar.pinnedSessions";

function readStoredPinned(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_IDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter(String) : []);
  } catch {
    return new Set();
  }
}

function storePinned(ids: Set<string>): void {
  try {
    localStorage.setItem(PINNED_IDS_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    /* ignore persistence failures */
  }
}

function readStoredOpen(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "false";
  } catch {
    return true;
  }
}

function readStoredClosedFolders(): Set<string> {
  try {
    const raw = localStorage.getItem(FOLDERS_CLOSED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter(String) : []);
  } catch {
    return new Set();
  }
}

function storeClosedFolders(paths: Set<string>): void {
  try {
    localStorage.setItem(FOLDERS_CLOSED_KEY, JSON.stringify(Array.from(paths)));
  } catch {
    /* ignore persistence failures */
  }
}

function sameSessions(a: RecentSession[], b: RecentSession[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].id !== b[i].id ||
      a[i].title !== b[i].title ||
      (a[i].contextFolder ?? null) !== (b[i].contextFolder ?? null)
    ) {
      return false;
    }
  }
  return true;
}

function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || path;
}

function groupSessionsByWorkspace(sessions: RecentSession[]): {
  projectGroups: Array<{
    path: string;
    name: string;
    sessions: RecentSession[];
  }>;
  chats: RecentSession[];
} {
  const projects = new Map<string, RecentSession[]>();
  const chats: RecentSession[] = [];

  for (const session of sessions) {
    const contextFolder = session.contextFolder?.trim();
    if (!contextFolder) {
      chats.push(session);
      continue;
    }
    const existing = projects.get(contextFolder);
    if (existing) existing.push(session);
    else projects.set(contextFolder, [session]);
  }

  return {
    projectGroups: Array.from(projects.entries()).map(([path, list]) => ({
      path,
      name: folderName(path),
      sessions: list,
    })),
    chats,
  };
}

/**
 * Recent-sessions list rendered under the "Sessions" nav item in the sidebar
 * (like ChatGPT's sidebar chat list). Owns its own data so Layout re-renders
 * (view switches, update banners, …) never trigger fetches, and `memo` keeps
 * it off the render hot path entirely.
 *
 * Fetch strategy, cheapest first:
 *  - on open: instant read from the sessions.json cache (no DB), then one
 *    sync against state.db to pick up sessions created since the last sync
 *  - while open: refresh on window focus and on a slow interval, throttled
 *  - closed (collapsed section or icon-only sidebar): zero work, renders null
 */
const SidebarRecentSessions = memo(function SidebarRecentSessions({
  open,
  activeProfile,
  currentSessionId,
  loadingSessionIds,
  resumingSessionId,
  onSelect,
  onSessionDeleted,
  scrollRootRef,
}: {
  open: boolean;
  /** Active profile — the list is per-profile, so switching forces a reload. */
  activeProfile: string;
  currentSessionId: string | null;
  /** Session ids of every run currently generating (multiple run at once). */
  loadingSessionIds: Set<string>;
  /** A session whose history is being fetched for resume (transient spinner). */
  resumingSessionId: string | null;
  onSelect: (sessionId: string) => void;
  /** Notifies Layout when a row is deleted so it can leave a stale active chat. */
  onSessionDeleted?: (sessionId: string) => void;
  /** Scroll container owned by Layout; nearing its bottom loads the next page. */
  scrollRootRef: RefObject<HTMLDivElement | null>;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<RecentSession[]>([]);
  // True when the profile has more cache rows than the sidebar has loaded.
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(() =>
    readStoredOpen(PROJECTS_OPEN_KEY),
  );
  const [chatsOpen, setChatsOpen] = useState(() =>
    readStoredOpen(CHATS_OPEN_KEY),
  );
  const [closedProjectFolders, setClosedProjectFolders] = useState<Set<string>>(
    () => readStoredClosedFolders(),
  );
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() =>
    readStoredPinned(),
  );
  const [pinnedOpen, setPinnedOpen] = useState(() =>
    readStoredOpen(PINNED_OPEN_KEY),
  );
  // Row whose context menu is open, anchored to viewport coordinates.
  const [menuTarget, setMenuTarget] = useState<SidebarMenuTarget | null>(null);
  // Inline rename: the row id being edited and its working title.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const editingIdRef = useRef<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  // Pending delete confirmation (small inline dialog in a portal-free overlay).
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const lastRefreshRef = useRef(0);
  const sessionsRef = useRef<RecentSession[]>([]);
  const hasMoreRef = useRef(false);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    editingIdRef.current = editingId;
  }, [editingId]);

  useEffect(() => {
    storePinned(pinnedIds);
  }, [pinnedIds]);

  const normalizeRows = useCallback(
    (
      list: Array<{
        id: string;
        title: string;
        contextFolder?: string | null;
      }>,
      limit = RECENT_SESSIONS_PAGE_SIZE,
    ): RecentSession[] =>
      list.slice(0, limit).map(({ id, title, contextFolder }) => ({
        id,
        title,
        contextFolder: contextFolder ?? null,
      })),
    [],
  );

  const applyFirstPage = useCallback(
    (
      list: Array<{
        id: string;
        title: string;
        contextFolder?: string | null;
      }>,
    ): void => {
      setHasMore(list.length > RECENT_SESSIONS_PAGE_SIZE);
      const next = normalizeRows(list);
      // Skip the state update (and re-render) when nothing changed — the
      // common case for periodic refreshes.
      setSessions((prev) => (sameSessions(prev, next) ? prev : next));
    },
    [normalizeRows],
  );

  const applyLoadedWindow = useCallback(
    (
      list: Array<{
        id: string;
        title: string;
        contextFolder?: string | null;
      }>,
    ): void => {
      const loadedLimit = Math.max(
        RECENT_SESSIONS_PAGE_SIZE,
        sessionsRef.current.length,
      );
      setHasMore(list.length > loadedLimit);
      const next = normalizeRows(list, loadedLimit);
      setSessions((prev) => (sameSessions(prev, next) ? prev : next));
    },
    [normalizeRows],
  );

  const appendPage = useCallback(
    (
      list: Array<{
        id: string;
        title: string;
        contextFolder?: string | null;
      }>,
    ): void => {
      setHasMore(list.length > RECENT_SESSIONS_PAGE_SIZE);
      const page = normalizeRows(list);
      if (page.length === 0) return;
      setSessions((prev) => {
        const seen = new Set(prev.map((s) => s.id));
        const next = [...prev];
        for (const session of page) {
          if (!seen.has(session.id)) next.push(session);
        }
        return sameSessions(prev, next) ? prev : next;
      });
    },
    [normalizeRows],
  );

  const refresh = useCallback(
    async (force = false): Promise<void> => {
      const now = Date.now();
      if (!force && now - lastRefreshRef.current < REFRESH_THROTTLE_MS) return;
      lastRefreshRef.current = now;
      try {
        const synced = await window.hermesAPI.syncSessionCache();
        applyLoadedWindow(synced);
      } catch {
        // keep whatever we had — the list is best-effort UI sugar
      }
    },
    [applyLoadedWindow],
  );

  const loadNextPage = useCallback(async (): Promise<void> => {
    if (!open || !hasMoreRef.current || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const nextPage = await window.hermesAPI.listCachedSessions(
        RECENT_SESSIONS_PAGE_SIZE + 1,
        sessionsRef.current.length,
      );
      appendPage(nextPage);
    } catch {
      // keep the current list; scrolling can retry on the next event
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [appendPage, open]);

  const maybeLoadNextPage = useCallback((): void => {
    const root = scrollRootRef.current;
    if (!projectsOpen && !chatsOpen) return;
    if (!root || !hasMoreRef.current || loadingMoreRef.current) return;
    const remaining = root.scrollHeight - root.scrollTop - root.clientHeight;
    if (remaining <= INFINITE_SCROLL_THRESHOLD_PX) void loadNextPage();
  }, [chatsOpen, loadNextPage, projectsOpen, scrollRootRef]);

  // Initial load when the section opens: paint from the JSON cache
  // immediately (no DB access), then sync once for anything new.
  // Sequenced so sync always wins over cache (avoids race where stale
  // cache overwrites fresh sync if sync resolves first).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const cached = await window.hermesAPI.listCachedSessions(
          // One over the page size so the cache read alone can decide whether
          // another page exists without a separate count query.
          RECENT_SESSIONS_PAGE_SIZE + 1,
        );
        if (!cancelled) applyFirstPage(cached);
      } catch {
        /* ignore cache read errors */
      }
      lastRefreshRef.current = Date.now();
      try {
        const synced = await window.hermesAPI.syncSessionCache();
        if (!cancelled) applyFirstPage(synced);
      } catch {
        // cache read above already painted something
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, activeProfile, applyFirstPage]);

  // While open: pick up background sessions (gateway, cron, other devices)
  // on focus and on a slow timer. No listeners or timers at all when closed.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => void refresh(), RECENT_REFRESH_MS);
    const onFocus = (): void => {
      void refresh();
    };
    const onContextFolderChanged = (): void => {
      void refresh(true);
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener(
      "hermes-session-context-folder-changed",
      onContextFolderChanged,
    );
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(
        "hermes-session-context-folder-changed",
        onContextFolderChanged,
      );
    };
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const root = scrollRootRef.current;
    if (!root) return;
    const onScroll = (): void => {
      maybeLoadNextPage();
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    maybeLoadNextPage();
    return () => {
      root.removeEventListener("scroll", onScroll);
    };
  }, [maybeLoadNextPage, open, scrollRootRef]);

  // If the first page does not fill the sidebar, keep paging until the scroll
  // container has real overflow or the cache runs out.
  useEffect(() => {
    if (open) maybeLoadNextPage();
  }, [hasMore, maybeLoadNextPage, open, sessions.length]);

  // Resuming/switching sessions reorders recency — refresh (throttled).
  // Also refreshes when going to "New Chat" (currentSessionId becomes null)
  // so the just-left session appears in the list immediately.
  useEffect(() => {
    if (open) void refresh();
  }, [open, currentSessionId, refresh]);

  // Switching agent points the list at a different profile's DB. Force a
  // reload immediately (bypassing the throttle) so the list isn't stale.
  const prevProfileRef = useRef(activeProfile);
  useEffect(() => {
    if (prevProfileRef.current === activeProfile) return;
    prevProfileRef.current = activeProfile;
    void refresh(true);
  }, [activeProfile, refresh]);

  // Keep the wrapper mounted so the collapse/expand animates with CSS grid
  // tracks. Effects above are still gated on `open`, so a collapsed sidebar
  // does no fetching while keeping the last-loaded list ready to animate.
  const expanded = open;

  // Pinned rows are pulled out of the normal grouping and shown in their own
  // section at the top (ChatGPT-style), preserving recency order.
  const pinnedSessions = useMemo(
    () => sessions.filter((s) => pinnedIds.has(s.id)),
    [sessions, pinnedIds],
  );
  const { projectGroups, chats } = useMemo(
    () =>
      groupSessionsByWorkspace(sessions.filter((s) => !pinnedIds.has(s.id))),
    [sessions, pinnedIds],
  );

  // Every distinct project folder currently in use, so "Move to project" lists
  // them all — even ones whose only conversation is pinned or filtered out.
  const projectChoices = useMemo<SidebarMenuProject[]>(() => {
    const byPath = new Map<string, SidebarMenuProject>();
    for (const s of sessions) {
      const folder = s.contextFolder?.trim();
      if (folder && !byPath.has(folder)) {
        byPath.set(folder, { path: folder, name: folderName(folder) });
      }
    }
    return Array.from(byPath.values());
  }, [sessions]);

  const togglePinned = (): void => {
    setPinnedOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PINNED_OPEN_KEY, String(next));
      } catch {
        /* ignore persistence failures */
      }
      return next;
    });
  };

  const handleTogglePin = useCallback((id: string): void => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const startRename = useCallback((s: RecentSession): void => {
    setEditingId(s.id);
    setEditingTitle(s.title || "");
    setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
  }, []);

  const cancelRename = useCallback((): void => {
    setEditingId(null);
    setEditingTitle("");
  }, []);

  const confirmRename = useCallback(
    async (id: string, value: string): Promise<void> => {
      const trimmed = value.trim();
      const current = sessionsRef.current.find((s) => s.id === id);
      if (!trimmed || trimmed === (current?.title ?? "")) {
        cancelRename();
        return;
      }
      const previous = current?.title ?? "";
      // Optimistic local update; roll back if the write fails.
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, title: trimmed } : s)),
      );
      if (editingIdRef.current === id) cancelRename();
      try {
        await window.hermesAPI.updateSessionTitle(id, trimmed);
      } catch (err) {
        console.error("Failed to rename session", id, err);
        setSessions((prev) =>
          prev.map((s) => (s.id === id ? { ...s, title: previous } : s)),
        );
      }
    },
    [cancelRename],
  );

  const handleMoveToProject = useCallback(
    async (id: string, folder: string | null): Promise<void> => {
      const normalized = folder?.trim() || null;
      const current = sessionsRef.current.find((s) => s.id === id);
      if ((current?.contextFolder ?? null) === normalized) return;
      const previous = current?.contextFolder ?? null;
      setSessions((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, contextFolder: normalized } : s,
        ),
      );
      try {
        await window.hermesAPI.setSessionContextFolder(id, normalized);
        // Other surfaces (chat view, Sessions screen) listen for this to
        // refresh their own grouping.
        window.dispatchEvent(
          new CustomEvent("hermes-session-context-folder-changed"),
        );
      } catch (err) {
        console.error("Failed to move session to project", id, err);
        setSessions((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, contextFolder: previous } : s,
          ),
        );
      }
    },
    [],
  );

  const handlePickNewFolder = useCallback(
    async (id: string): Promise<void> => {
      try {
        const folder = await window.hermesAPI.selectFolder();
        if (folder) await handleMoveToProject(id, folder);
      } catch (err) {
        console.error("Folder selection failed", err);
      }
    },
    [handleMoveToProject],
  );

  const confirmDelete = useCallback(
    async (id: string): Promise<void> => {
      setDeleting(true);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      setPinnedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      try {
        await window.hermesAPI.deleteSession(id);
        onSessionDeleted?.(id);
      } catch (err) {
        console.error("Failed to delete session", id, err);
      } finally {
        setDeleting(false);
        setPendingDeleteId(null);
        void refresh(true);
      }
    },
    [onSessionDeleted, refresh],
  );

  const openMenuForSession = useCallback(
    (s: RecentSession, x: number, y: number): void => {
      setMenuTarget({
        id: s.id,
        title: s.title,
        contextFolder: s.contextFolder ?? null,
        x,
        y,
      });
    },
    [],
  );

  const toggleProjects = (): void => {
    setProjectsOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PROJECTS_OPEN_KEY, String(next));
      } catch {
        /* ignore persistence failures */
      }
      return next;
    });
  };

  const toggleChats = (): void => {
    setChatsOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(CHATS_OPEN_KEY, String(next));
      } catch {
        /* ignore persistence failures */
      }
      return next;
    });
  };

  const toggleProjectFolder = (path: string): void => {
    setClosedProjectFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      storeClosedFolders(next);
      return next;
    });
  };

  const renderSessionButton = (
    s: RecentSession,
    project = false,
    visible = expanded,
    pinned = false,
  ): React.JSX.Element => {
    const title = s.title || t("sessions.newConversation");
    const loading = resumingSessionId === s.id || loadingSessionIds.has(s.id);
    const active = !loading && currentSessionId === s.id;
    const editing = editingId === s.id;
    const menuOpen = menuTarget?.id === s.id;

    if (editing) {
      return (
        <div
          key={s.id}
          className={`sidebar-recent-session ${
            project ? "project-child" : ""
          } editing`}
        >
          <input
            ref={renameInputRef}
            className="sidebar-recent-session-rename"
            type="text"
            value={editingTitle}
            onChange={(e) => setEditingTitle(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                void confirmRename(s.id, editingTitle);
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelRename();
              }
            }}
            onBlur={() => void confirmRename(s.id, editingTitle)}
            tabIndex={visible ? 0 : -1}
          />
        </div>
      );
    }

    // `div role=button` (not <button>) so the trailing "options" control can be
    // a real nested button without invalid button-in-button markup.
    return (
      <div
        key={s.id}
        role="button"
        tabIndex={visible ? 0 : -1}
        className={`sidebar-recent-session ${project ? "project-child" : ""} ${
          active ? "active" : ""
        } ${menuOpen ? "menu-open" : ""}`}
        onClick={() => onSelect(s.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(s.id);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenuForSession(s, e.clientX, e.clientY);
        }}
        title={title}
      >
        {loading ? (
          <Loader
            className="sidebar-recent-session-dot sidebar-recent-session-dot--loading"
            size={11}
          />
        ) : pinned ? (
          <Pin className="sidebar-recent-session-dot" size={11} />
        ) : (
          <Circle
            className={`sidebar-recent-session-dot ${
              active ? "sidebar-recent-session-dot--active" : ""
            }`}
            size={7}
            fill={active ? "currentColor" : "none"}
          />
        )}
        <span className="sidebar-recent-session-title">{title}</span>
        <button
          type="button"
          className="sidebar-recent-session-options"
          tabIndex={visible ? 0 : -1}
          aria-label={t("navigation.sessionMenu.options")}
          title={t("navigation.sessionMenu.options")}
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            openMenuForSession(s, rect.right, rect.bottom + 4);
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <MoreHorizontal size={15} />
        </button>
      </div>
    );
  };

  return (
    <div
      className={`sidebar-recent-sessions-wrap ${expanded ? "expanded" : ""}`}
      aria-hidden={!expanded}
    >
      <div className="sidebar-recent-sessions">
        {pinnedSessions.length > 0 && (
          <div className="sidebar-recent-section">
            <button
              type="button"
              className="sidebar-recent-section-toggle"
              onClick={togglePinned}
              aria-expanded={pinnedOpen}
              tabIndex={expanded ? 0 : -1}
            >
              <span>{t("navigation.pinned")}</span>
              {pinnedOpen ? (
                <ChevronDown
                  className="sidebar-recent-disclosure-icon"
                  size={13}
                />
              ) : (
                <ChevronRight
                  className="sidebar-recent-disclosure-icon"
                  size={13}
                />
              )}
            </button>
            <div
              className={`sidebar-recent-collapse ${
                pinnedOpen ? "expanded" : ""
              }`}
            >
              <div className="sidebar-recent-collapse-inner">
                {pinnedSessions.map((s) =>
                  renderSessionButton(s, false, expanded && pinnedOpen, true),
                )}
              </div>
            </div>
          </div>
        )}
        {projectGroups.length > 0 && (
          <div className="sidebar-recent-section">
            <button
              type="button"
              className="sidebar-recent-section-toggle"
              onClick={toggleProjects}
              aria-expanded={projectsOpen}
              tabIndex={expanded ? 0 : -1}
            >
              <span>{t("navigation.projects")}</span>
              {projectsOpen ? (
                <ChevronDown
                  className="sidebar-recent-disclosure-icon"
                  size={13}
                />
              ) : (
                <ChevronRight
                  className="sidebar-recent-disclosure-icon"
                  size={13}
                />
              )}
            </button>
            <div
              className={`sidebar-recent-collapse ${
                projectsOpen ? "expanded" : ""
              }`}
            >
              <div className="sidebar-recent-collapse-inner">
                {projectGroups.map((group) => {
                  const projectOpen = !closedProjectFolders.has(group.path);
                  const visible = expanded && projectsOpen && projectOpen;
                  return (
                    <div className="sidebar-recent-project" key={group.path}>
                      <button
                        type="button"
                        className="sidebar-recent-project-heading"
                        title={group.path}
                        onClick={() => toggleProjectFolder(group.path)}
                        aria-expanded={projectOpen}
                        tabIndex={expanded && projectsOpen ? 0 : -1}
                      >
                        <Folder size={13} />
                        <span>{group.name}</span>
                        {projectOpen ? (
                          <ChevronDown
                            className="sidebar-recent-disclosure-icon"
                            size={12}
                          />
                        ) : (
                          <ChevronRight
                            className="sidebar-recent-disclosure-icon"
                            size={12}
                          />
                        )}
                      </button>
                      <div
                        className={`sidebar-recent-collapse ${
                          projectOpen ? "expanded" : ""
                        }`}
                      >
                        <div className="sidebar-recent-collapse-inner">
                          {group.sessions.map((s) =>
                            renderSessionButton(s, true, visible),
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        <div className="sidebar-recent-section">
          <button
            type="button"
            className="sidebar-recent-section-toggle"
            onClick={toggleChats}
            aria-expanded={chatsOpen}
            tabIndex={expanded ? 0 : -1}
          >
            <span>{t("navigation.chats")}</span>
            {chatsOpen ? (
              <ChevronDown
                className="sidebar-recent-disclosure-icon"
                size={13}
              />
            ) : (
              <ChevronRight
                className="sidebar-recent-disclosure-icon"
                size={13}
              />
            )}
          </button>
          <div
            className={`sidebar-recent-collapse ${chatsOpen ? "expanded" : ""}`}
          >
            <div className="sidebar-recent-collapse-inner">
              {chats.length > 0 ? (
                chats.map((s) =>
                  renderSessionButton(s, false, expanded && chatsOpen),
                )
              ) : (
                <div className="sidebar-recent-empty">
                  {t("navigation.noChats")}
                </div>
              )}
            </div>
          </div>
        </div>
        {loadingMore && (
          <div className="sidebar-recent-loading" aria-live="polite">
            <Loader
              className="sidebar-recent-session-dot sidebar-recent-session-dot--loading"
              size={11}
            />
            <span>{t("common.loadingShort")}</span>
          </div>
        )}
      </div>
      {expanded && menuTarget && (
        <SidebarSessionMenu
          target={menuTarget}
          isPinned={pinnedIds.has(menuTarget.id)}
          projects={projectChoices}
          scrollContainer={scrollRootRef.current}
          onClose={() => setMenuTarget(null)}
          onTogglePin={() => handleTogglePin(menuTarget.id)}
          onRename={() => {
            const s = sessions.find((row) => row.id === menuTarget.id);
            if (s) startRename(s);
          }}
          onMoveToProject={(path) =>
            void handleMoveToProject(menuTarget.id, path)
          }
          onPickNewFolder={() => void handlePickNewFolder(menuTarget.id)}
          onDelete={() => setPendingDeleteId(menuTarget.id)}
        />
      )}
      {pendingDeleteId &&
        createPortal(
          <div
            className="sidebar-session-delete-overlay"
            role="presentation"
            onClick={() => {
              if (!deleting) setPendingDeleteId(null);
            }}
          >
            <div
              className="sidebar-session-delete-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="sidebar-session-delete-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sidebar-session-delete-header">
                <h3 id="sidebar-session-delete-title">
                  {t("navigation.sessionMenu.deleteConfirmTitle")}
                </h3>
                <button
                  type="button"
                  className="btn-ghost sidebar-session-delete-close"
                  onClick={() => setPendingDeleteId(null)}
                  disabled={deleting}
                  aria-label={t("navigation.sessionMenu.deleteCancel")}
                >
                  <X size={16} />
                </button>
              </div>
              <p className="sidebar-session-delete-body">
                {t("navigation.sessionMenu.deleteConfirm")}
              </p>
              <div className="sidebar-session-delete-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setPendingDeleteId(null)}
                  disabled={deleting}
                >
                  {t("navigation.sessionMenu.deleteCancel")}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void confirmDelete(pendingDeleteId)}
                  disabled={deleting}
                >
                  {deleting
                    ? t("navigation.sessionMenu.deleting")
                    : t("navigation.sessionMenu.deleteConfirmAction")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
});

export default SidebarRecentSessions;
