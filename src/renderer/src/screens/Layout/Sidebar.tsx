import { useCallback, useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Brain,
  Building,
  ChatBubble,
  ChevronRight,
  ChevronsUpDown,
  Clock,
  Folder,
  FolderPlus,
  HelpCircle,
  Kanban as KanbanIcon,
  KeyRound,
  Layers,
  Plus,
  Puzzle,
  Settings as SettingsIcon,
  Signal,
  Sparkles,
  Timer,
  Users,
  Wrench,
  X,
} from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import type { View } from "./Layout";

type Workspace = Awaited<
  ReturnType<typeof window.hermesAPI.listWorkspaces>
>[number];
type SessionItem = Awaited<
  ReturnType<typeof window.hermesAPI.listSessions>
>[number];
type ProfileItem = Awaited<
  ReturnType<typeof window.hermesAPI.listProfiles>
>[number];

interface SidebarProps {
  view: View;
  goTo: (v: View) => void;
  activeProfile: string;
  onSelectProfile: (name: string) => void;
  currentSessionId: string | null;
  onResumeSession: (sessionId: string) => void;
  onNewChat: () => void;
  activeWorkspace: string | null;
  onWorkspaceChange: (path: string | null) => void;
  footerSlot?: React.ReactNode;
}

/** Primary navigation items shown as a flat block at the top. */
const PRIMARY_NAV: { view: View; icon: LucideIcon; labelKey: string }[] = [
  { view: "office", icon: Building, labelKey: "navigation.office" },
  { view: "kanban", icon: KanbanIcon, labelKey: "navigation.kanban" },
  { view: "chat", icon: ChatBubble, labelKey: "navigation.chat" },
];

/** Configuration screens — grouped under a collapsible section. */
const CONFIG_NAV: { view: View; icon: LucideIcon; labelKey: string }[] = [
  { view: "agents", icon: Users, labelKey: "navigation.agents" },
  { view: "models", icon: Layers, labelKey: "navigation.models" },
  { view: "providers", icon: KeyRound, labelKey: "navigation.providers" },
  { view: "skills", icon: Puzzle, labelKey: "navigation.skills" },
  { view: "soul", icon: Sparkles, labelKey: "navigation.soul" },
  { view: "memory", icon: Brain, labelKey: "navigation.memory" },
  { view: "tools", icon: Wrench, labelKey: "navigation.tools" },
  { view: "schedules", icon: Timer, labelKey: "navigation.schedules" },
  { view: "gateway", icon: Signal, labelKey: "navigation.gateway" },
];

const COLLAPSE_KEY = "hermes.sidebar.collapsed";

function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "{}");
  } catch {
    return {};
  }
}

function Sidebar({
  view,
  goTo,
  activeProfile,
  onSelectProfile,
  currentSessionId,
  onResumeSession,
  onNewChat,
  activeWorkspace,
  onWorkspaceChange,
  footerSlot,
}: SidebarProps): React.JSX.Element {
  const { t } = useI18n();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [gatewayUp, setGatewayUp] = useState(false);
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] =
    useState<Record<string, boolean>>(readCollapsed);

  const toggleSection = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // Initial workspace list (the active workspace itself is owned by Layout).
  useEffect(() => {
    window.hermesAPI.listWorkspaces().then(setWorkspaces);
  }, []);

  // Poll live state: recent sessions + gateway status. 8s keeps the cache
  // warm-ish without hammering IPC; also refreshes on session switch below.
  useEffect(() => {
    let cancelled = false;
    function refresh(): void {
      window.hermesAPI.listSessions(8, 0).then((s) => {
        if (!cancelled) setSessions(s);
      });
      window.hermesAPI.gatewayStatus().then((up) => {
        if (!cancelled) setGatewayUp(up);
      });
    }
    refresh();
    const id = setInterval(refresh, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [currentSessionId]);

  const openProfileMenu = useCallback(() => {
    setProfileMenuOpen((open) => {
      if (!open) window.hermesAPI.listProfiles().then(setProfiles);
      return !open;
    });
  }, []);

  const selectProfile = useCallback(
    (name: string) => {
      setProfileMenuOpen(false);
      if (name === activeProfile) return;
      window.hermesAPI.setActiveProfile(name);
      onSelectProfile(name);
    },
    [activeProfile, onSelectProfile],
  );

  const handleAddWorkspace = useCallback(async () => {
    const result = await window.hermesAPI.addWorkspace();
    if (result) {
      setWorkspaces(result.workspaces);
      onWorkspaceChange(result.activeWorkspace);
    }
  }, [onWorkspaceChange]);

  const handleRemoveWorkspace = useCallback(
    async (path: string) => {
      const next = await window.hermesAPI.removeWorkspace(path);
      setWorkspaces(next);
      if (activeWorkspace === path) onWorkspaceChange(null);
    },
    [activeWorkspace, onWorkspaceChange],
  );

  const selectWorkspace = useCallback(
    (path: string) => {
      const next = activeWorkspace === path ? null : path;
      window.hermesAPI.setActiveWorkspace(next);
      onWorkspaceChange(next);
    },
    [activeWorkspace, onWorkspaceChange],
  );

  const profileInitial = useMemo(
    () => (activeProfile || "?").charAt(0).toUpperCase(),
    [activeProfile],
  );

  return (
    <aside className="sidebar">
      {/* Profile switcher chip */}
      <div className="sidebar-profile">
        <button
          className="sidebar-profile-chip"
          onClick={openProfileMenu}
          title={t("navigation.agents")}
        >
          <span className="sidebar-profile-avatar">{profileInitial}</span>
          <span className="sidebar-profile-name">{activeProfile}</span>
          <ChevronsUpDown size={14} className="sidebar-profile-caret" />
        </button>
        {profileMenuOpen && (
          <div className="sidebar-profile-menu">
            {profiles.map((p) => (
              <button
                key={p.name}
                className={`sidebar-profile-menu-item ${
                  p.name === activeProfile ? "active" : ""
                }`}
                onClick={() => selectProfile(p.name)}
              >
                <span className="sidebar-profile-avatar small">
                  {p.name.charAt(0).toUpperCase()}
                </span>
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="sidebar-scroll">
        {/* Primary flat nav */}
        <nav className="sidebar-nav">
          {PRIMARY_NAV.map(({ view: v, icon: Icon, labelKey }) => (
            <button
              key={v}
              className={`sidebar-nav-item ${view === v ? "active" : ""}`}
              onClick={() => goTo(v)}
            >
              <Icon size={16} />
              {t(labelKey)}
            </button>
          ))}
        </nav>

        {/* New Workspace action */}
        <button className="sidebar-newworkspace" onClick={handleAddWorkspace}>
          <Plus size={16} />
          <span>{t("navigation.newWorkspace")}</span>
          <FolderPlus size={15} className="sidebar-newworkspace-icon" />
        </button>

        {/* Workspaces section */}
        <Section
          id="workspaces"
          icon={Folder}
          label={t("navigation.sectionWorkspaces")}
          count={workspaces.length}
          collapsed={!!collapsed.workspaces}
          onToggle={toggleSection}
        >
          {workspaces.length === 0 ? (
            <div className="sidebar-empty">—</div>
          ) : (
            workspaces.map((w) => (
              <div
                key={w.path}
                className={`sidebar-row workspace ${
                  activeWorkspace === w.path ? "active" : ""
                }`}
                onClick={() => selectWorkspace(w.path)}
                title={w.path}
              >
                <span
                  className={`sidebar-dot ${
                    activeWorkspace === w.path ? "on" : "off"
                  }`}
                />
                <span className="sidebar-row-label">{w.name}</span>
                <button
                  className="sidebar-row-remove"
                  title={t("common.remove")}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveWorkspace(w.path);
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            ))
          )}
        </Section>

        {/* Sessions section */}
        <Section
          id="sessions"
          icon={Clock}
          label={t("navigation.sectionSessions")}
          count={sessions.length}
          collapsed={!!collapsed.sessions}
          onToggle={toggleSection}
          action={
            <button
              className="sidebar-section-action"
              title={t("navigation.chat")}
              onClick={(e) => {
                e.stopPropagation();
                onNewChat();
              }}
            >
              <Plus size={14} />
            </button>
          }
        >
          {sessions.length === 0 ? (
            <div className="sidebar-empty">—</div>
          ) : (
            sessions.map((s) => {
              const running = s.endedAt === null;
              return (
                <div
                  key={s.id}
                  className={`sidebar-row session ${
                    currentSessionId === s.id ? "active" : ""
                  }`}
                  onClick={() => onResumeSession(s.id)}
                  title={s.title || s.preview || s.id}
                >
                  <span
                    className={`sidebar-dot ${running ? "running" : "idle"}`}
                  />
                  <span className="sidebar-row-label">
                    {s.title || s.preview || s.id.slice(0, 8)}
                  </span>
                  {s.messageCount > 0 && (
                    <span className="sidebar-row-count">{s.messageCount}</span>
                  )}
                </div>
              );
            })
          )}
        </Section>

        {/* Configuration section */}
        <Section
          id="configuration"
          icon={SettingsIcon}
          label={t("navigation.sectionConfiguration")}
          count={CONFIG_NAV.length}
          collapsed={!!collapsed.configuration}
          onToggle={toggleSection}
        >
          {CONFIG_NAV.map(({ view: v, icon: Icon, labelKey }) => (
            <button
              key={v}
              className={`sidebar-nav-item nested ${
                view === v ? "active" : ""
              }`}
              onClick={() => goTo(v)}
            >
              <Icon size={15} />
              <span className="sidebar-row-label">{t(labelKey)}</span>
              {v === "gateway" && (
                <span
                  className={`sidebar-dot ${gatewayUp ? "running" : "idle"}`}
                />
              )}
            </button>
          ))}
        </Section>
      </div>

      {/* Footer: auto-update button (from Layout) + Settings */}
      <div className="sidebar-footer">
        {footerSlot}
        <div className="sidebar-settings-row">
          <button
            className={`sidebar-nav-item ${view === "settings" ? "active" : ""}`}
            onClick={() => goTo("settings")}
          >
            <SettingsIcon size={16} />
            {t("navigation.settings")}
          </button>
          <button
            className="sidebar-help-btn"
            title={t("navigation.help")}
            onClick={() =>
              window.hermesAPI.openExternal(
                "https://github.com/fathah/hermes-desktop",
              )
            }
          >
            <HelpCircle size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}

interface SectionProps {
  id: string;
  icon: LucideIcon;
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: (id: string) => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}

/** Collapsible sidebar section with an icon, count badge and chevron. */
function Section({
  id,
  icon: Icon,
  label,
  count,
  collapsed,
  onToggle,
  action,
  children,
}: SectionProps): React.JSX.Element {
  return (
    <div className="sidebar-section">
      <div
        className="sidebar-section-header"
        onClick={() => onToggle(id)}
        role="button"
      >
        <ChevronRight
          size={14}
          className={`sidebar-section-caret ${collapsed ? "" : "open"}`}
        />
        <Icon size={15} className="sidebar-section-icon" />
        <span className="sidebar-section-label">{label}</span>
        <span className="sidebar-count-badge">{count}</span>
        {action}
      </div>
      {!collapsed && <div className="sidebar-section-body">{children}</div>}
    </div>
  );
}

export default Sidebar;
