import { useEffect, useMemo, useState } from "react";
import { Search, Sparkles, Clock, Users, Building, Layers, Puzzle, Brain, Wrench, Timer, Signal, Settings as SettingsIcon, X } from "lucide-react";

interface SpotlightAction {
  id: string;
  label: string;
  hint: string;
  match: string;
  onSelect: () => void;
}

interface SpotlightProps {
  open: boolean;
  activeProfile: string;
  onClose: () => void;
  onNavigate: (view: string) => void;
  onNewChat: () => void;
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

function Spotlight({ open, activeProfile, onClose, onNavigate, onNewChat }: SpotlightProps): React.JSX.Element | null {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelectedIndex(0);
    }
  }, [open]);

  const actions = useMemo<SpotlightAction[]>(() => {
    const viewActions: SpotlightAction[] = [
      ["chat", "Open Chat", "Jump into the active conversation workspace"],
      ["sessions", "Open Sessions", "Browse and resume session history"],
      ["agents", "Open Agents", "Switch or manage Hermes profiles"],
      ["office", "Open Office", "Launch the visual office workspace"],
      ["models", "Open Models", "Review saved model presets"],
      ["skills", "Open Skills", "Browse installed skills"],
      ["memory", "Open Memory", "Inspect persistent memory"],
      ["tools", "Open Tools", "Toggle tool availability"],
      ["schedules", "Open Schedules", "Manage cron jobs"],
      ["gateway", "Open Gateway", "Configure platform delivery"],
      ["settings", "Open Settings", "Adjust provider and app settings"],
    ].map(([view, label, hint]) => ({
      id: `view:${view}`,
      label,
      hint,
      match: `${label} ${hint} ${view}`.toLowerCase(),
      onSelect: () => {
        onNavigate(view);
        onClose();
      },
    }));

    return [
      {
        id: "action:new-chat",
        label: "Start New Chat",
        hint: `Clear current thread and stay on ${activeProfile}`,
        match: `new chat clear conversation ${activeProfile}`.toLowerCase(),
        onSelect: () => {
          onNewChat();
          onClose();
        },
      },
      ...viewActions,
    ];
  }, [activeProfile, onClose, onNavigate, onNewChat]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return actions;
    return actions.filter((action) => action.match.includes(normalized));
  }, [actions, query]);

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
        setSelectedIndex((prev) => (filtered.length ? (prev + 1) % filtered.length : 0));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((prev) => (filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        filtered[selectedIndex]?.onSelect();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filtered, onClose, open, selectedIndex]);

  if (!open) return null;

  return (
    <div className="spotlight-overlay" onClick={onClose}>
      <div className="spotlight-panel" onClick={(event) => event.stopPropagation()}>
        <div className="spotlight-header">
          <div className="spotlight-search-shell">
            <Search size={16} />
            <input
              autoFocus
              className="spotlight-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search views, commands, and workflows"
            />
          </div>
          <button className="spotlight-close" onClick={onClose} aria-label="Close spotlight">
            <X size={16} />
          </button>
        </div>
        <div className="spotlight-results">
          {filtered.length === 0 ? (
            <div className="spotlight-empty">No matches for that query.</div>
          ) : (
            filtered.map((action, index) => {
              const view = action.id.startsWith("view:") ? (action.id.split(":")[1] as keyof typeof ICON_MAP) : "chat";
              const Icon = ICON_MAP[view] ?? Sparkles;
              return (
                <button
                  key={action.id}
                  className={`spotlight-result ${selectedIndex === index ? "active" : ""}`}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={action.onSelect}
                >
                  <span className="spotlight-result-icon"><Icon size={15} /></span>
                  <span className="spotlight-result-copy">
                    <span className="spotlight-result-label">{action.label}</span>
                    <span className="spotlight-result-hint">{action.hint}</span>
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
