import { useEffect, useState, useRef, useCallback, memo } from "react";
import {
  Plus,
  Search,
  X,
  ChatBubble,
  Trash,
  Pencil,
  Check,
} from "../../assets/icons";
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

// Inline editor for a session title. Rendered in place of the title text
// while a session is being renamed. Shared by both the grouped list card and
// the search-result card so the rename interaction stays identical in both.
function SessionTitleEditor({
  value,
  onChange,
  onConfirm,
  onCancel,
  placeholder,
  saveLabel,
  cancelLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  placeholder?: string;
  saveLabel?: string;
  cancelLabel?: string;
}): React.JSX.Element {
  return (
    <div className="sessions-card-rename">
      <input
        type="text"
        className="sessions-card-rename-input"
        value={value}
        placeholder={placeholder}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Keep keystrokes from bubbling to the card-as-button, which would
          // otherwise resume the session on Enter/Space.
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            onConfirm();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <button
        type="button"
        className="sessions-card-rename-save"
        onClick={(e) => {
          e.stopPropagation();
          onConfirm();
        }}
        onKeyDown={(e) => e.stopPropagation()}
        title={saveLabel}
        aria-label={saveLabel}
      >
        <Check size={14} />
      </button>
      <button
        type="button"
        className="sessions-card-rename-cancel"
        onClick={(e) => {
          e.stopPropagation();
          onCancel();
        }}
        onKeyDown={(e) => e.stopPropagation()}
        title={cancelLabel}
        aria-label={cancelLabel}
      >
        <X size={14} />
      </button>
    </div>
  );
}

// Memoized session card
const SessionCard = memo(function SessionCard({
  session,
  isActive,
  showFullDate,
  onClick,
  onDelete,
  deleteTitle,
  isEditing,
  renameValue,
  onStartRename,
  onChangeRename,
  onConfirmRename,
  onCancelRename,
  renameTitle,
  renameSave,
  renameCancel,
  renamePlaceholder,
}: {
  session: CachedSession;
  isActive: boolean;
  showFullDate: boolean;
  onClick: () => void;
  // When provided, renders a trash icon button on the card. Closes #408.
  onDelete?: (id: string) => void;
  deleteTitle?: string;
  // When provided, renders a pencil icon button that starts inline rename.
  isEditing?: boolean;
  renameValue?: string;
  onStartRename?: (id: string, currentTitle: string) => void;
  onChangeRename?: (value: string) => void;
  onConfirmRename?: (id: string) => void;
  onCancelRename?: () => void;
  renameTitle?: string;
  renameSave?: string;
  renameCancel?: string;
  renamePlaceholder?: string;
}) {
  const canRename =
    !!onStartRename &&
    !!onChangeRename &&
    !!onConfirmRename &&
    !!onCancelRename;
  // `div` instead of `button` because nesting a button-inside-button is
  // invalid HTML and many a11y / interaction layers (focus trap, keyboard
  // navigation) break on it. Click + Enter/Space behavior matches the
  // previous semantics via explicit role + onKeyDown.
  return (
    <div
      role="button"
      tabIndex={0}
      className={`sessions-card ${isActive ? "sessions-card--active" : ""}`}
      onClick={() => {
        // While renaming, the card must not navigate into the session.
        if (!isEditing) onClick();
      }}
      onKeyDown={(e) => {
        if (isEditing) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="sessions-card-main">
        {isEditing && canRename ? (
          <SessionTitleEditor
            value={renameValue ?? ""}
            onChange={onChangeRename!}
            onConfirm={() => onConfirmRename!(session.id)}
            onCancel={onCancelRename!}
            placeholder={renamePlaceholder}
            saveLabel={renameSave}
            cancelLabel={renameCancel}
          />
        ) : (
          <span className="sessions-card-title">
            {session.title || "New conversation"}
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
        {!isEditing && canRename && (
          <button
            type="button"
            className="sessions-card-action"
            onClick={(e) => {
              // Stop propagation so the parent card's onClick (which resumes
              // the session) doesn't also fire — starting a rename must not
              // open the conversation.
              e.stopPropagation();
              onStartRename!(session.id, session.title || "");
            }}
            onKeyDown={(e) => e.stopPropagation()}
            title={renameTitle}
            aria-label={renameTitle}
          >
            <Pencil size={14} />
          </button>
        )}
        {!isEditing && onDelete && (
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
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<
    string | null
  >(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(
    null,
  );
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // Refs mirror the rename state so the rename callbacks can stay referentially
  // stable (deps: only refreshSessions). Without this, every keystroke would
  // recreate the callbacks and re-render every memoized SessionCard.
  const renameValueRef = useRef("");
  const renameOriginalRef = useRef("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestId = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // Quiet re-sync from state.db — refreshes the list WITHOUT flipping the
  // loading state, so it can run on a timer or on focus with no spinner flash.
  const refreshSessions = useCallback(async (): Promise<void> => {
    const synced = await window.hermesAPI.syncSessionCache();
    setSessions(synced.slice(0, 50));
  }, []);

  const loadSessions = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const cached = await window.hermesAPI.listCachedSessions(50);
      if (cached.length > 0) {
        setSessions(cached);
      }

      const synced = await window.hermesAPI.syncSessionCache();
      setSessions(synced.slice(0, 50));
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
      setSearchResults((prev) => prev.filter((r) => r.sessionId !== sessionId));
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

  const startRename = useCallback(
    (sessionId: string, currentTitle: string): void => {
      renameValueRef.current = currentTitle;
      renameOriginalRef.current = currentTitle;
      setRenameValue(currentTitle);
      setEditingSessionId(sessionId);
    },
    [],
  );

  const changeRename = useCallback((value: string): void => {
    renameValueRef.current = value;
    setRenameValue(value);
  }, []);

  const cancelRename = useCallback((): void => {
    renameValueRef.current = "";
    setRenameValue("");
    setEditingSessionId(null);
  }, []);

  const confirmRename = useCallback(
    async (sessionId: string): Promise<void> => {
      const title = renameValueRef.current.trim();
      const original = renameOriginalRef.current.trim();
      // Close the editor regardless; an empty or unchanged title is a no-op
      // so we never persist a blank name or fire a redundant IPC call.
      setEditingSessionId(null);
      setRenameValue("");
      renameValueRef.current = "";
      if (!title || title === original) return;
      // Optimistic update so the new title shows instantly in both the list
      // and any active search results, mirroring confirmDelete. The follow-up
      // refresh re-syncs from the DB so we recover if the write failed.
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title } : s)),
      );
      setSearchResults((prev) =>
        prev.map((r) => (r.sessionId === sessionId ? { ...r, title } : r)),
      );
      try {
        await window.hermesAPI.updateSessionTitle(sessionId, title);
      } catch (err) {
        console.error("Failed to rename session", sessionId, err);
      } finally {
        await refreshSessions();
      }
    },
    [refreshSessions],
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
    const query = searchQuery.trim();
    if (!query) {
      searchRequestId.current += 1;
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    const requestId = searchRequestId.current + 1;
    searchRequestId.current = requestId;
    setIsSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const results = await window.hermesAPI.searchSessions(query);
        if (searchRequestId.current !== requestId) return;
        setSearchResults(results);
      } finally {
        if (searchRequestId.current === requestId) {
          setIsSearching(false);
        }
      }
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
            {searchResults.map((r, index) => {
              const isEditingResult = editingSessionId === r.sessionId;
              return (
                <div
                  key={`${r.sessionId}-${index}`}
                  role="button"
                  tabIndex={0}
                  className={`sessions-card ${currentSessionId === r.sessionId ? "sessions-card--active" : ""}`}
                  onClick={() => {
                    // While renaming, the card must not navigate into the
                    // session.
                    if (!isEditingResult) onResumeSession(r.sessionId);
                  }}
                  onKeyDown={(e) => {
                    if (isEditingResult) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onResumeSession(r.sessionId);
                    }
                  }}
                >
                  <div className="sessions-card-main">
                    {isEditingResult ? (
                      <SessionTitleEditor
                        value={renameValue}
                        onChange={changeRename}
                        onConfirm={() => confirmRename(r.sessionId)}
                        onCancel={cancelRename}
                        placeholder={t("sessions.renamePlaceholder")}
                        saveLabel={t("sessions.renameSave")}
                        cancelLabel={t("sessions.renameCancel")}
                      />
                    ) : (
                      <span className="sessions-card-title">
                        {r.title ||
                          `${t("sessions.title")} ${r.sessionId.slice(-6)}`}
                      </span>
                    )}
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
                    {!isEditingResult && (
                      <button
                        type="button"
                        className="sessions-card-action"
                        onClick={(e) => {
                          e.stopPropagation();
                          startRename(r.sessionId, r.title || "");
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                        title={t("sessions.rename")}
                        aria-label={t("sessions.rename")}
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    {!isEditingResult && (
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
                    )}
                  </div>
                </div>
              );
            })}
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
                  onClick={() => onResumeSession(s.id)}
                  onDelete={handleDelete}
                  deleteTitle={t("sessions.delete")}
                  isEditing={editingSessionId === s.id}
                  renameValue={editingSessionId === s.id ? renameValue : ""}
                  onStartRename={startRename}
                  onChangeRename={changeRename}
                  onConfirmRename={confirmRename}
                  onCancelRename={cancelRename}
                  renameTitle={t("sessions.rename")}
                  renameSave={t("sessions.renameSave")}
                  renameCancel={t("sessions.renameCancel")}
                  renamePlaceholder={t("sessions.renamePlaceholder")}
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
