import { useEffect, useState, useRef, useCallback, memo } from "react";
import { Trash2, Check, X as XIcon, Pencil } from "lucide-react";
import { Plus, Search, X, ChatBubble } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";

interface CachedSession {
  id: string;
  title: string;
  startedAt: number;
  source: string;
  messageCount: number;
  model: string;
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
  onResumeSession: (sessionId: string, title?: string) => void;
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

type DateGroup = "today" | "yesterday" | "thisWeek" | "earlier";

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
    const group = getDateGroup(s.startedAt);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(s);
  }
  const order: DateGroup[] = ["today", "yesterday", "thisWeek", "earlier"];
  return order
    .filter((label) => groups.has(label))
    .map((label) => ({ label, sessions: groups.get(label)! }));
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

// Memoized session card with hover-reveal delete + inline confirmation + inline rename
const SessionCard = memo(function SessionCard({
  session,
  isActive,
  showFullDate,
  onClick,
  onDelete,
  onRename,
}: {
  session: CachedSession;
  isActive: boolean;
  showFullDate: boolean;
  onClick: () => void;
  onDelete: (sessionId: string) => void;
  onRename: (sessionId: string, newTitle: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Focus input when rename mode activates
  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  function handleTrashClick(e: React.MouseEvent): void {
    e.stopPropagation();
    setConfirming(true);
  }

  function handleConfirm(e: React.MouseEvent): void {
    e.stopPropagation();
    onDelete(session.id);
  }

  function handleCancel(e: React.MouseEvent): void {
    e.stopPropagation();
    setConfirming(false);
  }

  function handlePencilClick(e: React.MouseEvent): void {
    e.stopPropagation();
    setRenameValue(session.title || "");
    setRenaming(true);
  }

  function commitRename(): void {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== session.title) {
      onRename(session.id, trimmed);
    }
    setRenaming(false);
  }

  function handleRenameKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
    if (e.key === "Escape") { e.preventDefault(); setRenaming(false); }
  }

  const blocked = confirming || renaming;

  return (
    <div
      className={`sessions-card ${isActive ? "sessions-card--active" : ""} ${renaming ? "sessions-card--renaming" : ""}`}
      onClick={blocked ? undefined : onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (!blocked && (e.key === "Enter" || e.key === " ")) onClick();
      }}
    >
      <div className="sessions-card-main">
        {renaming ? (
          <input
            ref={renameInputRef}
            className="sessions-card-rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="sessions-card-title">
            {session.title || "New conversation"}
            <span className="sessions-card-id">#{session.id.slice(-6)}</span>
          </span>
        )}
        {!renaming && (
          <span className="sessions-card-time">
            {showFullDate
              ? formatFullDate(session.startedAt)
              : formatTime(session.startedAt)}
          </span>
        )}
      </div>
      {!renaming && (
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
        </div>
      )}
      {/* Action controls — pencil + trash on hover, confirm when deleting */}
      {!renaming && (
        <div className="sessions-card-actions">
          {confirming ? (
            <div className="sessions-card-confirm">
              <span className="sessions-card-confirm-label">Delete?</span>
              <button
                className="sessions-card-confirm-btn sessions-card-confirm-yes"
                onClick={handleConfirm}
                title="Confirm delete"
              >
                <Check size={13} />
              </button>
              <button
                className="sessions-card-confirm-btn sessions-card-confirm-no"
                onClick={handleCancel}
                title="Cancel"
              >
                <XIcon size={13} />
              </button>
            </div>
          ) : (
            <div className="sessions-card-icon-group">
              <button
                className="sessions-card-action-btn"
                onClick={handlePencilClick}
                title="Rename session"
              >
                <Pencil size={13} />
              </button>
              <button
                className="sessions-card-delete-btn"
                onClick={handleTrashClick}
                title="Delete session"
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// How often the Sessions tab re-syncs from state.db while it is open, so
// sessions created in the background (cron jobs, gateway platforms, another
// device) surface without the user navigating away and back. (refs #322)
export const SESSIONS_REFRESH_MS = 30_000;

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
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Quiet re-sync from state.db — refreshes the list WITHOUT flipping the
  // loading state, so it can run on a timer or on focus with no spinner flash.
  const refreshSessions = useCallback(async (): Promise<void> => {
    const synced = await window.hermesAPI.syncSessionCache();
    setSessions(synced.slice(0, 50));
  }, []);

  const loadSessions = useCallback(async (): Promise<void> => {
    setLoading(true);
    const cached = await window.hermesAPI.listCachedSessions(50);
    if (cached.length > 0) {
      setSessions(cached);
      setLoading(false);
    }
    await refreshSessions();
    setLoading(false);
  }, [refreshSessions]);

  const handleDeleteSession = useCallback(async (sessionId: string): Promise<void> => {
    // Optimistically remove from local list first
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    try {
      await window.hermesAPI.deleteSession(sessionId);
    } catch {
      // If deletion fails, reload to restore accurate list
      loadSessions();
    }
  }, [loadSessions]);

  const handleRenameSession = useCallback(async (sessionId: string, newTitle: string): Promise<void> => {
    // Optimistically update title in local list
    setSessions((prev) =>
      prev.map((s) => s.id === sessionId ? { ...s, title: newTitle } : s),
    );
    try {
      await window.hermesAPI.updateSessionTitle(sessionId, newTitle);
    } catch {
      // If save fails, reload to restore accurate list
      loadSessions();
    }
  }, [loadSessions]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

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
  const grouped = groupSessions(sessions);

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
        ) : searchResults.length === 0 ? (
          <div className="sessions-empty">
            <Search size={32} className="sessions-empty-icon" />
            <p className="sessions-empty-text">{t("sessions.noResults")}</p>
            <p className="sessions-empty-hint">{t("sessions.noResultsHint")}</p>
          </div>
        ) : (
          <div className="sessions-list">
            {searchResults.map((r) => (
              <button
                key={r.sessionId}
                className={`sessions-card ${currentSessionId === r.sessionId ? "sessions-card--active" : ""}`}
                onClick={() => onResumeSession(r.sessionId, r.title ?? undefined)}
              >
                <div className="sessions-card-main">
                  <span className="sessions-card-title">
                    {r.title || t("sessions.title")}
                    <span className="sessions-card-id">#{r.sessionId.slice(-6)}</span>
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
                </div>
              </button>
            ))}
          </div>
        )
      ) : sessions.length === 0 ? (
        <div className="sessions-empty">
          <ChatBubble size={32} className="sessions-empty-icon" />
          <p className="sessions-empty-text">{t("sessions.empty")}</p>
          <p className="sessions-empty-hint">{t("sessions.emptyHint")}</p>
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
                  onClick={() => onResumeSession(s.id, s.title)}
                  onDelete={handleDeleteSession}
                  onRename={handleRenameSession}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Sessions;
