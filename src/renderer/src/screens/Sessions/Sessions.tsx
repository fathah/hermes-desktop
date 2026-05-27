import { useEffect, useState, useRef, useCallback, memo } from "react";
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
  onResumeSession: (sessionId: string) => void;
  onNewChat: () => void;
  currentSessionId: string | null;
  visible: boolean;
}

type SessionsContentView =
  | "loading"
  | "search-loading"
  | "search-empty"
  | "search-results"
  | "sessions-empty"
  | "sessions-list";

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

function getSessionsContentView(input: {
  loading: boolean;
  isShowingSearch: boolean;
  /** True while the current query has no settled results yet. */
  searchPending: boolean;
  searchResultCount: number;
  sessionCount: number;
}): SessionsContentView {
  if (input.loading) return "loading";

  if (input.isShowingSearch) {
    if (input.searchPending) return "search-loading";
    if (input.searchResultCount === 0) return "search-empty";
    return "search-results";
  }

  if (input.sessionCount === 0) return "sessions-empty";
  return "sessions-list";
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

function SessionsLoadingSpinner(): React.JSX.Element {
  return (
    <div className="sessions-loading">
      <div className="loading-spinner" />
    </div>
  );
}

function SessionsEmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.JSX.Element;
  title: string;
  hint: string;
}): React.JSX.Element {
  return (
    <div className="sessions-empty">
      {icon}
      <p className="sessions-empty-text">{title}</p>
      <p className="sessions-empty-hint">{hint}</p>
    </div>
  );
}

const SessionCard = memo(function SessionCard({
  session,
  isActive,
  showFullDate,
  onClick,
}: {
  session: CachedSession;
  isActive: boolean;
  showFullDate: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`sessions-card ${isActive ? "sessions-card--active" : ""}`}
      onClick={onClick}
    >
      <div className="sessions-card-main">
        <span className="sessions-card-title">
          {session.title || "New conversation"}
        </span>
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
      </div>
    </button>
  );
});

const SearchResultCard = memo(function SearchResultCard({
  result,
  isActive,
  onClick,
  titleFallback,
  messageLabel,
}: {
  result: SearchResult;
  isActive: boolean;
  onClick: () => void;
  titleFallback: string;
  messageLabel: (count: number) => string;
}) {
  return (
    <button
      className={`sessions-card ${isActive ? "sessions-card--active" : ""}`}
      onClick={onClick}
    >
      <div className="sessions-card-main">
        <span className="sessions-card-title">
          {result.title || titleFallback}
        </span>
        <span className="sessions-card-time">
          {formatFullDate(result.startedAt)}
        </span>
      </div>
      {result.snippet && (
        <div className="sessions-result-snippet">
          {highlightSnippet(result.snippet)}
        </div>
      )}
      <div className="sessions-card-tags">
        <span className="sessions-tag sessions-tag--source">
          {result.source}
        </span>
        <span className="sessions-tag">{messageLabel(result.messageCount)}</span>
        {result.model && (
          <span className="sessions-tag sessions-tag--model">
            {formatModel(result.model)}
          </span>
        )}
      </div>
    </button>
  );
});

function SearchResultsList({
  results,
  currentSessionId,
  onResumeSession,
  titleFallback,
  messageLabel,
}: {
  results: SearchResult[];
  currentSessionId: string | null;
  onResumeSession: (sessionId: string) => void;
  titleFallback: (sessionId: string) => string;
  messageLabel: (count: number) => string;
}): React.JSX.Element {
  return (
    <div className="sessions-list">
      {results.map((result) => (
        <SearchResultCard
          key={result.sessionId}
          result={result}
          isActive={currentSessionId === result.sessionId}
          titleFallback={titleFallback(result.sessionId)}
          messageLabel={messageLabel}
          onClick={() => onResumeSession(result.sessionId)}
        />
      ))}
    </div>
  );
}

function GroupedSessionsList({
  grouped,
  currentSessionId,
  onResumeSession,
  groupLabel,
}: {
  grouped: Array<{ label: DateGroup; sessions: CachedSession[] }>;
  currentSessionId: string | null;
  onResumeSession: (sessionId: string) => void;
  groupLabel: (label: DateGroup) => string;
}): React.JSX.Element {
  return (
    <div className="sessions-list">
      {grouped.map((group) => (
        <div key={group.label} className="sessions-group">
          <div className="sessions-group-label">{groupLabel(group.label)}</div>
          {group.sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              isActive={currentSessionId === session.id}
              showFullDate={
                group.label === "thisWeek" || group.label === "earlier"
              }
              onClick={() => onResumeSession(session.id)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

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
  /** Trimmed query that `searchResults` belongs to; null while pending. */
  const [settledQuery, setSettledQuery] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentQueryRef = useRef("");
  const searchRef = useRef<HTMLInputElement>(null);

  const handleSearchQueryChange = useCallback((value: string) => {
    currentQueryRef.current = value;
    setSearchQuery(value);
    if (!value.trim()) {
      setSettledQuery(null);
      setSearchResults([]);
      return;
    }
    // Invalidate immediately — don't wait for useEffect debounce.
    setSettledQuery(null);
    setSearchResults([]);
  }, []);

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
    currentQueryRef.current = searchQuery;
    if (!query) {
      setSettledQuery(null);
      setSearchResults([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      const results = await window.hermesAPI.searchSessions(query);
      if (currentQueryRef.current.trim() !== query) return;
      setSearchResults(results);
      setSettledQuery(query);
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchQuery]);

  const trimmedSearchQuery = searchQuery.trim();
  const isShowingSearch = trimmedSearchQuery.length > 0;
  const searchPending = isShowingSearch && settledQuery !== trimmedSearchQuery;
  const grouped = groupSessions(sessions);
  const contentView = getSessionsContentView({
    loading,
    isShowingSearch,
    searchPending,
    searchResultCount: searchResults.length,
    sessionCount: sessions.length,
  });

  const searchResultTitleFallback = useCallback(
    (sessionId: string) => `${t("sessions.title")} ${sessionId.slice(-6)}`,
    [t],
  );

  const searchResultMessageLabel = useCallback(
    (count: number) =>
      count !== 1
        ? `${count} ${t("sessions.messages")}`
        : `${count} ${t("sessions.messageSingular")}`,
    [t],
  );

  const renderContent = (): React.JSX.Element => {
    switch (contentView) {
      case "loading":
      case "search-loading":
        return <SessionsLoadingSpinner />;

      case "search-empty":
        return (
          <SessionsEmptyState
            icon={<Search size={32} className="sessions-empty-icon" />}
            title={t("sessions.noResults")}
            hint={t("sessions.noResultsHint")}
          />
        );

      case "search-results":
        return (
          <SearchResultsList
            results={searchResults}
            currentSessionId={currentSessionId}
            onResumeSession={onResumeSession}
            titleFallback={searchResultTitleFallback}
            messageLabel={searchResultMessageLabel}
          />
        );

      case "sessions-empty":
        return (
          <SessionsEmptyState
            icon={<ChatBubble size={32} className="sessions-empty-icon" />}
            title={t("sessions.empty")}
            hint={t("sessions.emptyHint")}
          />
        );

      case "sessions-list":
        return (
          <GroupedSessionsList
            grouped={grouped}
            currentSessionId={currentSessionId}
            onResumeSession={onResumeSession}
            groupLabel={(label) => t(`sessions.${label}`)}
          />
        );
    }
  };

  return (
    <div className="sessions-container">
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
            onChange={(e) => handleSearchQueryChange(e.target.value)}
          />
          {searchQuery && (
            <button
              className="btn-ghost sessions-searchbar-clear"
              onClick={() => {
                handleSearchQueryChange("");
                searchRef.current?.focus();
              }}
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {renderContent()}
    </div>
  );
}

export default Sessions;
