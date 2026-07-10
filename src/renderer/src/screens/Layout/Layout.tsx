import { useState, useCallback, useEffect } from "react";
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
import RemoteNotice from "../../components/RemoteNotice";
import Spotlight from "../../components/Spotlight";
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
  onClick: () => void;
}

const STORAGE_KEYS = {
  shellView: "hcc-os-shell-view",
  shellProfile: "hcc-os-shell-profile",
} as const;

const NAV_ITEMS: { view: View; icon: LucideIcon; labelKey: string; eyebrow: string }[] = [
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

function readStoredView(): View {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.shellView);
    if (!raw) return "chat";
    const valid = NAV_ITEMS.some((item) => item.view === raw);
    return valid ? (raw as View) : "chat";
  } catch {
    return "chat";
  }
}

function readStoredProfile(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.shellProfile) || "default";
  } catch {
    return "default";
  }
}

function Layout(): React.JSX.Element {
  const { t } = useI18n();
  const [view, setView] = useState<View>(() => readStoredView());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [activeProfile, setActiveProfile] = useState(() => readStoredProfile());
  const [officeVisited, setOfficeVisited] = useState(() => readStoredView() === "office");
  const [remoteMode, setRemoteMode] = useState(false);
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    window.hermesAPI.isRemoteMode().then(setRemoteMode);
  }, [view]);

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

  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<
    "available" | "downloading" | "ready" | null
  >(null);
  const [downloadPercent, setDownloadPercent] = useState(0);

  useEffect(() => {
    const cleanupAvailable = window.hermesAPI.onUpdateAvailable((info) => {
      setUpdateVersion(info.version);
      setUpdateState("available");
    });
    const cleanupProgress = window.hermesAPI.onUpdateDownloadProgress((info) => {
      setDownloadPercent(info.percent);
    });
    const cleanupDownloaded = window.hermesAPI.onUpdateDownloaded(() => {
      setUpdateState("ready");
    });
    return () => {
      cleanupAvailable();
      cleanupProgress();
      cleanupDownloaded();
    };
  }, []);

  async function handleUpdate(): Promise<void> {
    if (updateState === "available") {
      setUpdateState("downloading");
      await window.hermesAPI.downloadUpdate();
    } else if (updateState === "ready") {
      await window.hermesAPI.installUpdate();
    }
  }

  const handleNewChat = useCallback(() => {
    window.hermesAPI.abortChat();
    setMessages([]);
    setCurrentSessionId(null);
    setView("chat");
  }, []);

  const handleNavigate = useCallback((nextView: string) => {
    if (nextView === "office") setOfficeVisited(true);
    setView(nextView as View);
  }, []);

  const handleSearchSessions = useCallback(() => {
    setView("sessions");
  }, []);

  const handleSnapWindow = useCallback(async () => {
    await window.hermesAPI.snapWindowToEdge();
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

  const handleResumeSession = useCallback(async (sessionId: string) => {
    const dbMessages = await window.hermesAPI.getSessionMessages(sessionId);
    const chatMessages: ChatMessage[] = dbMessages.map((m) => ({
      id: `db-${m.id}`,
      role: m.role === "user" ? "user" : "agent",
      content: m.content,
    }));
    setMessages(chatMessages);
    setCurrentSessionId(sessionId);
    setView("chat");
  }, []);

  const launcherCards = useCallback((): LauncherCard[] => {
    const cards: LauncherCard[] = [
      {
        key: "new-chat",
        label: "Start a new chat",
        description: "Reset the shell into a fresh operator thread.",
        onClick: handleNewChat,
      },
      {
        key: "resume-sessions",
        label: "Resume recent sessions",
        description: "Jump into recall and continue prior runs.",
        onClick: handleSearchSessions,
      },
      {
        key: "snap-window",
        label: "Align the window",
        description: "Use HCC OS snap-to-edge placement right now.",
        onClick: () => {
          void handleSnapWindow();
        },
      },
    ];
    return cards;
  }, [handleNewChat, handleSearchSessions, handleSnapWindow]);

  const currentViewLabel = NAV_ITEMS.find((item) => item.view === view)?.labelKey;

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
            </div>
          </div>

          <button className="sidebar-launcher" onClick={() => setSpotlightOpen(true)}>
            <span className="sidebar-launcher-label">Open spotlight</span>
            <span className="sidebar-launcher-shortcut">⌘/Ctrl + P</span>
          </button>

          <nav className="sidebar-nav">
            {NAV_ITEMS.map(({ view: v, icon: Icon, labelKey, eyebrow }) => (
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
                  <span className="sidebar-nav-item-label">{t(labelKey)}</span>
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
            </div>
          </div>
        </aside>

        <main className="content-shell">
          <div className="content-topbar">
            <div>
              <div className="content-topbar-kicker">Workspace shell</div>
              <div className="content-topbar-title">
                {currentViewLabel ? t(currentViewLabel) : "Hermes"}
              </div>
            </div>
            <div className="content-topbar-badges">
              <span className="content-badge">{remoteMode ? "Remote mode" : "Local mode"}</span>
              <span className="content-badge">Profile {activeProfile}</span>
            </div>
          </div>

          <div className="content-launcher-row">
            {launcherCards().map((card) => (
              <button key={card.key} className="content-launcher-card" onClick={card.onClick}>
                <span className="content-launcher-card-label">{card.label}</span>
                <span className="content-launcher-card-description">{card.description}</span>
              </button>
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
          </div>
        </main>
      </div>
    </div>
  );
}

export default Layout;
