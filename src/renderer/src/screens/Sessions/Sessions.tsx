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

function getGroupLabel(label: DateGroup, t: (key: string) => string): string {
  const labels: Record<DateGroup, string> = {
    today: t("sessions.today"),
    yesterday: t("sessions.yesterday"),
    thisWeek: t("sessions.thisWeek"),
    earlier: t("sessions.earlier"),
  };
  return labels[label];
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

function Sessions({
  onResumeSession,
  onNewChat,
  currentSessionId,
}: SessionsProps): React.JSX.Element {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<CachedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadSessions = useCallback(async (): Promise<void> => {
    setLoading(true);
    const cached = await window.hermesAPI.listCachedSessions(50);
    if (cached.length > 0) {
      setSessions(cached);
      setLoading(false);
    }
    const synced = await window.hermesAPI.syncSessionCache();
    setSessions(synced.slice(0, 50));
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

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
            {t("chat.newConversation")}
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
                onClick={() => onResumeSession(r.sessionId)}
              >
                <div className="sessions-card-main">
                  <span className="sessions-card-title">
                    {r.title || `Session ${r.sessionId.slice(-6)}`}
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
                    {r.messageCount} msg{r.messageCount !== 1 ? "s" : ""}
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
          <p className="sessions-empty-hint">
            Start a chat to create your first session
          </p>
        </div>
      ) : (
        <div className="sessions-list">
          {grouped.map((group) => (
            <div key={group.label} className="sessions-group">
              <div className="sessions-group-label">{getGroupLabel(group.label, t)}</div>
              {group.sessions.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  isActive={currentSessionId === s.id}
                  showFullDate={
                    group.label === "thisWeek" || group.label === "earlier"
                  }
                  onClick={() => onResumeSession(s.id)}
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
