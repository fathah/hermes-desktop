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
  preview: string;
  meta: string;
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

interface SpotlightWorkflow {
  id: string;
  label: string;
  profile: string;
  promptText: string;
  startup: boolean;
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
  workflows: SpotlightWorkflow[];
  onResumeRecentSession: (sessionId: string) => void;
  onApplyPreset: (presetId: string) => void;
  onRunWorkflow: (workflowId: string) => void;
  onSetStartupWorkflow: (workflowId: string | null) => void;
  onSkipStartupWorkflowOnce: () => void;
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
  "war-room": Sparkles,
  "control-plane": Users,
  "gateway-map": Signal,
  "intelligence-fabric": Layers,
  "execution-center": Wrench,
  projects: Building,
  domains: Brain,
  "hcc-memory": Brain,
  "review-center": Clock,
  "registry-manager": SettingsIcon,
  "graph-center": Brain,
  "clone-remix": Building,
  "opportunity-radar": Sparkles,
  "learning-engine": Brain,
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
  workflows,
  onResumeRecentSession,
  onApplyPreset,
  onRunWorkflow,
  onSetStartupWorkflow,
  onSkipStartupWorkflowOnce,
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
      ["war-room", "Open War Room", "See HCC overview and operator situation room", "HCC Workspace"],
      ["control-plane", "Open Control Plane", "Review missions, queues, and governed execution", "HCC Workspace"],
      ["gateway-map", "Open Gateway Map", "Inspect gateway fabric health and coverage", "HCC Workspace"],
      ["intelligence-fabric", "Open Intelligence Fabric", "Stage recommendations into governed execution", "HCC Workspace"],
      ["execution-center", "Open Execution Center", "Approve, dispatch, and verify governed runs", "HCC Workspace"],
      ["projects", "Open Projects", "Navigate active build missions and project state", "HCC Workspace"],
      ["domains", "Open Domains", "Inspect operator domains and health state", "HCC Workspace"],
      ["hcc-memory", "Open HCC Memory", "Review operator memory, continuity, and context", "HCC Workspace"],
      ["review-center", "Open Review Center", "Steer approvals, checkpoints, and retrospective review", "HCC Workspace"],
      ["registry-manager", "Open Registry", "Manage registry, governance, and operator configuration", "HCC Workspace"],
      ["graph-center", "Open Graph", "Explore graph relations and linked knowledge", "HCC Workspace"],
      ["clone-remix", "Open Clone Remix", "Run clone/remix studio workflows", "HCC Workspace"],
      ["opportunity-radar", "Open Opportunity Radar", "Surface leverage and opportunity signals", "HCC Workspace"],
      ["learning-engine", "Open Learning Engine", "Track learning loops and progression", "HCC Workspace"],
      ["capture-inbox", "Open Capture Inbox", "Capture, classify, and govern routing into canonical HCC objects", "HCC Workspace"],
      ["decision-center", "Open Decision Center", "Evaluate options against evidence, values, and hard constraints", "HCC Workspace"],
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
      rank: rankBoost(`view:${view}`, 120 - index),
      preview: hint,
      meta: `${category} · ${view}`,
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
        preview: `Fresh operator thread on profile ${activeProfile}. Clears the active conversation and resets workspace focus.`,
        meta: `Actions · ${activeProfile}`,
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
        preview: "Align the shell against the nearest display edge using the native snap-to-edge behavior.",
        meta: "Window · layout",
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
        preview: "Open the session browser to inspect history, restore old runs, and continue previous work.",
        meta: "Actions · sessions",
        onSelect: () => {
          onSearchSessions();
          onClose();
        },
      },
      {
        id: "action:skip-startup-workflow",
        label: "Skip Startup Workflow Once",
        hint: "Disable the next startup workflow run for this boot cycle",
        category: "Workflow Control",
        match: "skip startup workflow once disable next boot workflow".toLowerCase(),
        rank: rankBoost("action:skip-startup-workflow", 74),
        preview: "Use this when you want to boot the shell without auto-loading the armed startup workflow.",
        meta: "Workflow Control · boot",
        onSelect: () => {
          onSkipStartupWorkflowOnce();
          onClose();
        },
      },
      {
        id: "action:clear-startup-workflow",
        label: "Clear Startup Workflow",
        hint: "Remove any workflow armed for startup",
        category: "Workflow Control",
        match: "clear startup workflow remove armed startup workflow".toLowerCase(),
        rank: rankBoost("action:clear-startup-workflow", 73),
        preview: "Drop startup workflow automation and restore manual launch only.",
        meta: "Workflow Control · startup",
        onSelect: () => {
          onSetStartupWorkflow(null);
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
      preview: `Continue recent work from session ${session.title || "Untitled session"}. Restores chat context directly into the shell.`,
      meta: "Recent Session · recall",
      onSelect: () => {
        onResumeRecentSession(session.id);
        onClose();
      },
    }));

    const workflowActions: SpotlightAction[] = workflows.map((workflow, index) => ({
      id: `workflow:${workflow.id}`,
      label: workflow.label,
      hint: workflow.startup ? `Run startup workflow for ${workflow.profile}` : `Run workflow for ${workflow.profile}`,
      category: workflow.startup ? "Startup Workflow" : "Workflow",
      match: `${workflow.label} ${workflow.profile} ${workflow.promptText} workflow combo ${workflow.startup ? "startup" : ""}`.toLowerCase(),
      rank: workflow.startup ? 99 - index : 92 - index,
      preview: workflow.startup
        ? `Launch startup workflow ${workflow.label} with saved prompt and profile ${workflow.profile}.`
        : `Launch workflow ${workflow.label} with saved prompt and profile ${workflow.profile}.`,
      meta: workflow.startup ? `Startup Workflow · ${workflow.profile}` : `Workflow · ${workflow.profile}`,
      onSelect: () => {
        onRunWorkflow(workflow.id);
        onClose();
      },
    }));

    const startupWorkflowControlActions: SpotlightAction[] = workflows.map((workflow, index) => ({
      id: `workflow-startup:${workflow.id}`,
      label: workflow.startup ? `Startup armed: ${workflow.label}` : `Arm startup: ${workflow.label}`,
      hint: workflow.startup ? "This workflow already runs at boot" : "Set this workflow to auto-run at boot",
      category: "Workflow Control",
      match: `${workflow.label} startup arm boot workflow ${workflow.profile}`.toLowerCase(),
      rank: 91 - index,
      preview: workflow.startup
        ? `Startup automation already points at ${workflow.label}.`
        : `Arm ${workflow.label} as the workflow that runs after the boot sequence finishes.`,
      meta: workflow.startup ? "Workflow Control · armed" : "Workflow Control · arm startup",
      onSelect: () => {
        onSetStartupWorkflow(workflow.id);
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
      preview: `Load preset ${preset.label} and switch the shell to ${preset.view} on profile ${preset.profile}.`,
      meta: `Preset · ${preset.profile}`,
      onSelect: () => {
        onApplyPreset(preset.id);
        onClose();
      },
    }));

    return [
      ...recentSessionActions,
      ...workflowActions,
      ...startupWorkflowControlActions,
      ...presetActions,
      ...actionItems,
      ...viewActions,
    ];
  }, [
    activeProfile,
    onApplyPreset,
    onClose,
    onNavigate,
    onNewChat,
    onResumeRecentSession,
    onRunWorkflow,
    onSearchSessions,
    onSetStartupWorkflow,
    onSkipStartupWorkflowOnce,
    onSnapWindow,
    presets,
    recentActionIds,
    recentSessions,
    workflows,
  ]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const next = !normalized
      ? [...actions]
      : actions.filter((action) => action.match.includes(normalized));
    return next.sort((a, b) => b.rank - a.rank);
  }, [actions, query]);

  const topHit = filtered[0] ?? null;

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
          <span className="spotlight-chip spotlight-chip-brand">HCC OS</span>
          <span className="spotlight-meta-copy">Profile: {activeProfile}</span>
          <span className="spotlight-meta-copy">⌘/Ctrl + P</span>
          <span className="spotlight-meta-copy">Operator palette</span>
        </div>
        <div className="spotlight-quick-actions">
          {quickActions.map(({ key, label, icon: Icon, onClick }) => (
            <button key={key} className="spotlight-quick-action" onClick={() => void onClick()}>
              <span className="spotlight-quick-action-icon">
                <Icon size={14} />
              </span>
              <span className="spotlight-quick-action-copy">
                <span className="spotlight-quick-action-label">{label}</span>
                <span className="spotlight-quick-action-hint">Quick launch</span>
              </span>
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
                <span className="spotlight-recent-pill-copy">
                  <span className="spotlight-recent-pill-kicker">Session</span>
                  <span>{session.title || "Untitled session"}</span>
                </span>
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
                <span className="spotlight-recent-pill-copy">
                  <span className="spotlight-recent-pill-kicker">Preset</span>
                  <span>{preset.label}</span>
                </span>
              </button>
            ))}
            {workflows.slice(0, 2).map((workflow) => (
              <button
                key={workflow.id}
                className="spotlight-recent-pill"
                onClick={() => {
                  onRunWorkflow(workflow.id);
                  onClose();
                }}
              >
                <Sparkles size={13} />
                <span className="spotlight-recent-pill-copy">
                  <span className="spotlight-recent-pill-kicker">Workflow</span>
                  <span>{workflow.label}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        {topHit && (
          <button className="spotlight-top-hit" onClick={() => void topHit.onSelect()}>
            <div className="spotlight-top-hit-copy">
              <span className="spotlight-top-hit-kicker">Top hit</span>
              <span className="spotlight-top-hit-label">{topHit.label}</span>
              <span className="spotlight-top-hit-preview">{topHit.preview}</span>
            </div>
            <div className="spotlight-top-hit-side">
              <span className="spotlight-top-hit-meta">{topHit.meta}</span>
              <span className="spotlight-top-hit-category">{topHit.category}</span>
              <span className="spotlight-top-hit-enter">Enter ↵</span>
            </div>
          </button>
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
                      <span className="spotlight-result-meta-inline">{action.meta}</span>
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
