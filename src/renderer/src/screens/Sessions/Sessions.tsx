import {
  useEffect,
  useState,
  useRef,
  useCallback,
  memo,
  type MouseEvent,
} from "react";
import {
  Archive,
  Pencil,
  Pin,
  Plus,
  Search,
  Tags,
  X,
  ChatBubble,
  Trash,
} from "../../assets/icons";
import { useI18n } from "../../components/useI18n";

interface CachedSession {
  id: string;
  title: string;
  startedAt: number;
  source: string;
  messageCount: number;
  model: string;
  tags?: string[];
  pinned?: boolean;
  archived?: boolean;
}

interface SearchResult {
  sessionId: string;
  title: string | null;
  startedAt: number;
  source: string;
  messageCount: number;
  model: string;
  snippet: string;
}

interface SessionsProps {
  onResumeSession: (sessionId: string) => void;
  onNewChat: () => void;
  currentSessionId: string | null;
  visible: boolean;
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatFullDate(ts: number): string {
  const d = new Date(ts * 1000);
  return (
    d.toLocaleDateString([], { month: "short", day: "numeric" }) +
    ", " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
}

type DateGroup = "pinned" | "today" | "yesterday" | "thisWeek" | "earlier";
type SessionView = "active" | "pinned" | "archived";

function getDateGroup(ts: number): DateGroup {
  const d = new Date(ts * 1000);
  const now = new Date();

  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) return "today";

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();
  if (isYesterday) return "yesterday";

  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  if (d >= weekAgo) return "thisWeek";

  return "earlier";
}

function groupSessions(
  sessions: CachedSession[],
): Array<{ label: DateGroup; sessions: CachedSession[] }> {
  const groups = new Map<DateGroup, CachedSession[]>();
  for (const s of sessions) {
    const group = s.pinned && !s.archived ? "pinned" : getDateGroup(s.startedAt);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(s);
  }
  const order: DateGroup[] = [
    "pinned",
    "today",
    "yesterday",
    "thisWeek",
    "earlier",
  ];
  return order
    .filter((label) => groups.has(label))
    .map((label) => ({ label, sessions: groups.get(label)! }));
}

function matchesSessionView(session: CachedSession, view: SessionView): boolean {
  if (view === "archived") return Boolean(session.archived);
  if (view === "pinned") return Boolean(session.pinned) && !session.archived;
  return !session.archived;
}

function matchesQuery(session: CachedSession, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    session.title,
    session.source,
    session.model,
    ...(session.tags || []),
  ].some((value) => value.toLowerCase().includes(q));
}

function parseTagsInput(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ).slice(0, 12);
}

function highlightSnippet(snippet: string): React.JSX.Element {
  const parts = snippet.split(/(<<.*?>>)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith("<<") && part.endsWith(">>")) {
          return <mark key={i}>{part.slice(2, -2)}</mark>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

function formatModel(model: string): string {
  const name = model.split("/").pop() || model;
  // Shorten common patterns: "gpt-oss-20b:free" → "gpt-oss-20b"
  return name.split(":")[0];
}

// Memoized session card
const SessionCard = memo(function SessionCard({
  session,
  isActive,
  showFullDate,
  onClick,
  onRename,
  onEditTags,
  onTogglePinned,
  onToggleArchived,
  onDelete,
  labels,
  deleteTitle,
}: {
  session: CachedSession;
  isActive: boolean;
  showFullDate: boolean;
  onClick: () => void;
  onRename?: (session: CachedSession) => void;
  onEditTags?: (session: CachedSession) => void;
  onTogglePinned?: (session: CachedSession) => void;
  onToggleArchived?: (session: CachedSession) => void;
  // When provided, renders a trash icon button on the card. Closes #408.
  onDelete?: (id: string) => void;
  labels?: {
    rename: string;
    tags: string;
    pin: string;
    unpin: string;
    archive: string;
    unarchive: string;
  };
  deleteTitle?: string;
}) {
  const stopAndRun = (
    event: MouseEvent<HTMLButtonElement>,
    action: () => void,
  ): void => {
    event.stopPropagation();
    action();
  };

  // `div` instead of `button` because nesting a button-inside-button is
  // invalid HTML and many a11y / interaction layers (focus trap, keyboard
  // navigation) break on it. Click + Enter/Space behavior matches the
  // previous semantics via explicit role + onKeyDown.
  return (
    <div
      role="button"
      tabIndex={0}
      className={`sessions-card ${isActive ? "sessions-card--active" : ""}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="sessions-card-main">
        <span className="sessions-card-title">
          {session.title || "New conversation"}
        </span>
        {session.pinned && (
          <span className="sessions-pin-badge" title={labels?.unpin || "Pinned"}>
            <Pin size={12} />
          </span>
        )}
        <span className="sessions-card-time">
          {showFullDate
            ? formatFullDate(session.startedAt)
            : formatTime(session.startedAt)}
        </span>
      </div>
      <div className="sessions-card-tags">
        <span className="sessions-tag sessions-tag--source">
          {session.source}
        </span>
        <span className="sessions-tag">
          {session.messageCount} msg{session.messageCount !== 1 ? "s" : ""}
        </span>
        {session.model && (
          <span className="sessions-tag sessions-tag--model">
            {formatModel(session.model)}
          </span>
        )}
        {(session.tags || []).map((tag) => (
          <span key={tag} className="sessions-tag sessions-tag--custom">
            #{tag}
          </span>
        ))}
        {labels && (
          <span className="sessions-card-actions">
            {onRename && (
              <button
                type="button"
                className="sessions-card-action"
                onClick={(e) => stopAndRun(e, () => onRename(session))}
                onKeyDown={(e) => e.stopPropagation()}
                title={labels.rename}
                aria-label={labels.rename}
              >
                <Pencil size={14} />
              </button>
            )}
            {onEditTags && (
              <button
                type="button"
                className="sessions-card-action"
                onClick={(e) => stopAndRun(e, () => onEditTags(session))}
                onKeyDown={(e) => e.stopPropagation()}
                title={labels.tags}
                aria-label={labels.tags}
              >
                <Tags size={14} />
              </button>
            )}
            {onTogglePinned && (
              <button
                type="button"
                className={`sessions-card-action ${session.pinned ? "sessions-card-action--active" : ""}`}
                onClick={(e) => stopAndRun(e, () => onTogglePinned(session))}
                onKeyDown={(e) => e.stopPropagation()}
                title={session.pinned ? labels.unpin : labels.pin}
                aria-label={session.pinned ? labels.unpin : labels.pin}
              >
                <Pin size={14} />
              </button>
            )}
            {onToggleArchived && (
              <button
                type="button"
                className={`sessions-card-action ${session.archived ? "sessions-card-action--active" : ""}`}
                onClick={(e) => stopAndRun(e, () => onToggleArchived(session))}
                onKeyDown={(e) => e.stopPropagation()}
                title={session.archived ? labels.unarchive : labels.archive}
                aria-label={session.archived ? labels.unarchive : labels.archive}
              >
                <Archive size={14} />
              </button>
            )}
          </span>
        )}
        {onDelete && (
          <button
            type="button"
            className="sessions-card-delete"
            onClick={(e) => {
              // Stop propagation so the parent card's onClick (which
              // resumes the session) doesn't also fire — clicking the
              // trash must NEVER take the user into the chat they're
              // trying to delete.
              e.stopPropagation();
              onDelete(session.id);
            }}
            // Block keyboard activation of the parent card-as-button too.
            onKeyDown={(e) => e.stopPropagation()}
            title={deleteTitle}
            aria-label={deleteTitle}
          >
            <Trash size={14} />
          </button>
        )}
      </div>
    </div>
  );
});

// How often the Sessions tab re-syncs from state.db while it is open, so
// sessions created in the background (cron jobs, gateway platforms, another
// device) surface without the user navigating away and back. (refs #322)
export const SESSIONS_REFRESH_MS = 30_000;
const SESSION_LIST_LIMIT = 200;

function Sessions({
  onResumeSession,
  onNewChat,
  currentSessionId,
  visible,
}: SessionsProps): React.JSX.Element {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<CachedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [sessionView, setSessionView] = useState<SessionView>("active");
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<
    string | null
  >(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(
    null,
  );
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const applyLocalSessionUpdate = useCallback(
    (sessionId: string, update: Partial<CachedSession>): void => {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId ? { ...session, ...update } : session,
        ),
      );
    },
    [],
  );

  // Quiet re-sync from state.db — refreshes the list WITHOUT flipping the
  // loading state, so it can run on a timer or on focus with no spinner flash.
  const refreshSessions = useCallback(async (): Promise<void> => {
    const synced = await window.hermesAPI.syncSessionCache();
    setSessions(synced);
  }, []);

  const loadSessions = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const cached = await window.hermesAPI.listCachedSessions(
        SESSION_LIST_LIMIT,
      );
      if (cached.length > 0) {
        setSessions(cached);
      }

      const synced = await window.hermesAPI.syncSessionCache();
      setSessions(synced);
    } catch (error) {
      console.error("Failed to load sessions", error);
    } finally {
      setLoading(false);
    }
    await refreshSessions();
    setLoading(false);
  }, [refreshSessions]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleDelete = useCallback((sessionId: string): void => {
    setPendingDeleteSessionId(sessionId);
  }, []);

  const cancelDelete = useCallback((): void => {
    if (deletingSessionId) return;
    setPendingDeleteSessionId(null);
  }, [deletingSessionId]);

  const confirmDelete = useCallback(
    async (sessionId: string): Promise<void> => {
      // Optimistic UI update: drop the row from both the main list and
      // any active search results so the user sees instant feedback even
      // if the SQLite write or cache rewrite has any latency.  The
      // subsequent refresh re-syncs from state.db so we recover if the
      // backend deletion failed.
      setDeletingSessionId(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setSearchResults((prev) =>
        prev.filter((r) => r.sessionId !== sessionId),
      );
      try {
        await window.hermesAPI.deleteSession(sessionId);
      } catch (err) {
        console.error("Failed to delete session", sessionId, err);
      } finally {
        await refreshSessions();
        setDeletingSessionId(null);
        setPendingDeleteSessionId(null);
      }
    },
    [refreshSessions],
  );

  const handleRename = useCallback(
    async (session: CachedSession): Promise<void> => {
      const nextTitle = window.prompt(
        t("sessions.renamePrompt"),
        session.title || "",
      );
      if (nextTitle === null) return;
      const trimmed = nextTitle.trim();
      if (!trimmed || trimmed === session.title) return;
      applyLocalSessionUpdate(session.id, { title: trimmed });
      await window.hermesAPI.updateSessionMetadata(session.id, {
        title: trimmed,
      });
      await refreshSessions();
    },
    [applyLocalSessionUpdate, refreshSessions, t],
  );

  const handleEditTags = useCallback(
    async (session: CachedSession): Promise<void> => {
      const nextTags = window.prompt(
        t("sessions.tagsPrompt"),
        (session.tags || []).join(", "),
      );
      if (nextTags === null) return;
      const tags = parseTagsInput(nextTags);
      applyLocalSessionUpdate(session.id, { tags });
      await window.hermesAPI.updateSessionMetadata(session.id, { tags });
      await refreshSessions();
    },
    [applyLocalSessionUpdate, refreshSessions, t],
  );

  const handleTogglePinned = useCallback(
    async (session: CachedSession): Promise<void> => {
      const pinned = !session.pinned;
      applyLocalSessionUpdate(session.id, { pinned });
      await window.hermesAPI.updateSessionMetadata(session.id, { pinned });
      await refreshSessions();
    },
    [applyLocalSessionUpdate, refreshSessions],
  );

  const handleToggleArchived = useCallback(
    async (session: CachedSession): Promise<void> => {
      const archived = !session.archived;
      applyLocalSessionUpdate(session.id, {
        archived,
        ...(archived ? { pinned: false } : {}),
      });
      await window.hermesAPI.updateSessionMetadata(session.id, { archived });
      await refreshSessions();
    },
    [applyLocalSessionUpdate, refreshSessions],
  );

  useEffect(() => {
    if (!pendingDeleteSessionId || deletingSessionId) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setPendingDeleteSessionId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deletingSessionId, pendingDeleteSessionId]);

  // Refresh sessions whenever the Sessions view becomes visible.
  // This ensures new sessions created in the Chat view (via "+")
  // appear immediately when the user navigates back to Sessions,
  // and also fixes stale sessions list after clearing search.
  useEffect(() => {
    if (visible) {
      loadSessions();
    }
  }, [visible, loadSessions]);

  // While the Sessions tab is actually showing, periodically re-sync so
  // sessions created in the background — cron jobs, gateway platforms, or
  // another device writing the same state.db — surface even if the user
  // just leaves this tab open. Also refresh when the window regains focus.
  // Gated on `visible`: no timer and no DB reads while another screen shows.
  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => {
      void refreshSessions();
    }, SESSIONS_REFRESH_MS);
    const onFocus = (): void => {
      void refreshSessions();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [visible, refreshSessions]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    searchTimer.current = setTimeout(async () => {
      const results = await window.hermesAPI.searchSessions(searchQuery);
      setSearchResults(results);
      setIsSearching(false);
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchQuery]);

  const isShowingSearch = searchQuery.trim().length > 0;
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const allVisibleSessions = sessions.filter((session) =>
    matchesSessionView(session, sessionView),
  );
  const visibleSessions = allVisibleSessions.slice(0, SESSION_LIST_LIMIT);
  const grouped = groupSessions(visibleSessions);
  const localSearchSessions = isShowingSearch
    ? allVisibleSessions
        .filter((session) => matchesQuery(session, searchQuery))
        .slice(0, SESSION_LIST_LIMIT)
    : [];
  const localSearchIds = new Set(
    localSearchSessions.map((session) => session.id),
  );
  const visibleSearchResults = searchResults.filter((result) => {
    const cached = sessionById.get(result.sessionId);
    if (cached && !matchesSessionView(cached, sessionView)) return false;
    if (!cached && sessionView !== "active") return false;
    return !localSearchIds.has(result.sessionId);
  });
  const hasSearchResults =
    localSearchSessions.length > 0 || visibleSearchResults.length > 0;
  const managementLabels = {
    rename: t("sessions.rename"),
    tags: t("sessions.editTags"),
    pin: t("sessions.pin"),
    unpin: t("sessions.unpin"),
    archive: t("sessions.archive"),
    unarchive: t("sessions.unarchive"),
  };

  return (
    <div className="sessions-container">
      {/* Header with integrated search */}
      <div className="sessions-header">
        <div className="sessions-header-top">
          <h2 className="sessions-title">{t("sessions.title")}</h2>
          <button className="btn btn-primary " onClick={onNewChat}>
            <Plus size={14} />
            {t("sessions.newChat")}
          </button>
        </div>
        <div className="sessions-searchbar">
          <Search size={14} className="sessions-searchbar-icon" />
          <input
            ref={searchRef}
            className="sessions-searchbar-input"
            type="text"
            placeholder={t("sessions.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="btn-ghost sessions-searchbar-clear"
              onClick={() => {
                setSearchQuery("");
                searchRef.current?.focus();
              }}
            >
              <X size={13} />
            </button>
          )}
        </div>
        <div className="sessions-view-tabs" role="tablist">
          {(["active", "pinned", "archived"] as const).map((view) => (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={sessionView === view}
              className={`sessions-view-tab ${sessionView === view ? "sessions-view-tab--active" : ""}`}
              onClick={() => setSessionView(view)}
            >
              {t(`sessions.view.${view}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="sessions-loading">
          <div className="loading-spinner" />
        </div>
      ) : isShowingSearch ? (
        isSearching ? (
          <div className="sessions-loading">
            <div className="loading-spinner" />
          </div>
        ) : !hasSearchResults ? (
          <div className="sessions-empty">
            <Search size={32} className="sessions-empty-icon" />
            <p className="sessions-empty-text">{t("sessions.noResults")}</p>
            <p className="sessions-empty-hint">{t("sessions.noResultsHint")}</p>
          </div>
        ) : (
          <div className="sessions-list">
            {localSearchSessions.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                isActive={currentSessionId === s.id}
                showFullDate={true}
                onClick={() => onResumeSession(s.id)}
                onRename={(session) => void handleRename(session)}
                onEditTags={(session) => void handleEditTags(session)}
                onTogglePinned={(session) => void handleTogglePinned(session)}
                onToggleArchived={(session) =>
                  void handleToggleArchived(session)
                }
                onDelete={handleDelete}
                labels={managementLabels}
                deleteTitle={t("sessions.delete")}
              />
            ))}
            {visibleSearchResults.map((r) => {
              const cached = sessionById.get(r.sessionId);
              return (
              <div
                key={r.sessionId}
                role="button"
                tabIndex={0}
                className={`sessions-card ${currentSessionId === r.sessionId ? "sessions-card--active" : ""}`}
                onClick={() => onResumeSession(r.sessionId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onResumeSession(r.sessionId);
                  }
                }}
              >
                <div className="sessions-card-main">
                  <span className="sessions-card-title">
                    {cached?.title ||
                      r.title ||
                      `${t("sessions.title")} ${r.sessionId.slice(-6)}`}
                  </span>
                  <span className="sessions-card-time">
                    {formatFullDate(r.startedAt)}
                  </span>
                </div>
                {r.snippet && (
                  <div className="sessions-result-snippet">
                    {highlightSnippet(r.snippet)}
                  </div>
                )}
                <div className="sessions-card-tags">
                  <span className="sessions-tag sessions-tag--source">
                    {r.source}
                  </span>
                  <span className="sessions-tag">
                    {r.messageCount}{" "}
                    {r.messageCount !== 1
                      ? t("sessions.messages")
                      : t("sessions.messageSingular")}
                  </span>
                  {r.model && (
                    <span className="sessions-tag sessions-tag--model">
                      {formatModel(r.model)}
                    </span>
                  )}
                  {cached?.tags?.map((tag) => (
                    <span key={tag} className="sessions-tag sessions-tag--custom">
                      #{tag}
                    </span>
                  ))}
                  <button
                    type="button"
                    className="sessions-card-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(r.sessionId);
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                    title={t("sessions.delete")}
                    aria-label={t("sessions.delete")}
                  >
                    <Trash size={14} />
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        )
      ) : allVisibleSessions.length === 0 ? (
        <div className="sessions-empty">
          <ChatBubble size={32} className="sessions-empty-icon" />
          <p className="sessions-empty-text">
            {sessionView === "archived"
              ? t("sessions.emptyArchived")
              : t("sessions.empty")}
          </p>
          <p className="sessions-empty-hint">
            {sessionView === "archived"
              ? t("sessions.emptyArchivedHint")
              : t("sessions.emptyHint")}
          </p>
        </div>
      ) : (
        <div className="sessions-list">
          {grouped.map((group) => (
            <div key={group.label} className="sessions-group">
              <div className="sessions-group-label">
                {t(`sessions.${group.label}`)}
              </div>
              {group.sessions.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  isActive={currentSessionId === s.id}
                  showFullDate={
                    group.label === "thisWeek" || group.label === "earlier"
                  }
                  onClick={() => onResumeSession(s.id)}
                  onRename={(session) => void handleRename(session)}
                  onEditTags={(session) => void handleEditTags(session)}
                  onTogglePinned={(session) => void handleTogglePinned(session)}
                  onToggleArchived={(session) =>
                    void handleToggleArchived(session)
                  }
                  onDelete={handleDelete}
                  labels={managementLabels}
                  deleteTitle={t("sessions.delete")}
                />
              ))}
            </div>
          ))}
        </div>
      )}
      {pendingDeleteSessionId && (
        <div
          className="sessions-confirm-overlay"
          onClick={cancelDelete}
          role="presentation"
        >
          <div
            className="sessions-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sessions-delete-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sessions-confirm-header">
              <h3 id="sessions-delete-confirm-title">
                {t("sessions.deleteConfirmTitle")}
              </h3>
              <button
                type="button"
                className="btn-ghost sessions-confirm-close"
                onClick={cancelDelete}
                disabled={!!deletingSessionId}
                aria-label={t("sessions.deleteClose")}
              >
                <X size={16} />
              </button>
            </div>
            <div className="sessions-confirm-body">
              <p>{t("sessions.deleteConfirm")}</p>
            </div>
            <div className="sessions-confirm-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={cancelDelete}
                disabled={!!deletingSessionId}
              >
                {t("sessions.deleteCancel")}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void confirmDelete(pendingDeleteSessionId)}
                disabled={!!deletingSessionId}
              >
                {deletingSessionId
                  ? t("sessions.deleteDeleting")
                  : t("sessions.deleteConfirmAction")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Sessions;
