import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Sparkles,
  Clock,
  Users,
  Building,
  Layers,
  Puzzle,
  Brain,
  Wrench,
  Timer,
  Signal,
  Settings as SettingsIcon,
  X,
  ArrowRight,
  PanelLeft,
  ScanSearch,
  History,
} from "lucide-react";

interface SpotlightAction {
  id: string;
  label: string;
  hint: string;
  category: string;
  match: string;
  rank: number;
  onSelect: () => void;
}

interface SpotlightRecentSession {
  id: string;
  title: string;
}

interface SpotlightPreset {
  id: string;
  label: string;
  view: string;
  profile: string;
}

interface SpotlightProps {
  open: boolean;
  activeProfile: string;
  onClose: () => void;
  onNavigate: (view: string) => void;
  onNewChat: () => void;
  onSnapWindow: () => Promise<void>;
  onSearchSessions: () => void;
  recentSessions: SpotlightRecentSession[];
  recentActionIds: string[];
  presets: SpotlightPreset[];
  onResumeRecentSession: (sessionId: string) => void;
  onApplyPreset: (presetId: string) => void;
}

const ICON_MAP = {
  chat: Sparkles,
  sessions: Clock,
  agents: Users,
  office: Building,
  models: Layers,
  skills: Puzzle,
  memory: Brain,
  tools: Wrench,
  schedules: Timer,
  gateway: Signal,
  settings: SettingsIcon,
} as const;

function Spotlight({
  open,
  activeProfile,
  onClose,
  onNavigate,
  onNewChat,
  onSnapWindow,
  onSearchSessions,
  recentSessions,
  recentActionIds,
  presets,
  onResumeRecentSession,
  onApplyPreset,
}: SpotlightProps): React.JSX.Element | null {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelectedIndex(0);
    }
  }, [open]);

  const actions = useMemo<SpotlightAction[]>(() => {
    const rankBoost = (id: string, base: number): number => {
      const idx = recentActionIds.indexOf(id);
      return idx === -1 ? base : base + Math.max(0, 8 - idx);
    };

    const viewActions: SpotlightAction[] = [
      ["chat", "Open Chat", "Jump into the active conversation workspace", "Workspace"],
      ["sessions", "Open Sessions", "Browse and resume session history", "Workspace"],
      ["agents", "Open Agents", "Switch or manage Hermes profiles", "Profiles"],
      ["office", "Open Office", "Launch the visual office workspace", "Workspace"],
      ["models", "Open Models", "Review saved model presets", "Systems"],
      ["skills", "Open Skills", "Browse installed skills", "Systems"],
      ["memory", "Open Memory", "Inspect persistent memory", "Systems"],
      ["tools", "Open Tools", "Toggle tool availability", "Systems"],
      ["schedules", "Open Schedules", "Manage cron jobs", "Operations"],
      ["gateway", "Open Gateway", "Configure platform delivery", "Operations"],
      ["settings", "Open Settings", "Adjust provider and app settings", "Operations"],
    ].map(([view, label, hint, category], index) => ({
      id: `view:${view}`,
      label,
      hint,
      category,
      match: `${label} ${hint} ${view} ${category}`.toLowerCase(),
      rank: rankBoost(`view:${view}`, 30 - index),
      onSelect: () => {
        onNavigate(view);
        onClose();
      },
    } as SpotlightAction));

    const actionItems: SpotlightAction[] = [
      {
        id: "action:new-chat",
        label: "Start New Chat",
        hint: `Clear current thread and stay on ${activeProfile}`,
        category: "Actions",
        match: `new chat clear conversation ${activeProfile} actions`.toLowerCase(),
        rank: rankBoost("action:new-chat", 80),
        onSelect: () => {
          onNewChat();
          onClose();
        },
      },
      {
        id: "action:snap-window",
        label: "Snap Window to Edge",
        hint: "Apply HCC OS edge alignment to the current shell window",
        category: "Window",
        match: "snap window edge align shell window".toLowerCase(),
        rank: rankBoost("action:snap-window", 70),
        onSelect: async () => {
          await onSnapWindow();
          onClose();
        },
      },
      {
        id: "action:search-sessions",
        label: "Jump to Session Search",
        hint: "Open Sessions and browse recent runs",
        category: "Actions",
        match: "search sessions history recent runs".toLowerCase(),
        rank: rankBoost("action:search-sessions", 72),
        onSelect: () => {
          onSearchSessions();
          onClose();
        },
      },
    ];

    const recentSessionActions: SpotlightAction[] = recentSessions.map((session, index) => ({
      id: `recent-session:${session.id}`,
      label: session.title || "Untitled session",
      hint: "Resume this recent operator session",
      category: "Recent Session",
      match: `${session.title} recent session history resume`.toLowerCase(),
      rank: 95 - index,
      onSelect: () => {
        onResumeRecentSession(session.id);
        onClose();
      },
    }));

    const presetActions: SpotlightAction[] = presets.map((preset, index) => ({
      id: `preset:${preset.id}`,
      label: preset.label,
      hint: `Apply preset for ${preset.profile} · ${preset.view}`,
      category: "Preset",
      match: `${preset.label} ${preset.profile} ${preset.view} preset workspace`.toLowerCase(),
      rank: 88 - index,
      onSelect: () => {
        onApplyPreset(preset.id);
        onClose();
      },
    }));

    return [...recentSessionActions, ...presetActions, ...actionItems, ...viewActions];
  }, [
    activeProfile,
    onApplyPreset,
    onClose,
    onNavigate,
    onNewChat,
    onResumeRecentSession,
    onSearchSessions,
    onSnapWindow,
    presets,
    recentActionIds,
    recentSessions,
  ]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const next = !normalized
      ? [...actions]
      : actions.filter((action) => action.match.includes(normalized));
    return next.sort((a, b) => b.rank - a.rank);
  }, [actions, query]);

  const quickActions = useMemo(
    () => [
      {
        key: "new-chat",
        label: "New Chat",
        icon: Sparkles,
        onClick: () => {
          onNewChat();
          onClose();
        },
      },
      {
        key: "session-search",
        label: "Sessions",
        icon: ScanSearch,
        onClick: () => {
          onSearchSessions();
          onClose();
        },
      },
      {
        key: "snap-window",
        label: "Snap",
        icon: PanelLeft,
        onClick: async () => {
          await onSnapWindow();
          onClose();
        },
      },
    ],
    [onClose, onNewChat, onSearchSessions, onSnapWindow],
  );

  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(0);
    }
  }, [filtered.length, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((prev) =>
          filtered.length ? (prev + 1) % filtered.length : 0,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((prev) =>
          filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0,
        );
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        void filtered[selectedIndex]?.onSelect();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filtered, onClose, open, selectedIndex]);

  if (!open) return null;

  return (
    <div className="spotlight-overlay" onClick={onClose}>
      <div className="spotlight-panel" onClick={(event) => event.stopPropagation()}>
        <div className="spotlight-panel-glow" />
        <div className="spotlight-header">
          <div className="spotlight-search-shell">
            <div className="spotlight-search-icon-wrap">
              <Search size={16} />
            </div>
            <input
              autoFocus
              className="spotlight-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search views, commands, and workflows"
            />
          </div>
          <button
            className="spotlight-close"
            onClick={onClose}
            aria-label="Close spotlight"
          >
            <X size={16} />
          </button>
        </div>
        <div className="spotlight-meta-row">
          <span className="spotlight-chip">HCC OS</span>
          <span className="spotlight-meta-copy">Profile: {activeProfile}</span>
          <span className="spotlight-meta-copy">⌘/Ctrl + P</span>
        </div>
        <div className="spotlight-quick-actions">
          {quickActions.map(({ key, label, icon: Icon, onClick }) => (
            <button key={key} className="spotlight-quick-action" onClick={() => void onClick()}>
              <span className="spotlight-quick-action-icon">
                <Icon size={14} />
              </span>
              <span>{label}</span>
            </button>
          ))}
        </div>
        {recentSessions.length > 0 && (
          <div className="spotlight-recent-strip">
            {recentSessions.slice(0, 3).map((session) => (
              <button
                key={session.id}
                className="spotlight-recent-pill"
                onClick={() => {
                  onResumeRecentSession(session.id);
                  onClose();
                }}
              >
                <History size={13} />
                <span>{session.title || "Untitled session"}</span>
              </button>
            ))}
            {presets.slice(0, 2).map((preset) => (
              <button
                key={preset.id}
                className="spotlight-recent-pill"
                onClick={() => {
                  onApplyPreset(preset.id);
                  onClose();
                }}
              >
                <PanelLeft size={13} />
                <span>{preset.label}</span>
              </button>
            ))}
          </div>
        )}
        <div className="spotlight-results">
          {filtered.length === 0 ? (
            <div className="spotlight-empty">No matches for that query.</div>
          ) : (
            filtered.map((action, index) => {
              const view = action.id.startsWith("view:")
                ? (action.id.split(":")[1] as keyof typeof ICON_MAP)
                : "chat";
              const Icon = ICON_MAP[view] ?? Sparkles;
              return (
                <button
                  key={action.id}
                  className={`spotlight-result ${selectedIndex === index ? "active" : ""}`}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => void action.onSelect()}
                >
                  <span className="spotlight-result-icon">
                    <Icon size={15} />
                  </span>
                  <span className="spotlight-result-copy">
                    <span className="spotlight-result-topline">
                      <span className="spotlight-result-category">{action.category}</span>
                    </span>
                    <span className="spotlight-result-label">{action.label}</span>
                    <span className="spotlight-result-hint">{action.hint}</span>
                  </span>
                  <span className="spotlight-result-arrow">
                    <ArrowRight size={15} />
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default Spotlight;
