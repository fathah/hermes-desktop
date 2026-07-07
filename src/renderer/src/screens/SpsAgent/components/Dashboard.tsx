import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { useStore } from "../store";
import { uid } from "../lib/ids";

const SCRATCHPAD_PAGE_ID = "dashboard_scratchpad";
const RECENT_LIMIT = 5;

const SCHEDULE_EVENTS = [
  {
    time: "09:00 AM",
    title: "Inbox Ingestion & Capture Review",
    desc: "Process captured links, notes, and PDF extracts with My Assistant.",
    icon: "inbox" as const,
  },
  {
    time: "11:30 AM",
    title: "Deep Work: EU AI Act Risk Assessment",
    desc: "Review compliance checklist blocks and align risk metrics.",
    icon: "board" as const,
  },
  {
    time: "02:00 PM",
    title: "Weekly Goals Sync & Focus Session",
    desc: "Refactor OKRs, check progress, and clear blocker tasks.",
    icon: "sparkle" as const,
  },
  {
    time: "04:30 PM",
    title: "AI Co-Author Document Refactoring",
    desc: "Summarize notes and run AI cleanups on active scratchpads.",
    icon: "wand" as const,
  },
];

const MARKET_INDEXES = [
  { name: "S&P 500", val: "5,431.60", change: "+0.47%", positive: true },
  { name: "NASDAQ", val: "17,732.60", change: "+0.82%", positive: true },
  { name: "DOW JONES", val: "39,012.20", change: "-0.15%", positive: false },
  { name: "BITCOIN", val: "$67,420", change: "+2.11%", positive: true },
];

const NEWS_ARTICLES = [
  {
    category: "Tech",
    title: "AI Alignment Audits Gain Traction in Local-First Frameworks",
    time: "12m ago",
  },
  {
    category: "Productivity",
    title: "Why Evernote's Borderless Re-design Split the Community",
    time: "1h ago",
  },
  {
    category: "Business",
    title: "Open-Access Academic Repositories Shift toward Markdown Formats",
    time: "3h ago",
  },
];

const WEATHER_INFO = {
  temp: "72°F",
  condition: "Partially Cloudy",
  location: "San Francisco, CA",
  humidity: "64%",
  wind: "12 mph",
};

const SPORTS_GAME = {
  teams: "Warriors vs Celtics",
  status: "Final Score",
  score: "112 - 108",
  winner: "Warriors",
};

export function Dashboard() {
  const meta = useStore((s) => s.meta);
  const selectPage = useStore((s) => s.selectPage);
  const setSurface = useStore((s) => s.setSurface);
  const setPageDoc = useStore((s) => s.setPageDoc);
  const setTemplatesOpen = useStore((s) => s.setTemplatesOpen);
  const setOpenTask = useStore((s) => s.setOpenTask);

  // Scratchpad logic
  const scratchpadDoc = useStore((s) => s.docs[SCRATCHPAD_PAGE_ID]);
  const [scratchText, setScratchText] = useState("");
  const [isEditingScratchpad, setIsEditingScratchpad] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showWeatherModal, setShowWeatherModal] = useState(false);
  const [showMarketsModal, setShowMarketsModal] = useState(false);
  const [showNewsModal, setShowNewsModal] = useState(false);
  const [showSportsModal, setShowSportsModal] = useState(false);

  // Hydrate local text when scratchpadDoc is loaded from store
  useEffect(() => {
    if (scratchpadDoc && scratchpadDoc[0]) {
      setScratchText(scratchpadDoc[0].text || "");
    } else {
      // Seed scratchpad block in store if not present
      setPageDoc(SCRATCHPAD_PAGE_ID, [{ id: "sp-1", type: "p", text: "" }]);
    }
  }, [scratchpadDoc, setPageDoc]);

  const handleScratchChange = (val: string) => {
    setScratchText(val);
    // 1. Sync store state (so auto-saves or other tabs see it)
    setPageDoc(SCRATCHPAD_PAGE_ID, [{ id: "sp-1", type: "p", text: val }]);
    // 2. Direct-mirror write to vault/dashboard_scratchpad.md
    if (window.hermesAPI?.spsExportPage) {
      window.hermesAPI.spsExportPage(SCRATCHPAD_PAGE_ID, val).catch((err) => {
        console.error("Failed to mirror scratchpad to disk:", err);
      });
    }
  };

  // Recently visited tracking
  const [recents, setRecents] = useState<string[]>([]);
  useEffect(() => {
    try {
      const stored = localStorage.getItem("sps-recent-visited-pages");
      if (stored) {
        const ids = JSON.parse(stored) as string[];
        // Validate existence in current meta
        const valid = ids.filter(
          (id) => id in meta && id !== SCRATCHPAD_PAGE_ID,
        );
        setRecents(valid.slice(0, RECENT_LIMIT));
      }
    } catch {
      setRecents([]);
    }
  }, [meta]);

  // Pinned pages logic (pinned state in localStorage to avoid modifying domain meta schema)
  const [pinned, setPinned] = useState<string[]>([]);
  useEffect(() => {
    try {
      const stored = localStorage.getItem("sps-pinned-pages");
      if (stored) {
        const ids = JSON.parse(stored) as string[];
        const valid = ids.filter((id) => id in meta);
        setPinned(valid);
      } else {
        // Seed first 2 pages in workspace if none pinned
        const keys = Object.keys(meta)
          .filter((k) => k !== SCRATCHPAD_PAGE_ID && k !== "home")
          .slice(0, 2);
        setPinned(keys);
        localStorage.setItem("sps-pinned-pages", JSON.stringify(keys));
      }
    } catch {
      setPinned([]);
    }
  }, [meta]);

  const togglePin = (pageId: string) => {
    let next: string[];
    if (pinned.includes(pageId)) {
      next = pinned.filter((id) => id !== pageId);
    } else {
      next = [...pinned, pageId];
    }
    setPinned(next);
    localStorage.setItem("sps-pinned-pages", JSON.stringify(next));
  };

  const jumpToPage = (pageId: string) => {
    selectPage(pageId);
    setSurface("doc");
  };

  // Quick action buttons creation handlers
  const handleNewNote = () => {
    setTemplatesOpen({ parent: null });
  };

  const handleNewTask = () => {
    const homeBlocks = useStore.getState().docs.home || [];
    const dbIndex = homeBlocks.findIndex((b) => b.type === "database");
    if (dbIndex !== -1) {
      const dbBlock = homeBlocks[dbIndex];
      const newTaskId = uid("t");
      const newTaskRow = {
        id: newTaskId,
        title: "New Task",
        status: "todo" as const,
        prio: "med" as const,
        who: "you",
        due: "",
        est: "",
      };

      const nextBlocks = [...homeBlocks];
      nextBlocks[dbIndex] = {
        ...dbBlock,
        rows: [...(dbBlock.rows || []), newTaskRow],
      };

      useStore.getState().setPageDoc("home", nextBlocks);
      setOpenTask(newTaskRow);
      useStore.getState().flash("Task created on Wiki Home");
    } else {
      useStore
        .getState()
        .flash("No task database found on Wiki Home", { tone: "warn" });
    }
  };

  const handleNewGoal = () => {
    const goalsPageId = "okr";
    const goalsExists = goalsPageId in meta;

    const newGoalId = useStore.getState().makePage(
      { icon: "🎯", title: "New Goal" },
      [
        {
          id: uid("blk"),
          type: "callout",
          text: "Goal details go here...",
          emoji: "🎯",
        },
        { id: uid("blk"), type: "h2", text: "Definition of Success" },
        { id: uid("blk"), type: "todo", text: "Key Result 1", done: false },
        { id: uid("blk"), type: "todo", text: "Key Result 2", done: false },
      ],
      goalsExists ? goalsPageId : null,
    );

    selectPage(newGoalId);
    setSurface("doc");
    useStore
      .getState()
      .flash(goalsExists ? "Goal created under Goals" : "Goal created at root");
  };

  // Get dynamic greeting
  const getGreeting = () => {
    const hrs = new Date().getHours();
    if (hrs < 12) return "Good morning";
    if (hrs < 17) return "Good afternoon";
    return "Good evening";
  };

  const todayStr = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="scroll dashboard-container">
      {/* Welcome Header */}
      <header className="dashboard-header-row">
        <div className="dashboard-header-left">
          <h1 className="dashboard-title">{getGreeting()}, User</h1>
          <div className="dashboard-subtitle">{todayStr}</div>
        </div>

        {/* Quick actions panel */}
        <div className="dashboard-quick-actions">
          <button className="dashboard-action-btn" onClick={handleNewNote}>
            <Icon name="plus" size={14} />
            <span>Note</span>
          </button>
          <button className="dashboard-action-btn" onClick={handleNewTask}>
            <Icon name="board" size={14} />
            <span>Task</span>
          </button>
          <button className="dashboard-action-btn" onClick={handleNewGoal}>
            <Icon name="flag" size={14} />
            <span>Goal</span>
          </button>
        </div>
      </header>

      {/* Workspace Cards Section (Scratchpad, Pinned, Recents) */}
      <div className="dashboard-workspace-section">
        {/* Scratch Pad Post-it Card */}
        <section
          className="dashboard-card postit-card"
          onClick={() => setIsEditingScratchpad(true)}
        >
          <div className="postit-header">
            <Icon name="comment" size={14} />
            <h2 className="postit-title">Scratch Pad</h2>
            <span className="postit-hint">Auto-saved</span>
          </div>
          <div className="postit-body">
            {scratchText ? (
              <p className="postit-text">{scratchText}</p>
            ) : (
              <p className="postit-placeholder">Jot down a quick thought...</p>
            )}
          </div>
          <div className="postit-footer">
            <span className="postit-action-label">Click to edit</span>
          </div>
        </section>

        {/* Pinned Notes Card */}
        <section className="dashboard-card dashboard-card-tall">
          <div className="dashboard-card-header-wide">
            <Icon name="star" size={18} />
            <h2 className="dashboard-card-title">Pinned Notes</h2>
          </div>
          <div className="scroll dashboard-list">
            {pinned.length === 0 ? (
              <div className="dashboard-list-empty">
                No pinned notes. Star notes in Sidebar to pin them here.
              </div>
            ) : (
              pinned.map((id) => (
                <div key={id} className="dashboard-item-container">
                  <button
                    type="button"
                    className="dashboard-item-button"
                    onClick={() => jumpToPage(id)}
                  >
                    <span className="dashboard-item-icon">
                      {meta[id]?.icon || "📄"}
                    </span>
                    <span className="dashboard-item-label">
                      {meta[id]?.title || "Untitled"}
                    </span>
                  </button>
                  <button
                    type="button"
                    title="Unpin note"
                    className="dashboard-item-action"
                    onClick={() => togglePin(id)}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Recently Visited Notes */}
        <section className="dashboard-card dashboard-card-tall">
          <div className="dashboard-card-header-wide">
            <Icon name="clock" size={18} />
            <h2 className="dashboard-card-title">Recently Visited</h2>
          </div>
          <div className="scroll dashboard-list">
            {recents.length === 0 ? (
              <div className="dashboard-list-empty">
                Notes you visit will appear here.
              </div>
            ) : (
              recents.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="dashboard-item-clickable"
                  onClick={() => jumpToPage(id)}
                >
                  <span className="dashboard-item-icon">
                    {meta[id]?.icon || "📄"}
                  </span>
                  <span className="dashboard-item-label">
                    {meta[id]?.title || "Untitled"}
                  </span>
                  <Icon
                    name="chevR"
                    size={12}
                    className="dashboard-item-chevron"
                  />
                </button>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Glanceable Info Widgets Grid Section (Apple-style) */}
      <h2 className="dashboard-section-title">My Day & Insights</h2>
      <div className="dashboard-widgets-section">
        {/* Schedule Compact Widget */}
        <div
          className="compact-widget schedule-widget"
          onClick={() => setShowScheduleModal(true)}
        >
          <div className="widget-header">
            <Icon name="calendar" size={16} />
            <span>Today&apos;s Schedule</span>
          </div>
          <div className="widget-body">
            <div className="compact-event-row">
              <span className="compact-event-time">
                {SCHEDULE_EVENTS[0].time}
              </span>
              <span className="compact-event-title">
                {SCHEDULE_EVENTS[0].title}
              </span>
            </div>
            <div className="compact-event-upcoming">
              Next: {SCHEDULE_EVENTS[1].title}
            </div>
          </div>
        </div>

        {/* Weather Compact Widget */}
        <div
          className="compact-widget weather-widget"
          onClick={() => setShowWeatherModal(true)}
        >
          <div className="widget-header">
            <Icon name="sun" size={16} />
            <span>Weather</span>
          </div>
          <div className="widget-body weather-compact-body">
            <div className="weather-compact-temp-row">
              <span className="weather-compact-temp">{WEATHER_INFO.temp}</span>
              <span className="weather-compact-cond">
                {WEATHER_INFO.condition}
              </span>
            </div>
            <span className="weather-compact-loc">{WEATHER_INFO.location}</span>
          </div>
        </div>

        {/* Markets Compact Widget */}
        <div
          className="compact-widget markets-widget"
          onClick={() => setShowMarketsModal(true)}
        >
          <div className="widget-header">
            <Icon name="table" size={16} />
            <span>Markets</span>
          </div>
          <div className="widget-body markets-compact-body">
            <div className="market-ticker-row">
              <span className="ticker-name">S&P 500</span>
              <span className="ticker-badge positive">
                {MARKET_INDEXES[0].change}
              </span>
            </div>
            <div className="market-ticker-row">
              <span className="ticker-name">BTC</span>
              <span className="ticker-badge positive">
                {MARKET_INDEXES[3].change}
              </span>
            </div>
          </div>
        </div>

        {/* News Compact Widget */}
        <div
          className="compact-widget news-widget"
          onClick={() => setShowNewsModal(true)}
        >
          <div className="widget-header">
            <Icon name="doc" size={16} />
            <span>Tech News</span>
          </div>
          <div className="widget-body news-compact-body">
            <span className="news-compact-headline">
              {NEWS_ARTICLES[0].title}
            </span>
          </div>
        </div>

        {/* Sports Compact Widget */}
        <div
          className="compact-widget sports-widget"
          onClick={() => setShowSportsModal(true)}
        >
          <div className="widget-header">
            <Icon name="heart" size={16} />
            <span>Sports</span>
          </div>
          <div className="widget-body sports-compact-body">
            <div className="sports-compact-match">{SPORTS_GAME.teams}</div>
            <div className="sports-compact-score">{SPORTS_GAME.score}</div>
          </div>
        </div>
      </div>

      {/* --- Detail Modals --- */}

      {/* Scratch Pad Editor Modal */}
      {isEditingScratchpad && (
        <div
          className="scratchpad-modal-overlay"
          onClick={() => setIsEditingScratchpad(false)}
        >
          <div
            className="scratchpad-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="scratchpad-modal-header">
              <div className="scratchpad-modal-title-row">
                <Icon name="comment" size={16} />
                <h3 className="scratchpad-modal-title">Edit Scratch Pad</h3>
              </div>
              <div className="scratchpad-modal-meta">
                <span className="save-indicator">Saved to disk</span>
                <button
                  className="scratchpad-modal-close"
                  onClick={() => setIsEditingScratchpad(false)}
                  title="Close editor"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            </header>
            <textarea
              className="scratchpad-modal-textarea"
              value={scratchText}
              onChange={(e) => handleScratchChange(e.target.value)}
              placeholder="Jot down a quick thought..."
              autoFocus
            />
            <footer className="scratchpad-modal-footer">
              <button
                className="scratchpad-modal-done-btn"
                onClick={() => setIsEditingScratchpad(false)}
              >
                Done
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* Schedule Detail Modal */}
      {showScheduleModal && (
        <div
          className="scratchpad-modal-overlay"
          onClick={() => setShowScheduleModal(false)}
        >
          <div
            className="scratchpad-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="scratchpad-modal-header">
              <div className="scratchpad-modal-title-row">
                <Icon name="calendar" size={18} />
                <h3 className="scratchpad-modal-title">
                  Today&apos;s Schedule
                </h3>
              </div>
              <button
                className="scratchpad-modal-close"
                onClick={() => setShowScheduleModal(false)}
                title="Close schedule"
              >
                <Icon name="x" size={14} />
              </button>
            </header>
            <div
              className="scroll scratchpad-modal-textarea"
              style={{ padding: "20px" }}
            >
              <div
                className="dashboard-schedule-list"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                {SCHEDULE_EVENTS.map((evt, idx) => (
                  <div key={idx} className="dashboard-schedule-event">
                    <span className="event-time">{evt.time}</span>
                    <div className="event-details">
                      <div className="event-title-row">
                        <Icon
                          name={evt.icon}
                          size={14}
                          className="event-icon"
                        />
                        <span className="event-title">{evt.title}</span>
                      </div>
                      <span className="event-desc">{evt.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <footer className="scratchpad-modal-footer">
              <button
                className="scratchpad-modal-done-btn"
                onClick={() => setShowScheduleModal(false)}
              >
                Done
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* Weather Detail Modal */}
      {showWeatherModal && (
        <div
          className="scratchpad-modal-overlay"
          onClick={() => setShowWeatherModal(false)}
        >
          <div
            className="scratchpad-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="scratchpad-modal-header">
              <div className="scratchpad-modal-title-row">
                <Icon name="sun" size={18} />
                <h3 className="scratchpad-modal-title">Weather Details</h3>
              </div>
              <button
                className="scratchpad-modal-close"
                onClick={() => setShowWeatherModal(false)}
                title="Close weather"
              >
                <Icon name="x" size={14} />
              </button>
            </header>
            <div
              className="scratchpad-modal-textarea"
              style={{ padding: "24px" }}
            >
              <div
                className="weather-grid"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                }}
              >
                <div
                  className="weather-temp-row"
                  style={{ display: "flex", alignItems: "center", gap: "20px" }}
                >
                  <span
                    className="weather-temp"
                    style={{ fontSize: "48px", fontWeight: "700" }}
                  >
                    {WEATHER_INFO.temp}
                  </span>
                  <div
                    className="weather-cond-col"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                    }}
                  >
                    <span
                      className="weather-cond"
                      style={{ fontSize: "16px", fontWeight: "600" }}
                    >
                      {WEATHER_INFO.condition}
                    </span>
                    <span className="weather-loc" style={{ opacity: 0.7 }}>
                      {WEATHER_INFO.location}
                    </span>
                  </div>
                </div>
                <div
                  className="weather-metrics"
                  style={{
                    display: "flex",
                    gap: "24px",
                    marginTop: "12px",
                    fontSize: "14px",
                    opacity: 0.8,
                  }}
                >
                  <span>Humidity: {WEATHER_INFO.humidity}</span>
                  <span>Wind: {WEATHER_INFO.wind}</span>
                </div>
              </div>
            </div>
            <footer className="scratchpad-modal-footer">
              <button
                className="scratchpad-modal-done-btn"
                onClick={() => setShowWeatherModal(false)}
              >
                Done
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* Markets Detail Modal */}
      {showMarketsModal && (
        <div
          className="scratchpad-modal-overlay"
          onClick={() => setShowMarketsModal(false)}
        >
          <div
            className="scratchpad-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="scratchpad-modal-header">
              <div className="scratchpad-modal-title-row">
                <Icon name="table" size={18} />
                <h3 className="scratchpad-modal-title">Market Indexes</h3>
              </div>
              <button
                className="scratchpad-modal-close"
                onClick={() => setShowMarketsModal(false)}
                title="Close markets"
              >
                <Icon name="x" size={14} />
              </button>
            </header>
            <div
              className="scroll scratchpad-modal-textarea"
              style={{ padding: "20px" }}
            >
              <div className="dashboard-markets-list">
                <table
                  className="market-table"
                  style={{ width: "100%", borderCollapse: "collapse" }}
                >
                  <tbody>
                    {MARKET_INDEXES.map((idx, index) => (
                      <tr
                        key={index}
                        className="market-row"
                        style={{ borderBottom: "1px solid var(--hair-soft)" }}
                      >
                        <td
                          className="market-name"
                          style={{ padding: "12px 8px", fontWeight: "600" }}
                        >
                          {idx.name}
                        </td>
                        <td
                          className="market-val"
                          style={{
                            padding: "12px 8px",
                            textAlign: "right",
                            fontWeight: "700",
                          }}
                        >
                          {idx.val}
                        </td>
                        <td style={{ padding: "12px 8px", textAlign: "right" }}>
                          <span
                            className={`pct-badge ${idx.positive ? "pos" : "neg"}`}
                          >
                            {idx.change}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <footer className="scratchpad-modal-footer">
              <button
                className="scratchpad-modal-done-btn"
                onClick={() => setShowMarketsModal(false)}
              >
                Done
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* News Detail Modal */}
      {showNewsModal && (
        <div
          className="scratchpad-modal-overlay"
          onClick={() => setShowNewsModal(false)}
        >
          <div
            className="scratchpad-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="scratchpad-modal-header">
              <div className="scratchpad-modal-title-row">
                <Icon name="doc" size={18} />
                <h3 className="scratchpad-modal-title">
                  Productivity & Tech News
                </h3>
              </div>
              <button
                className="scratchpad-modal-close"
                onClick={() => setShowNewsModal(false)}
                title="Close news"
              >
                <Icon name="x" size={14} />
              </button>
            </header>
            <div
              className="scroll scratchpad-modal-textarea"
              style={{ padding: "20px" }}
            >
              <div
                className="dashboard-news-list"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                }}
              >
                {NEWS_ARTICLES.map((article, index) => (
                  <div
                    key={index}
                    className="news-item"
                    style={{
                      padding: "12px",
                      borderRadius: "8px",
                      background: "var(--sunk)",
                      border: "1px solid var(--hair-soft)",
                    }}
                  >
                    <div
                      className="news-header-row"
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: "6px",
                      }}
                    >
                      <span className="news-badge">{article.category}</span>
                      <span className="news-time">{article.time}</span>
                    </div>
                    <span
                      className="news-title"
                      style={{
                        fontSize: "14px",
                        fontWeight: "600",
                        lineHeight: "1.4",
                      }}
                    >
                      {article.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <footer className="scratchpad-modal-footer">
              <button
                className="scratchpad-modal-done-btn"
                onClick={() => setShowNewsModal(false)}
              >
                Done
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* Sports Detail Modal */}
      {showSportsModal && (
        <div
          className="scratchpad-modal-overlay"
          onClick={() => setShowSportsModal(false)}
        >
          <div
            className="scratchpad-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="scratchpad-modal-header">
              <div className="scratchpad-modal-title-row">
                <Icon name="heart" size={18} />
                <h3 className="scratchpad-modal-title">Sports Feed</h3>
              </div>
              <button
                className="scratchpad-modal-close"
                onClick={() => setShowSportsModal(false)}
                title="Close sports"
              >
                <Icon name="x" size={14} />
              </button>
            </header>
            <div
              className="scratchpad-modal-textarea"
              style={{ padding: "24px" }}
            >
              <div
                className="sports-feed-container"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                }}
              >
                <div
                  className="sports-game-row"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "16px",
                    fontWeight: "600",
                  }}
                >
                  <span className="sports-teams">{SPORTS_GAME.teams}</span>
                  <span
                    className="sports-status"
                    style={{
                      fontSize: "12px",
                      textTransform: "uppercase",
                      opacity: 0.6,
                    }}
                  >
                    {SPORTS_GAME.status}
                  </span>
                </div>
                <div
                  className="sports-score-row"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: "var(--sunk)",
                    border: "1px solid var(--hair-soft)",
                    padding: "16px 20px",
                    borderRadius: "8px",
                  }}
                >
                  <span
                    className="sports-score"
                    style={{ fontSize: "28px", fontWeight: "700" }}
                  >
                    {SPORTS_GAME.score}
                  </span>
                  <span
                    className="sports-winner"
                    style={{ fontSize: "14px", opacity: 0.8 }}
                  >
                    Winner: {SPORTS_GAME.winner}
                  </span>
                </div>
              </div>
            </div>
            <footer className="scratchpad-modal-footer">
              <button
                className="scratchpad-modal-done-btn"
                onClick={() => setShowSportsModal(false)}
              >
                Done
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
