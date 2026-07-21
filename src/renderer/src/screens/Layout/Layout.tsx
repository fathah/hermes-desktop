import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import Chat, { ChatMessage } from "../Chat/Chat";
import Sessions from "../Sessions/Sessions";
import Agents from "../Agents/Agents";
import Settings from "../Settings/Settings";
import Skills from "../Skills/Skills";
import Soul from "../Soul/Soul";
import Memory from "../Memory/Memory";
import Tools from "../Tools/Tools";
import Gateway from "../Gateway/Gateway";
import Office from "../Office/Office";
import Models from "../Models/Models";
import Schedules from "../Schedules/Schedules";
import HccWorkspaceViews from "./HccWorkspaceViews";
import { HCC_VIEW_REQUEST_EVENT } from "../ExecutionCenter/ExecutionCenter";
import RemoteNotice from "../../components/RemoteNotice";
import Spotlight from "../../components/Spotlight";
import HomeDashboard from "../../components/HomeDashboard";
import HomeEvents from "../../components/HomeEvents";
import HomeLaunchers from "../../components/HomeLaunchers";
import HomePresets from "../../components/HomePresets";
import HomeRecentPrompts from "../../components/HomeRecentPrompts";
import HomeResume from "../../components/HomeResume";
import HomeTaskQueue from "../../components/HomeTaskQueue";
import HomeWorkflowCombos from "../../components/HomeWorkflowCombos";
import hermeslogo from "../../assets/hermes.png";
import {
  ChatBubble,
  Clock,
  Users,
  Settings as SettingsIcon,
  Puzzle,
  Sparkles,
  Brain,
  Wrench,
  Signal,
  Building,
  Layers,
  Timer,
  Download,
} from "../../assets/icons";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "../../components/useI18n";

type View =
  | "war-room"
  | "control-plane"
  | "projects"
  | "project-detail"
  | "domains"
  | "domain-detail"
  | "hcc-memory"
  | "review-center"
  | "registry-manager"
  | "graph-center"
  | "clone-remix"
  | "opportunity-radar"
  | "learning-engine"
  | "gateway-map"
  | "intelligence-fabric"
  | "execution-center"
  | "capture-inbox"
  | "decision-center"
  | "relationship-center"
  | "chat"
  | "sessions"
  | "agents"
  | "office"
  | "models"
  | "skills"
  | "soul"
  | "memory"
  | "tools"
  | "schedules"
  | "gateway"
  | "settings";

interface LauncherCard {
  key: string;
  label: string;
  description: string;
  rank: number;
  onClick: () => void;
}

interface RecentShellSession {
  id: string;
  title: string;
  startedAt: number;
}

interface DashboardMetric {
  key: string;
  label: string;
  value: string;
  detail: string;
}

interface QuickToggle {
  key: string;
  label: string;
  enabled: boolean;
  onToggle: () => void;
}

interface WorkspacePreset {
  id: string;
  label: string;
  view: string;
  profile: string;
}

interface PinnedSession {
  id: string;
  title: string;
}

interface LastSessionSnapshot {
  id: string;
  title: string;
  profile: string;
  startedAt: number;
}

interface RecentPrompt {
  id: string;
  text: string;
  profile: string;
  timestamp: number;
}

interface WorkflowPreset {
  id: string;
  label: string;
  presetId: string;
  promptText: string;
  profile: string;
  createdAt: number;
  startup: boolean;
}

interface WorkflowRecall {
  id: string;
  label: string;
  profile: string;
  promptText: string;
  startup: boolean;
  ranAt: number;
}

interface TaskQueueItem {
  id: string;
  title: string;
  detail: string;
  status: "pending" | "done";
  workflowId?: string;
  workflowLabel?: string;
}

interface SectionPrefs {
  presets: boolean;
  resume: boolean;
  prompts: boolean;
  queue: boolean;
  workflows: boolean;
  dashboard: boolean;
  launchers: boolean;
  events: boolean;
}

type HomeSectionKey = keyof SectionPrefs;

interface ToastItem {
  id: string;
  title: string;
  tone: "info" | "success" | "warning" | "error";
}

interface EventItem {
  id: string;
  title: string;
  detail: string;
  timestamp: number;
  tone: "info" | "success" | "warning" | "error";
}

const DASHBOARD_WIDGETS = ["gateway", "profiles", "model", "schedules"] as const;
type DashboardWidgetKey = (typeof DASHBOARD_WIDGETS)[number];

const STORAGE_KEYS = {
  shellView: "hcc-os-shell-view",
  shellProfile: "hcc-os-shell-profile",
  recentActions: "hcc-os-shell-recent-actions",
  pinnedActions: "hcc-os-shell-pinned-actions",
  eventCenter: "hcc-os-shell-event-center",
  widgetPrefs: "hcc-os-shell-widget-prefs",
  presets: "hcc-os-shell-presets",
  pinnedSessions: "hcc-os-shell-pinned-sessions",
  lastSession: "hcc-os-shell-last-session",
  startupPreset: "hcc-os-shell-startup-preset",
  recentPrompts: "hcc-os-shell-recent-prompts",
  taskQueue: "hcc-os-shell-task-queue",
  sectionPrefs: "hcc-os-shell-section-prefs",
  compactMode: "hcc-os-shell-compact-mode",
  sectionOrder: "hcc-os-shell-section-order",
  workflowPresets: "hcc-os-shell-workflow-presets",
  lastWorkflow: "hcc-os-shell-last-workflow",
} as const;

const NAV_ITEMS: { view: View; icon: LucideIcon; labelKey: string; label?: string; eyebrow: string }[] = [
  { view: "war-room", icon: Download, labelKey: "navigation.chat", label: "Home", eyebrow: "Overview" },
  { view: "control-plane", icon: Users, labelKey: "navigation.agents", label: "Control Plane", eyebrow: "Missions" },
  { view: "intelligence-fabric", icon: Layers, labelKey: "navigation.gateway", label: "Intelligence", eyebrow: "Attention" },
  { view: "execution-center", icon: Wrench, labelKey: "navigation.tools", label: "Executions", eyebrow: "Approvals" },
  { view: "capture-inbox", icon: Download, labelKey: "navigation.chat", label: "Capture", eyebrow: "Ingress" },
  { view: "decision-center", icon: Sparkles, labelKey: "navigation.office", label: "Decisions", eyebrow: "Alignment" },
  { view: "relationship-center", icon: Users, labelKey: "navigation.agents", label: "Relationships", eyebrow: "Care" },
  { view: "gateway-map", icon: Signal, labelKey: "navigation.gateway", label: "Gateway Map", eyebrow: "Fabric" },
  { view: "opportunity-radar", icon: Sparkles, labelKey: "navigation.office", label: "Opportunities", eyebrow: "Leverage" },
  { view: "learning-engine", icon: Brain, labelKey: "navigation.memory", label: "Learning", eyebrow: "Progression" },
  { view: "projects", icon: Building, labelKey: "navigation.office", label: "Projects", eyebrow: "Build" },
  { view: "domains", icon: Brain, labelKey: "navigation.memory", label: "Domains", eyebrow: "State" },
  { view: "hcc-memory", icon: Brain, labelKey: "navigation.memory", label: "Memory", eyebrow: "Context" },
  { view: "review-center", icon: Clock, labelKey: "navigation.sessions", label: "Review", eyebrow: "Steering" },
  { view: "registry-manager", icon: SettingsIcon, labelKey: "navigation.settings", label: "Registry", eyebrow: "Governance" },
  { view: "graph-center", icon: Layers, labelKey: "navigation.memory", label: "Graph", eyebrow: "Relations" },
  { view: "clone-remix", icon: Download, labelKey: "navigation.office", label: "Clone / Remix", eyebrow: "Studio" },
  { view: "chat", icon: ChatBubble, labelKey: "navigation.chat", eyebrow: "Live" },
  { view: "sessions", icon: Clock, labelKey: "navigation.sessions", eyebrow: "Recall" },
  { view: "agents", icon: Users, labelKey: "navigation.agents", eyebrow: "Profiles" },
  { view: "office", icon: Building, labelKey: "navigation.office", eyebrow: "Workspace" },
  { view: "models", icon: Layers, labelKey: "navigation.models", eyebrow: "Inference" },
  { view: "skills", icon: Puzzle, labelKey: "navigation.skills", eyebrow: "Playbooks" },
  { view: "soul", icon: Sparkles, labelKey: "navigation.soul", eyebrow: "Persona" },
  { view: "memory", icon: Brain, labelKey: "navigation.memory", eyebrow: "Recall" },
  { view: "tools", icon: Wrench, labelKey: "navigation.tools", eyebrow: "Runtime" },
  { view: "schedules", icon: Timer, labelKey: "navigation.schedules", eyebrow: "Automation" },
  { view: "gateway", icon: Signal, labelKey: "navigation.gateway", eyebrow: "Delivery" },
  { view: "settings", icon: SettingsIcon, labelKey: "navigation.settings", eyebrow: "Config" },
];

const HCC_WORKSPACE_VIEWS = new Set<View>([
  "war-room",
  "control-plane",
  "projects",
  "project-detail",
  "domains",
  "domain-detail",
  "hcc-memory",
  "review-center",
  "registry-manager",
  "graph-center",
  "clone-remix",
  "opportunity-radar",
  "learning-engine",
  "gateway-map",
  "intelligence-fabric",
  "execution-center",
  "capture-inbox",
  "decision-center",
  "relationship-center",
]);

function readStoredView(): View {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.shellView);
    if (!raw) return "war-room";
    const valid = NAV_ITEMS.some((item) => item.view === raw);
    return valid ? (raw as View) : "war-room";
  } catch {
    return "war-room";
  }
}

function readStoredProfile(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.shellProfile) || "default";
  } catch {
    return "default";
  }
}

function readStoredRecentActions(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.recentActions);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function readStoredPinnedActions(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.pinnedActions);
    if (!raw) return ["action:new-chat", "action:search-sessions"];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return ["action:new-chat", "action:search-sessions"];
  }
}

function readStoredEvents(): EventItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.eventCenter);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is EventItem =>
        typeof item?.id === "string" &&
        typeof item?.title === "string" &&
        typeof item?.detail === "string" &&
        typeof item?.timestamp === "number" &&
        typeof item?.tone === "string",
    );
  } catch {
    return [];
  }
}

function readStoredWidgets(): DashboardWidgetKey[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.widgetPrefs);
    if (!raw) return [...DASHBOARD_WIDGETS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DASHBOARD_WIDGETS];
    const filtered = parsed.filter((item): item is DashboardWidgetKey =>
      DASHBOARD_WIDGETS.includes(item as DashboardWidgetKey),
    );
    return filtered.length > 0 ? filtered : [...DASHBOARD_WIDGETS];
  } catch {
    return [...DASHBOARD_WIDGETS];
  }
}

function readStoredPresets(): WorkspacePreset[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.presets);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is WorkspacePreset =>
            typeof item?.id === "string" &&
            typeof item?.label === "string" &&
            typeof item?.view === "string" &&
            typeof item?.profile === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function readStoredPinnedSessions(): PinnedSession[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.pinnedSessions);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is PinnedSession =>
            typeof item?.id === "string" && typeof item?.title === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function readStoredLastSession(): LastSessionSnapshot | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.lastSession);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed &&
      typeof parsed.id === "string" &&
      typeof parsed.title === "string" &&
      typeof parsed.profile === "string" &&
      typeof parsed.startedAt === "number"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function readStoredStartupPreset(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.startupPreset);
  } catch {
    return null;
  }
}

function readStoredRecentPrompts(): RecentPrompt[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.recentPrompts);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is RecentPrompt =>
            typeof item?.id === "string" &&
            typeof item?.text === "string" &&
            typeof item?.profile === "string" &&
            typeof item?.timestamp === "number",
        )
      : [];
  } catch {
    return [];
  }
}

function readStoredTaskQueue(): TaskQueueItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.taskQueue);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is TaskQueueItem =>
            typeof item?.id === "string" &&
            typeof item?.title === "string" &&
            typeof item?.detail === "string" &&
            (item?.status === "pending" || item?.status === "done"),
        )
      : [];
  } catch {
    return [];
  }
}

function readStoredSectionPrefs(): SectionPrefs {
  const fallback: SectionPrefs = {
    presets: true,
    resume: true,
    prompts: true,
    queue: true,
    workflows: true,
    dashboard: true,
    launchers: true,
    events: true,
  };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.sectionPrefs);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return { ...fallback, ...(typeof parsed === "object" && parsed ? parsed : {}) };
  } catch {
    return fallback;
  }
}

function readStoredCompactMode(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.compactMode) === "true";
  } catch {
    return false;
  }
}

function defaultSectionOrder(): HomeSectionKey[] {
  return ["dashboard", "launchers", "resume", "presets", "prompts", "workflows", "queue", "events"];
}

function readStoredSectionOrder(): HomeSectionKey[] {
  const fallback = defaultSectionOrder();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.sectionOrder);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    const valid = parsed.filter((item): item is HomeSectionKey => fallback.includes(item as HomeSectionKey));
    const missing = fallback.filter((item) => !valid.includes(item));
    return [...valid, ...missing];
  } catch {
    return fallback;
  }
}

function readStoredWorkflowPresets(): WorkflowPreset[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.workflowPresets);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is WorkflowPreset =>
            typeof item?.id === "string" &&
            typeof item?.label === "string" &&
            typeof item?.presetId === "string" &&
            typeof item?.promptText === "string" &&
            typeof item?.profile === "string" &&
            typeof item?.createdAt === "number" &&
            typeof item?.startup === "boolean",
        )
      : [];
  } catch {
    return [];
  }
}

function readStoredLastWorkflow(): WorkflowRecall | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.lastWorkflow);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed &&
      typeof parsed.id === "string" &&
      typeof parsed.label === "string" &&
      typeof parsed.profile === "string" &&
      typeof parsed.promptText === "string" &&
      typeof parsed.startup === "boolean" &&
      typeof parsed.ranAt === "number"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function Layout(): React.JSX.Element {
  const { t } = useI18n();
  const [view, setView] = useState<View>(() => readStoredView());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);
  const [activeProfile, setActiveProfile] = useState(() => readStoredProfile());
  const [officeVisited, setOfficeVisited] = useState(() => readStoredView() === "office");
  const [remoteMode, setRemoteMode] = useState(false);
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [booting, setBooting] = useState(true);
  const [recentSessions, setRecentSessions] = useState<RecentShellSession[]>([]);
  const [recentActionIds, setRecentActionIds] = useState<string[]>(() => readStoredRecentActions());
  const [pinnedActionIds, setPinnedActionIds] = useState<string[]>(() => readStoredPinnedActions());
  const [gatewayRunning, setGatewayRunning] = useState(false);
  const [profileCount, setProfileCount] = useState(0);
  const [modelLabel, setModelLabel] = useState("Not set");
  const [scheduleCount, setScheduleCount] = useState(0);
  const [events, setEvents] = useState<EventItem[]>(() => readStoredEvents());
  const [visibleWidgets, setVisibleWidgets] = useState<DashboardWidgetKey[]>(() => readStoredWidgets());
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [connectionMode, setConnectionMode] = useState<"local" | "remote">("local");
  const [remoteHealthy, setRemoteHealthy] = useState<boolean | null>(null);
  const [providerLabel, setProviderLabel] = useState("unknown");
  const [platformEnabled, setPlatformEnabled] = useState<Record<string, boolean>>({});
  const [quickSettingsOpen, setQuickSettingsOpen] = useState(false);
  const [workspacePresets, setWorkspacePresets] = useState<WorkspacePreset[]>(() => readStoredPresets());
  const [pinnedSessions, setPinnedSessions] = useState<PinnedSession[]>(() => readStoredPinnedSessions());
  const [lastSession, setLastSession] = useState<LastSessionSnapshot | null>(() => readStoredLastSession());
  const [startupPresetId, setStartupPresetId] = useState<string | null>(() => readStoredStartupPreset());
  const [recentPrompts, setRecentPrompts] = useState<RecentPrompt[]>(() => readStoredRecentPrompts());
  const [taskQueue, setTaskQueue] = useState<TaskQueueItem[]>(() => readStoredTaskQueue());
  const [sectionPrefs, setSectionPrefs] = useState<SectionPrefs>(() => readStoredSectionPrefs());
  const [compactMode, setCompactMode] = useState<boolean>(() => readStoredCompactMode());
  const [sectionOrder, setSectionOrder] = useState<HomeSectionKey[]>(() => readStoredSectionOrder());
  const [workflowPresets, setWorkflowPresets] = useState<WorkflowPreset[]>(() => readStoredWorkflowPresets());
  const [lastWorkflow, setLastWorkflow] = useState<WorkflowRecall | null>(() => readStoredLastWorkflow());
  const startupWorkflowAppliedRef = useRef(false);
  const skipStartupWorkflowRef = useRef(false);

  useEffect(() => {
    window.hermesAPI.isRemoteMode().then(setRemoteMode);
  }, [view]);

  useEffect(() => {
    const refreshOperationalState = async (): Promise<void> => {
      const [gateway, profiles, modelConfig, cronJobs, connectionConfig, platforms, cachedSessions] = await Promise.all([
        window.hermesAPI.gatewayStatus(),
        window.hermesAPI.listProfiles(),
        window.hermesAPI.getModelConfig(activeProfile),
        window.hermesAPI.listCronJobs(undefined, activeProfile),
        window.hermesAPI.getConnectionConfig(),
        window.hermesAPI.getPlatformEnabled(activeProfile),
        window.hermesAPI.listCachedSessions(6),
      ]);

      setGatewayRunning(gateway);
      setProfileCount(profiles.length);
      setModelLabel(modelConfig.model || "Not set");
      setProviderLabel(modelConfig.provider || "unknown");
      setScheduleCount(cronJobs.length);
      setConnectionMode(connectionConfig.mode);
      const nextRemoteMode = connectionConfig.mode === "remote";
      setRemoteMode(nextRemoteMode);
      setPlatformEnabled(platforms);
      setRecentSessions(
        cachedSessions.slice(0, 4).map((session) => ({
          id: session.id,
          title: session.title || "Untitled session",
          startedAt: session.startedAt,
        })),
      );

      if (connectionConfig.mode === "remote") {
        const ok = await window.hermesAPI.testRemoteConnection(
          connectionConfig.remoteUrl,
          connectionConfig.apiKey,
        );
        setRemoteHealthy(ok);
      } else {
        setRemoteHealthy(null);
      }
    };


    void refreshOperationalState();
    const interval = window.setInterval(() => {
      void refreshOperationalState();
    }, 15000);

    return () => window.clearInterval(interval);
  }, [activeProfile]);

  useEffect(() => {
    if (!startupPresetId) return;
    const preset = workspacePresets.find((item) => item.id === startupPresetId);
    if (!preset) return;
    setActiveProfile(preset.profile);
    setView(preset.view as View);
    if (preset.view === "office") setOfficeVisited(true);
  }, [startupPresetId, workspacePresets]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.shellView, view);
    } catch {
      /* ignore */
    }
  }, [view]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.shellProfile, activeProfile);
    } catch {
      /* ignore */
    }
  }, [activeProfile]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEYS.recentActions,
        JSON.stringify(recentActionIds.slice(0, 10)),
      );
    } catch {
      /* ignore */
    }
  }, [recentActionIds]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEYS.pinnedActions,
        JSON.stringify(pinnedActionIds.slice(0, 8)),
      );
    } catch {
      /* ignore */
    }
  }, [pinnedActionIds]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEYS.eventCenter,
        JSON.stringify(events.slice(0, 20)),
      );
    } catch {
      /* ignore */
    }
  }, [events]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEYS.widgetPrefs,
        JSON.stringify(visibleWidgets),
      );
    } catch {
      /* ignore */
    }
  }, [visibleWidgets]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEYS.presets,
        JSON.stringify(workspacePresets),
      );
    } catch {
      /* ignore */
    }
  }, [workspacePresets]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEYS.pinnedSessions,
        JSON.stringify(pinnedSessions),
      );
    } catch {
      /* ignore */
    }
  }, [pinnedSessions]);

  useEffect(() => {
    try {
      if (lastSession) {
        window.localStorage.setItem(STORAGE_KEYS.lastSession, JSON.stringify(lastSession));
      } else {
        window.localStorage.removeItem(STORAGE_KEYS.lastSession);
      }
    } catch {
      /* ignore */
    }
  }, [lastSession]);

  useEffect(() => {
    try {
      if (startupPresetId) {
        window.localStorage.setItem(STORAGE_KEYS.startupPreset, startupPresetId);
      } else {
        window.localStorage.removeItem(STORAGE_KEYS.startupPreset);
      }
    } catch {
      /* ignore */
    }
  }, [startupPresetId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEYS.recentPrompts,
        JSON.stringify(recentPrompts.slice(0, 8)),
      );
    } catch {
      /* ignore */
    }
  }, [recentPrompts]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEYS.taskQueue,
        JSON.stringify(taskQueue.slice(0, 6)),
      );
    } catch {
      /* ignore */
    }
  }, [taskQueue]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.sectionPrefs, JSON.stringify(sectionPrefs));
      window.localStorage.setItem(STORAGE_KEYS.compactMode, compactMode ? "true" : "false");
      window.localStorage.setItem(STORAGE_KEYS.sectionOrder, JSON.stringify(sectionOrder));
      window.localStorage.setItem(STORAGE_KEYS.workflowPresets, JSON.stringify(workflowPresets.slice(0, 6)));
    } catch {
      /* ignore */
    }
  }, [compactMode, sectionOrder, sectionPrefs, workflowPresets]);

  useEffect(() => {
    try {
      if (lastWorkflow) {
        window.localStorage.setItem(STORAGE_KEYS.lastWorkflow, JSON.stringify(lastWorkflow));
      } else {
        window.localStorage.removeItem(STORAGE_KEYS.lastWorkflow);
      }
    } catch {
      /* ignore */
    }
  }, [lastWorkflow]);

  const rememberAction = useCallback((actionId: string) => {
    setRecentActionIds((prev) => [actionId, ...prev.filter((item) => item !== actionId)].slice(0, 10));
  }, []);

  const pushEvent = useCallback((title: string, detail: string, tone: EventItem["tone"] = "info") => {
    setEvents((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        detail,
        timestamp: Date.now(),
        tone,
      },
      ...prev,
    ].slice(0, 12));

    const toastId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev, { id: toastId, title, tone }].slice(-4));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== toastId));
    }, 3200);
  }, []);

  const togglePinnedAction = useCallback((actionId: string) => {
    setPinnedActionIds((prev) =>
      prev.includes(actionId)
        ? prev.filter((item) => item !== actionId)
        : [actionId, ...prev].slice(0, 8),
    );
  }, []);

  const dismissEvent = useCallback((eventId: string) => {
    setEvents((prev) => prev.filter((event) => event.id !== eventId));
  }, []);

  const toggleWidget = useCallback((widget: DashboardWidgetKey) => {
    setVisibleWidgets((prev) => {
      if (prev.includes(widget)) {
        const next = prev.filter((item) => item !== widget);
        return next.length > 0 ? next : prev;
      }
      return [...prev, widget];
    });
  }, []);

  const togglePlatform = useCallback(
    async (platform: string) => {
      const nextEnabled = !platformEnabled[platform];
      await window.hermesAPI.setPlatformEnabled(platform, nextEnabled, activeProfile);
      setPlatformEnabled((prev) => ({ ...prev, [platform]: nextEnabled }));
      pushEvent(
        `${platform} ${nextEnabled ? "enabled" : "disabled"}`,
        `Gateway delivery for ${platform} was ${nextEnabled ? "enabled" : "disabled"}`,
        nextEnabled ? "success" : "warning",
      );
    },
    [activeProfile, platformEnabled, pushEvent],
  );

  const toggleConnectionMode = useCallback(async () => {
    const nextMode = connectionMode === "local" ? "remote" : "local";
    const config = await window.hermesAPI.getConnectionConfig();
    await window.hermesAPI.setConnectionConfig(nextMode, config.remoteUrl, config.apiKey);
    setConnectionMode(nextMode);
    setRemoteMode(nextMode === "remote");
    pushEvent(
      `Connection switched to ${nextMode}`,
      `HCC OS shell moved into ${nextMode} runtime mode`,
      "info",
    );
  }, [connectionMode, pushEvent]);

  const saveWorkspacePreset = useCallback(() => {
    const preset: WorkspacePreset = {
      id: `${Date.now()}`,
      label: `${view} · ${activeProfile}`,
      view,
      profile: activeProfile,
    };
    setWorkspacePresets((prev) => [preset, ...prev].slice(0, 8));
    pushEvent("Workspace preset saved", `Saved ${preset.label}`, "success");
  }, [activeProfile, pushEvent, view]);

  const renameWorkspacePreset = useCallback(
    (presetId: string) => {
      const current = workspacePresets.find((preset) => preset.id === presetId);
      if (!current) return;
      const nextLabel = window.prompt("Rename preset", current.label)?.trim();
      if (!nextLabel) return;
      setWorkspacePresets((prev) =>
        prev.map((preset) => (preset.id === presetId ? { ...preset, label: nextLabel } : preset)),
      );
      pushEvent("Workspace preset renamed", `Renamed preset to ${nextLabel}`, "info");
    },
    [pushEvent, workspacePresets],
  );

  const deleteWorkspacePreset = useCallback(
    (presetId: string) => {
      const current = workspacePresets.find((preset) => preset.id === presetId);
      setWorkspacePresets((prev) => prev.filter((preset) => preset.id !== presetId));
      if (current) {
        pushEvent("Workspace preset deleted", `Removed ${current.label}`, "warning");
      }
    },
    [pushEvent, workspacePresets],
  );

  const applyWorkspacePreset = useCallback(
    (preset: WorkspacePreset) => {
      setActiveProfile(preset.profile);
      setView(preset.view as View);
      if (preset.view === "office") setOfficeVisited(true);
      pushEvent("Workspace preset applied", `Loaded ${preset.label}`, "success");
    },
    [pushEvent],
  );

  const applyWorkspacePresetById = useCallback(
    (presetId: string) => {
      const preset = workspacePresets.find((item) => item.id === presetId);
      if (preset) applyWorkspacePreset(preset);
    },
    [applyWorkspacePreset, workspacePresets],
  );

  const setStartupPreset = useCallback(
    (presetId: string | null) => {
      setStartupPresetId(presetId);
      if (presetId) {
        const preset = workspacePresets.find((item) => item.id === presetId);
        if (preset) {
          pushEvent("Startup preset set", `Startup will load ${preset.label}`, "success");
        }
      } else {
        pushEvent("Startup preset cleared", "Default startup continuity restored", "warning");
      }
    },
    [pushEvent, workspacePresets],
  );

  const togglePinnedSession = useCallback((session: PinnedSession) => {
    setPinnedSessions((prev) =>
      prev.some((item) => item.id === session.id)
        ? prev.filter((item) => item.id !== session.id)
        : [session, ...prev].slice(0, 8),
    );
    pushEvent("Pinned sessions updated", `Session ${session.title} preference changed`, "info");
  }, [pushEvent]);

  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<
    "available" | "downloading" | "ready" | null
  >(null);
  const [downloadPercent, setDownloadPercent] = useState(0);

  useEffect(() => {
    const cleanupAvailable = window.hermesAPI.onUpdateAvailable((info) => {
      setUpdateVersion(info.version);
      setUpdateState("available");
      pushEvent("Update available", `Version ${info.version} is ready to download`, "warning");
    });
    const cleanupProgress = window.hermesAPI.onUpdateDownloadProgress((info) => {
      setDownloadPercent(info.percent);
    });
    const cleanupDownloaded = window.hermesAPI.onUpdateDownloaded(() => {
      setUpdateState("ready");
      pushEvent("Update downloaded", "Restart the shell to install the new build", "success");
    });
    return () => {
      cleanupAvailable();
      cleanupProgress();
      cleanupDownloaded();
    };
  }, [pushEvent]);

  async function handleUpdate(): Promise<void> {
    if (updateState === "available") {
      setUpdateState("downloading");
      await window.hermesAPI.downloadUpdate();
    } else if (updateState === "ready") {
      await window.hermesAPI.installUpdate();
    }
  }

  const handleNewChat = useCallback(() => {
    rememberAction("action:new-chat");
    pushEvent("New chat started", `Profile ${activeProfile} opened a fresh operator thread`, "success");
    window.hermesAPI.abortChat();
    setMessages([]);
    setCurrentSessionId(null);
    setView(remoteMode ? "war-room" : "chat");
  }, [activeProfile, pushEvent, rememberAction, remoteMode]);

  const handleNavigate = useCallback(
    (nextView: string) => {
      rememberAction(`view:${nextView}`);
      if (nextView === "office") setOfficeVisited(true);
      setView(nextView as View);
    },
    [rememberAction],
  );

  useEffect(() => {
    const handler = (event: Event): void => {
      const nextView = (event as CustomEvent<{ view?: string }>).detail?.view;
      if (typeof nextView === "string") handleNavigate(nextView);
    };
    window.addEventListener(HCC_VIEW_REQUEST_EVENT, handler as EventListener);
    return () => window.removeEventListener(HCC_VIEW_REQUEST_EVENT, handler as EventListener);
  }, [handleNavigate]);

  const handleSearchSessions = useCallback(() => {
    rememberAction("action:search-sessions");
    pushEvent("Session search opened", "Recent session recall is now in focus", "info");
    setView("sessions");
  }, [pushEvent, rememberAction]);

  const handleOpenProject = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    setView("project-detail");
  }, []);

  const handleOpenDomain = useCallback((domainId: string) => {
    setSelectedDomainId(domainId);
    setView("domain-detail");
  }, []);

  const handleSnapWindow = useCallback(async () => {
    rememberAction("action:snap-window");
    pushEvent("Window snapped", "HCC OS aligned the shell to the nearest screen edge", "info");
    await window.hermesAPI.snapWindowToEdge();
  }, [pushEvent, rememberAction]);

  const handleResumeRecentSession = useCallback(
    async (sessionId: string) => {
      rememberAction(`recent-session:${sessionId}`);
      pushEvent("Recent session resumed", `Session ${sessionId.slice(0, 8)} is now active`, "success");
      const dbMessages = await window.hermesAPI.getSessionMessages(sessionId);
      const chatMessages: ChatMessage[] = dbMessages.map((msg) => ({
        id: `db-${msg.id}`,
        role: msg.role === "user" ? "user" : "agent",
        content: msg.content,
      }));
      const title = dbMessages.find((msg) => msg.role === "user")?.content?.slice(0, 72) || "Untitled session";
      setMessages(chatMessages);
      setCurrentSessionId(sessionId);
      setView("chat");
      setLastSession({
        id: sessionId,
        title,
        profile: activeProfile,
        startedAt: Math.floor(Date.now() / 1000),
      });
    },
    [activeProfile, pushEvent, rememberAction],
  );

  useEffect(() => {
    const initialBootTimer = window.setTimeout(() => setBooting(false), 2200);
    return () => window.clearTimeout(initialBootTimer);
  }, []);

  useEffect(() => {
    const cleanupNewChat = window.hermesAPI.onMenuNewChat(() => {
      handleNewChat();
    });
    const cleanupSearch = window.hermesAPI.onMenuSearchSessions(() => {
      handleSearchSessions();
    });
    const cleanupSpotlight = window.hermesAPI.onSpotlightToggle(() => {
      setSpotlightOpen((prev) => !prev);
    });
    const cleanupBoot = window.hermesAPI.onBootSequence(() => {
      startupWorkflowAppliedRef.current = false;
      skipStartupWorkflowRef.current = false;
      setBooting(true);
      window.setTimeout(() => setBooting(false), 2200);
    });
    return () => {
      cleanupNewChat();
      cleanupSearch();
      cleanupSpotlight();
      cleanupBoot();
    };
  }, [handleNewChat, handleSearchSessions]);

  const handleSelectProfile = useCallback((name: string) => {
    setActiveProfile(name);
    setMessages([]);
    setCurrentSessionId(null);
  }, []);

  const handleResumeSession = useCallback(
    async (sessionId: string) => {
      await handleResumeRecentSession(sessionId);
    },
    [handleResumeRecentSession],
  );

  const launcherCards = useMemo<LauncherCard[]>(() => {
    const rankBoost = (id: string, base: number): number => {
      const recentIdx = recentActionIds.indexOf(id);
      const pinBoost = pinnedActionIds.includes(id) ? 20 : 0;
      const recentBoost = recentIdx === -1 ? 0 : Math.max(0, 6 - recentIdx);
      return base + pinBoost + recentBoost;
    };

    return [
      {
        key: "intelligence-fabric",
        label: "Open Intelligence",
        description: "Stage recommendations into governed execution.",
        rank: rankBoost("view:intelligence-fabric", 90),
        onClick: () => handleNavigate("intelligence-fabric"),
      },
      {
        key: "execution-center",
        label: "Open Executions",
        description: "Approve, dispatch, and verify governed runs.",
        rank: rankBoost("view:execution-center", 88),
        onClick: () => handleNavigate("execution-center"),
      },
      {
        key: "new-chat",
        label: "Start a new chat",
        description: "Reset the shell into a fresh operator thread.",
        rank: rankBoost("action:new-chat", 60),
        onClick: handleNewChat,
      },
      {
        key: "resume-sessions",
        label: "Resume recent sessions",
        description: "Jump into recall and continue prior runs.",
        rank: rankBoost("action:search-sessions", 58),
        onClick: handleSearchSessions,
      },
      {
        key: "snap-window",
        label: "Align the window",
        description: "Use HCC OS snap-to-edge placement right now.",
        rank: rankBoost("action:snap-window", 56),
        onClick: () => {
          void handleSnapWindow();
        },
      },
    ].sort((a, b) => b.rank - a.rank);
  }, [handleNewChat, handleSearchSessions, handleSnapWindow, pinnedActionIds, recentActionIds]);

  const pinnedCards = useMemo(
    () =>
      launcherCards.filter((card) =>
        pinnedActionIds.includes(
          card.key === "new-chat"
            ? "action:new-chat"
            : card.key === "resume-sessions"
              ? "action:search-sessions"
              : "action:snap-window",
        ),
      ),
    [launcherCards, pinnedActionIds],
  );

  const dashboardMetrics = useMemo<DashboardMetric[]>(
    () =>
      [
        {
          key: "gateway",
          label: "Gateway",
          value: gatewayRunning ? "Online" : "Offline",
          detail: gatewayRunning ? "Delivery bridge ready" : "Start platform bridge",
        },
        {
          key: "profiles",
          label: "Profiles",
          value: String(profileCount),
          detail: "Installed operator profiles",
        },
        {
          key: "model",
          label: "Model",
          value: modelLabel.split("/").pop() || modelLabel,
          detail: `Provider ${providerLabel}`,
        },
        {
          key: "schedules",
          label: "Schedules",
          value: String(scheduleCount),
          detail: "Automation jobs configured",
        },
      ].filter((metric) => visibleWidgets.includes(metric.key as DashboardWidgetKey)),
    [gatewayRunning, modelLabel, profileCount, providerLabel, scheduleCount, visibleWidgets],
  );

  const rerunRecentPrompt = useCallback(
    (prompt: RecentPrompt) => {
      setMessages([
        {
          id: `draft-${Date.now()}`,
          role: "user",
          content: prompt.text,
        },
      ]);
      setCurrentSessionId(null);
      setView("chat");
      pushEvent("Recent prompt rerun", `Prompt from ${prompt.profile} moved into a fresh draft`, "success");
      setTaskQueue((prev) => [
        {
          id: `${Date.now()}`,
          title: "Follow up recent prompt",
          detail: prompt.text.slice(0, 88),
          status: "pending" as const,
        },
        ...prev,
      ].slice(0, 6));
    },
    [pushEvent],
  );

  const runWorkflowPreset = useCallback(
    (workflow: WorkflowPreset, options?: { silent?: boolean }) => {
      const preset = workspacePresets.find((item) => item.id === workflow.presetId);
      if (preset) {
        applyWorkspacePreset(preset);
      } else {
        setActiveProfile(workflow.profile);
      }
      setMessages([
        {
          id: `workflow-${Date.now()}`,
          role: "user",
          content: workflow.promptText,
        },
      ]);
      setCurrentSessionId(null);
      setView("chat");
      setLastWorkflow({
        id: workflow.id,
        label: workflow.label,
        profile: workflow.profile,
        promptText: workflow.promptText,
        startup: workflow.startup,
        ranAt: Date.now(),
      });
      if (!options?.silent) {
        pushEvent("Workflow loaded", `Loaded ${workflow.label}`, "success");
      }
      setTaskQueue((prev) => [
        {
          id: `${Date.now()}`,
          title: workflow.label,
          detail: workflow.promptText.slice(0, 88),
          status: "pending" as const,
          workflowId: workflow.id,
          workflowLabel: workflow.label,
        },
        ...prev,
      ].slice(0, 6));
    },
    [applyWorkspacePreset, pushEvent, workspacePresets],
  );

  useEffect(() => {
    if (skipStartupWorkflowRef.current || startupWorkflowAppliedRef.current || booting) return;
    const startupWorkflow = workflowPresets.find((item) => item.startup);
    if (!startupWorkflow) return;
    startupWorkflowAppliedRef.current = true;
    runWorkflowPreset(startupWorkflow, { silent: true });
    pushEvent("Startup workflow loaded", `Boot armed ${startupWorkflow.label}`, "success");
    setToasts((prev) => [
      {
        id: `${Date.now()}-startup-workflow`,
        title: `Startup workflow: ${startupWorkflow.label}`,
        tone: "success" as const,
      },
      ...prev,
    ].slice(0, 4));
  }, [booting, pushEvent, runWorkflowPreset, workflowPresets]);

  const saveWorkflowPreset = useCallback(
    (presetId: string, prompt: RecentPrompt) => {
      const preset = workspacePresets.find((item) => item.id === presetId);
      if (!preset) return;
      const label = `${preset.label} + ${prompt.text.slice(0, 32)}`;
      setWorkflowPresets((prev) => [
        {
          id: `${Date.now()}`,
          label,
          presetId,
          promptText: prompt.text,
          profile: preset.profile,
          createdAt: Date.now(),
          startup: false,
        },
        ...prev.filter((item) => !(item.presetId === presetId && item.promptText === prompt.text)),
      ].slice(0, 6));
      pushEvent("Workflow saved", `Saved ${label}`, "success");
    },
    [pushEvent, workspacePresets],
  );

  const deleteWorkflowPreset = useCallback(
    (workflowId: string) => {
      const workflow = workflowPresets.find((item) => item.id === workflowId);
      setWorkflowPresets((prev) => prev.filter((item) => item.id !== workflowId));
      if (workflow) {
        pushEvent("Workflow removed", `Removed ${workflow.label}`, "warning");
      }
    },
    [pushEvent, workflowPresets],
  );

  const renameWorkflowPreset = useCallback(
    (workflowId: string) => {
      const workflow = workflowPresets.find((item) => item.id === workflowId);
      if (!workflow) return;
      const nextLabel = window.prompt("Rename workflow", workflow.label)?.trim();
      if (!nextLabel) return;
      setWorkflowPresets((prev) =>
        prev.map((item) => (item.id === workflowId ? { ...item, label: nextLabel } : item)),
      );
      pushEvent("Workflow renamed", `Renamed workflow to ${nextLabel}`, "info");
    },
    [pushEvent, workflowPresets],
  );

  const setStartupWorkflowPreset = useCallback(
    (workflowId: string | null) => {
      if (workflowId === null) {
        skipStartupWorkflowRef.current = true;
      }
      setWorkflowPresets((prev) =>
        prev.map((item) => ({
          ...item,
          startup: workflowId !== null && item.id === workflowId,
        })),
      );
      if (workflowId) {
        const workflow = workflowPresets.find((item) => item.id === workflowId);
        if (workflow) pushEvent("Workflow startup set", `Startup workflow ${workflow.label} armed`, "success");
      } else {
        pushEvent("Workflow startup cleared", "Workflow startup disabled", "warning");
      }
    },
    [pushEvent, workflowPresets],
  );

  const toggleTaskQueueItem = useCallback((taskId: string) => {
    setTaskQueue((prev) =>
      prev.map((task) =>
        task.id === taskId
          ? { ...task, status: task.status === "pending" ? "done" : "pending" }
          : task,
      ),
    );
  }, []);

  const clearCompletedTasks = useCallback(() => {
    setTaskQueue((prev) => prev.filter((task) => task.status !== "done"));
    pushEvent("Completed tasks cleared", "Task queue removed finished operator follow-ups", "info");
  }, [pushEvent]);

  const openTaskQueueDraft = useCallback(
    (taskId: string) => {
      const task = taskQueue.find((item) => item.id === taskId);
      if (!task) return;
      setMessages([
        {
          id: `task-${Date.now()}`,
          role: "user",
          content: task.detail,
        },
      ]);
      setCurrentSessionId(null);
      setView("chat");
      pushEvent("Task opened", `Opened task ${task.title} in fresh draft`, "success");
    },
    [pushEvent, taskQueue],
  );

  const toggleSection = useCallback((key: keyof SectionPrefs) => {
    setSectionPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const moveSection = useCallback((key: HomeSectionKey, direction: "up" | "down") => {
    setSectionOrder((prev) => {
      const index = prev.indexOf(key);
      if (index === -1) return prev;
      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }, []);

  const shellContentClassName = compactMode ? "content-shell compact-mode" : "content-shell";

  const healthDiagnostics = useMemo(
    () => [
      {
        key: "connection",
        label: "Connection",
        value:
          connectionMode === "remote"
            ? remoteHealthy === null
              ? "Checking"
              : remoteHealthy
                ? "Healthy"
                : "Unreachable"
            : "Local",
        detail:
          connectionMode === "remote"
            ? remoteHealthy
              ? "Remote gateway reachable"
              : remoteHealthy === false
                ? "Remote gateway failed ping"
                : "Testing remote endpoint"
            : "Running on local Hermes runtime",
      },
      {
        key: "provider",
        label: "Provider",
        value: providerLabel,
        detail: `Model ${modelLabel.split("/").pop() || modelLabel}`,
      },
      {
        key: "platforms",
        label: "Gateway Platforms",
        value: `${Object.values(platformEnabled).filter(Boolean).length} active`,
        detail: Object.entries(platformEnabled)
          .filter(([, enabled]) => enabled)
          .map(([name]) => name)
          .join(", ") || "No platform delivery enabled",
      },
    ],
    [connectionMode, modelLabel, platformEnabled, providerLabel, remoteHealthy],
  );

  const quickToggles = useMemo<QuickToggle[]>(
    () => [
      {
        key: "connection-mode",
        label: connectionMode === "local" ? "Switch to remote mode" : "Switch to local mode",
        enabled: connectionMode === "remote",
        onToggle: () => {
          void toggleConnectionMode();
        },
      },
      ...Object.entries(platformEnabled).map(([platform, enabled]) => ({
        key: `platform:${platform}`,
        label: `Gateway ${platform}`,
        enabled,
        onToggle: () => {
          void togglePlatform(platform);
        },
      })),
    ],
    [connectionMode, platformEnabled, toggleConnectionMode, togglePlatform],
  );

  const currentNavItem = NAV_ITEMS.find((item) => item.view === view);
  const currentViewLabel = currentNavItem?.label ?? (currentNavItem ? t(currentNavItem.labelKey) : "Hermes");

  return (
    <div className="layout-shell">
      <div className="layout-shell-backdrop" />
      <div className="layout-frame">
        <aside className="sidebar">
          <div className="sidebar-brand-card">
            <div className="sidebar-brand-mark">
              <img src={hermeslogo} height={30} alt="" />
            </div>
            <div className="sidebar-brand-copy">
              <div className="sidebar-brand-kicker">HCC OS</div>
              <div className="sidebar-brand-name">Hermes Desktop</div>
              <div className="sidebar-brand-subtitle">Native control center</div>
            </div>
          </div>

          <button className="sidebar-launcher" onClick={() => setSpotlightOpen(true)}>
            <span className="sidebar-launcher-copy">
              <span className="sidebar-launcher-label">Open spotlight</span>
              <span className="sidebar-launcher-subtitle">Jump across routes, workflows, and sessions</span>
            </span>
            <span className="sidebar-launcher-shortcut">⌘/Ctrl + P</span>
          </button>

          <div className="sidebar-priority-links">
            <button className="sidebar-priority-link" onClick={() => handleNavigate("intelligence-fabric")}>
              <span className="sidebar-priority-link-label">Intelligence</span>
              <span className="sidebar-priority-link-eyebrow">Attention</span>
            </button>
            <button className="sidebar-priority-link" onClick={() => handleNavigate("execution-center")}>
              <span className="sidebar-priority-link-label">Executions</span>
              <span className="sidebar-priority-link-eyebrow">Approvals</span>
            </button>
          </div>

          <nav className="sidebar-nav">
            {NAV_ITEMS.map(({ view: v, icon: Icon, labelKey, label, eyebrow }) => (
              <button
                key={v}
                className={`sidebar-nav-item ${view === v ? "active" : ""}`}
                onClick={() => {
                  handleNavigate(v);
                }}
              >
                <span className="sidebar-nav-item-icon">
                  <Icon size={16} />
                </span>
                <span className="sidebar-nav-item-copy">
                  <span className="sidebar-nav-item-label">{label ?? t(labelKey)}</span>
                  <span className="sidebar-nav-item-eyebrow">{eyebrow}</span>
                </span>
              </button>
            ))}
          </nav>

          <div className="sidebar-footer">
            {updateState && (
              <button className="sidebar-update-btn" onClick={handleUpdate}>
                <Download size={13} />
                {updateState === "available" && (
                  <span>{t("common.updateAvailable", { version: updateVersion })}</span>
                )}
                {updateState === "downloading" && (
                  <span>{t("common.downloading", { percent: downloadPercent })}</span>
                )}
                {updateState === "ready" && <span>{t("common.restartToUpdate")}</span>}
              </button>
            )}
            <div className="sidebar-footer-meta">
              <div className="sidebar-footer-kicker">Active profile</div>
              <div className="sidebar-footer-text">
                {activeProfile === "default" ? t("common.appName") : activeProfile}
              </div>
              <div className="sidebar-footer-caption">
                {remoteMode ? "Remote operator lane active" : "Local operator lane active"}
              </div>
            </div>
          </div>
        </aside>

        <main className={shellContentClassName}>
          {!HCC_WORKSPACE_VIEWS.has(view) && (
            <div className="content-topbar">
              <div className="content-topbar-copy">
                <div className="content-topbar-kicker">Hermes</div>
                <div className="content-topbar-title">{currentViewLabel}</div>
              </div>
              <div className="content-topbar-badges">
                <span className="content-badge">{remoteMode ? "Remote" : "Local"}</span>
                <span className="content-badge">{activeProfile}</span>
              </div>
            </div>
          )}

          {!HCC_WORKSPACE_VIEWS.has(view) && (
          <div className="content-dashboard-toolbar">
            {DASHBOARD_WIDGETS.map((widget) => (
              <button
                key={widget}
                className={`content-widget-toggle ${visibleWidgets.includes(widget) ? "active" : ""}`}
                onClick={() => toggleWidget(widget)}
              >
                {widget}
              </button>
            ))}
            <button
              className={`content-widget-toggle ${compactMode ? "active" : ""}`}
              onClick={() => setCompactMode((prev) => !prev)}
            >
              compact mode
            </button>
            {([
              ["presets", "presets"],
              ["resume", "resume"],
              ["prompts", "prompts"],
              ["queue", "queue"],
              ["workflows", "workflows"],
              ["dashboard", "dashboard"],
              ["launchers", "launchers"],
              ["events", "events"],
            ] as const).map(([key, label]) => {
              const index = sectionOrder.indexOf(key);
              return (
                <span key={key} className="content-section-order-chip">
                  <button
                    className={`content-widget-toggle ${sectionPrefs[key] ? "active" : ""}`}
                    onClick={() => toggleSection(key)}
                  >
                    {label}
                  </button>
                  <button className="content-order-btn" onClick={() => moveSection(key, "up")} disabled={index <= 0}>
                    ↑
                  </button>
                  <button
                    className="content-order-btn"
                    onClick={() => moveSection(key, "down")}
                    disabled={index === -1 || index >= sectionOrder.length - 1}
                  >
                    ↓
                  </button>
                </span>
              );
            })}
            <button
              className={`content-widget-toggle ${quickSettingsOpen ? "active" : ""}`}
              onClick={() => setQuickSettingsOpen((prev) => !prev)}
            >
              quick settings
            </button>
            <button className="content-widget-toggle active" onClick={saveWorkspacePreset}>
              save preset
            </button>
          </div>
          )}

          {!HCC_WORKSPACE_VIEWS.has(view) && quickSettingsOpen && (
            <div className="content-quick-settings">
              {quickToggles.map((toggle) => (
                <button
                  key={toggle.key}
                  className={`content-quick-toggle ${toggle.enabled ? "active" : ""}`}
                  onClick={toggle.onToggle}
                >
                  <span>{toggle.label}</span>
                  <span>{toggle.enabled ? "On" : "Off"}</span>
                </button>
              ))}
            </div>
          )}

          {!HCC_WORKSPACE_VIEWS.has(view) && sectionOrder.map((sectionKey) => {
            switch (sectionKey) {
              case "presets":
                return sectionPrefs.presets ? (
                  <HomePresets
                    key={sectionKey}
                    presets={workspacePresets}
                    startupPresetId={startupPresetId}
                    onApplyPreset={applyWorkspacePreset}
                    onSetStartupPreset={setStartupPreset}
                    onRenamePreset={renameWorkspacePreset}
                    onDeletePreset={deleteWorkspacePreset}
                  />
                ) : null;
              case "resume":
                return sectionPrefs.resume ? (
                  <HomeResume
                    key={sectionKey}
                    lastSession={lastSession}
                    lastWorkflow={lastWorkflow}
                    onResumeSession={handleResumeRecentSession}
                    onResumeWorkflow={(workflowId) => {
                      const workflow = workflowPresets.find((item) => item.id === workflowId);
                      if (workflow) runWorkflowPreset(workflow);
                    }}
                  />
                ) : null;
              case "prompts":
                return sectionPrefs.prompts ? (
                  <HomeRecentPrompts
                    key={sectionKey}
                    prompts={recentPrompts}
                    presets={workspacePresets}
                    onRecall={(prompt) => {
                      setView("chat");
                      pushEvent("Recent prompt recalled", `Prompt from ${prompt.profile} brought back into focus`, "info");
                    }}
                    onRerun={rerunRecentPrompt}
                    onSaveWorkflow={saveWorkflowPreset}
                  />
                ) : null;
              case "workflows":
                return sectionPrefs.workflows ? (
                  <HomeWorkflowCombos
                    key={sectionKey}
                    workflows={workflowPresets}
                    onRunWorkflow={runWorkflowPreset}
                    onRenameWorkflow={renameWorkflowPreset}
                    onDeleteWorkflow={deleteWorkflowPreset}
                    onSetStartupWorkflow={setStartupWorkflowPreset}
                  />
                ) : null;
              case "queue":
                return sectionPrefs.queue ? (
                  <HomeTaskQueue
                    key={sectionKey}
                    tasks={taskQueue.map((task) => ({
                      ...task,
                      workflowLabel: task.workflowLabel,
                    }))}
                    onToggleTask={toggleTaskQueueItem}
                    onOpenTask={openTaskQueueDraft}
                    onClearCompleted={clearCompletedTasks}
                  />
                ) : null;
              case "dashboard":
                return sectionPrefs.dashboard ? (
                  <HomeDashboard
                    key={sectionKey}
                    metrics={dashboardMetrics}
                    health={healthDiagnostics}
                    onNavigateMetric={(metricKey) => {
                      if (metricKey === "gateway") handleNavigate("gateway");
                      if (metricKey === "profiles") handleNavigate("agents");
                      if (metricKey === "model") handleNavigate("models");
                      if (metricKey === "schedules") handleNavigate("schedules");
                    }}
                  />
                ) : null;
              case "launchers":
                return sectionPrefs.launchers ? (
                  <HomeLaunchers
                    key={sectionKey}
                    pinnedCards={pinnedCards}
                    launcherCards={launcherCards}
                    pinnedActionIds={pinnedActionIds}
                    pinnedSessions={pinnedSessions}
                    recentSessions={recentSessions}
                    onTogglePinnedAction={togglePinnedAction}
                    onResumeRecentSession={handleResumeRecentSession}
                    onTogglePinnedSession={togglePinnedSession}
                  />
                ) : null;
              case "events":
                return sectionPrefs.events ? (
                  <HomeEvents key={sectionKey} events={events} onDismissEvent={dismissEvent} />
                ) : null;
              default:
                return null;
            }
          })}

          <div className="content-toast-stack">
            {toasts.map((toast) => (
              <div key={toast.id} className={`content-toast tone-${toast.tone}`}>
                {toast.title}
              </div>
            ))}
          </div>

          <div className="content-panel">
            <Spotlight
              open={spotlightOpen}
              activeProfile={activeProfile}
              onClose={() => setSpotlightOpen(false)}
              onNavigate={handleNavigate}
              onNewChat={handleNewChat}
              onSnapWindow={handleSnapWindow}
              onSearchSessions={handleSearchSessions}
              recentSessions={recentSessions.map((session) => ({
                id: session.id,
                title: session.title,
              }))}
              recentActionIds={recentActionIds}
              presets={workspacePresets.map((preset) => ({
                id: preset.id,
                label: preset.label,
                view: preset.view,
                profile: preset.profile,
              }))}
              workflows={workflowPresets.map((workflow) => ({
                id: workflow.id,
                label: workflow.label,
                profile: workflow.profile,
                promptText: workflow.promptText,
                startup: workflow.startup,
              }))}
              onResumeRecentSession={(sessionId) => {
                void handleResumeRecentSession(sessionId);
              }}
              onApplyPreset={(presetId) => {
                applyWorkspacePresetById(presetId);
              }}
              onRunWorkflow={(workflowId) => {
                const workflow = workflowPresets.find((item) => item.id === workflowId);
                if (workflow) runWorkflowPreset(workflow);
              }}
              onSetStartupWorkflow={(workflowId) => {
                setStartupWorkflowPreset(workflowId);
              }}
              onSkipStartupWorkflowOnce={() => {
                skipStartupWorkflowRef.current = true;
                pushEvent("Startup workflow skipped", "Next startup workflow auto-run disabled for this boot cycle", "warning");
                setToasts((prev) => [
                  {
                    id: `${Date.now()}-skip-startup-workflow`,
                    title: "Startup workflow skipped once",
                    tone: "warning" as const,
                  },
                  ...prev,
                ].slice(0, 4));
              }}
            />
            {booting && (
              <div className="boot-sequence-overlay">
                <div className="boot-sequence-panel">
                  <div className="boot-sequence-kicker">HCC OS</div>
                  <div className="boot-sequence-title">Booting workspace shell</div>
                  <div className="boot-sequence-progress">
                    <span className="boot-sequence-bar" />
                  </div>
                  <div className="boot-sequence-copy">
                    Hydrating panels, tools, and profile context…
                  </div>
                </div>
              </div>
            )}

            <div
              style={{
                display: view === "chat" ? "flex" : "none",
                flex: 1,
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <Chat
                messages={messages}
                setMessages={setMessages}
                sessionId={currentSessionId}
                profile={activeProfile}
                onNewChat={handleNewChat}
                onPromptSent={(text: string) => {
                  setRecentPrompts((prev) => [
                    {
                      id: `${Date.now()}`,
                      text,
                      profile: activeProfile,
                      timestamp: Date.now(),
                    },
                    ...prev.filter((item) => item.text !== text),
                  ].slice(0, 8));
                }}
              />
            </div>
            {view === "sessions" &&
              (remoteMode ? (
                <RemoteNotice feature="Sessions" />
              ) : (
                <Sessions
                  onResumeSession={handleResumeSession}
                  onNewChat={handleNewChat}
                  currentSessionId={currentSessionId}
                />
              ))}
            {view === "agents" &&
              (remoteMode ? (
                <RemoteNotice feature="Profiles" />
              ) : (
                <Agents
                  activeProfile={activeProfile}
                  onSelectProfile={handleSelectProfile}
                  onChatWith={(name: string) => {
                    handleSelectProfile(name);
                    setView("chat");
                  }}
                />
              ))}
            {officeVisited && (
              <div
                style={{
                  display: view === "office" ? "flex" : "none",
                  flex: 1,
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                <Office visible={view === "office"} />
              </div>
            )}
            {view === "models" && <Models />}
            {view === "skills" &&
              (remoteMode ? <RemoteNotice feature="Skills" /> : <Skills profile={activeProfile} />)}
            {view === "soul" &&
              (remoteMode ? <RemoteNotice feature="Persona" /> : <Soul profile={activeProfile} />)}
            {view === "memory" &&
              (remoteMode ? <RemoteNotice feature="Memory" /> : <Memory profile={activeProfile} />)}
            {view === "tools" &&
              (remoteMode ? <RemoteNotice feature="Tools" /> : <Tools profile={activeProfile} />)}
            {view === "schedules" &&
              (remoteMode ? (
                <RemoteNotice feature="Schedules" />
              ) : (
                <Schedules profile={activeProfile} />
              ))}
            {view === "gateway" &&
              (remoteMode ? <RemoteNotice feature="Gateway" /> : <Gateway profile={activeProfile} />)}
            <div
              style={{
                display: view === "settings" ? "flex" : "none",
                flex: 1,
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <Settings profile={activeProfile} visible={view === "settings"} />
            </div>
            {HCC_WORKSPACE_VIEWS.has(view) && (
              <HccWorkspaceViews
                activeView={view}
                selectedProjectId={selectedProjectId}
                selectedDomainId={selectedDomainId}
                onOpenProject={handleOpenProject}
                onOpenDomain={handleOpenDomain}
                onOpenMemory={() => handleNavigate("hcc-memory")}
                onNavigateHccView={(nextView) => handleNavigate(nextView)}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default Layout;
