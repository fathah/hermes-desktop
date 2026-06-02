import { useState, useCallback, useEffect } from "react";
import Chat, { ChatMessage } from "../Chat/Chat";
import {
  dbItemsToChatMessages,
  type DbHistoryItem,
} from "../Chat/sessionHistory";
import Sessions from "../Sessions/Sessions";
import Agents from "../Agents/Agents";
import ProfileSwitcher from "./ProfileSwitcher";
import Settings from "../Settings/Settings";
import Skills from "../Skills/Skills";
import Memory from "../Memory/Memory";
import Tools from "../Tools/Tools";
import Gateway from "../Gateway/Gateway";
import Office from "../Office/Office";
import Models from "../Models/Models";
import Providers from "../Providers/Providers";
import Schedules from "../Schedules/Schedules";
import Kanban from "../Kanban/Kanban";
import RemoteNotice from "../../components/RemoteNotice";
import VerifyWarningBanner from "../../components/VerifyWarningBanner";
import hermeslogo from "../../assets/hermes.png";
import {
  ChatBubble,
  Clock,
  Settings as SettingsIcon,
  Puzzle,
  Brain,
  Wrench,
  Signal,
  Building,
  Layers,
  KeyRound,
  Timer,
  Kanban as KanbanIcon,
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
  | "providers"
  | "skills"
  | "memory"
  | "tools"
  | "schedules"
  | "kanban"
  | "gateway"
  | "settings";

const NAV_ITEMS: { view: View; icon: LucideIcon; labelKey: string }[] = [
  { view: "chat", icon: ChatBubble, labelKey: "navigation.chat" },
  { view: "sessions", icon: Clock, labelKey: "navigation.sessions" },
  // "agents" (Profiles) is reached from the sidebar-footer ProfileSwitcher's
  // "Manage profiles" action rather than a top-level nav item.
  { view: "office", icon: Building, labelKey: "navigation.office" },
  { view: "kanban", icon: KanbanIcon, labelKey: "navigation.kanban" },
  { view: "models", icon: Layers, labelKey: "navigation.models" },
  { view: "providers", icon: KeyRound, labelKey: "navigation.providers" },
  { view: "skills", icon: Puzzle, labelKey: "navigation.skills" },
  { view: "memory", icon: Brain, labelKey: "navigation.memory" },
  { view: "tools", icon: Wrench, labelKey: "navigation.tools" },
  { view: "schedules", icon: Timer, labelKey: "navigation.schedules" },
  { view: "gateway", icon: Signal, labelKey: "navigation.gateway" },
  { view: "settings", icon: SettingsIcon, labelKey: "navigation.settings" },
];

interface LayoutProps {
  verifyWarning?: boolean;
  onReinstall?: () => void;
  onDismissVerifyWarning?: () => void;
}

function Layout({
  verifyWarning,
  onReinstall,
  onDismissVerifyWarning,
}: LayoutProps = {}): React.JSX.Element {
  const { t } = useI18n();
  const [view, setView] = useState<View>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [activeProfile, setActiveProfile] = useState("default");
  // Tabs lazy-mount on first visit, then stay mounted (display:none toggle).
  // Keeps IPC refetch / DOM rebuild off the tab-switch hot path.
  const [visitedViews, setVisitedViews] = useState<Set<View>>(
    () => new Set<View>(["chat"]),
  );
  // Remote-only mode — SSH tunnel has full access; only pure HTTP remote mode restricts screens
  const [remoteMode, setRemoteMode] = useState(false);

  const paneStyle = (target: View): React.CSSProperties => ({
    display: view === target ? "flex" : "none",
    flex: 1,
    flexDirection: "column",
    overflow: "hidden",
  });

  const goTo = useCallback((v: View) => {
    setVisitedViews((prev) => (prev.has(v) ? prev : new Set(prev).add(v)));
    setView(v);
  }, []);

  // Re-check remote mode on tab switch (picks up Settings changes)
  useEffect(() => {
    window.hermesAPI.isRemoteOnlyMode().then(setRemoteMode);
  }, [view]);

  // Restore the last-activated profile on launch. The main process persists it
  // in ~/.hermes/active_profile (via `hermes profile use`), so the desktop
  // should reopen on that profile rather than always resetting to "default".
  useEffect(() => {
    let cancelled = false;
    window.hermesAPI
      .listProfiles()
      .then((profiles) => {
        if (cancelled) return;
        const active = profiles.find((p) => p.isActive);
        if (active && active.name !== "default") setActiveProfile(active.name);
      })
      .catch(() => {
        /* fall back to the default profile */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-update state
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<
    "available" | "downloading" | "ready" | "error" | null
  >(null);
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    const cleanupAvailable = window.hermesAPI.onUpdateAvailable((info) => {
      setUpdateVersion(info.version);
      setUpdateState("available");
      setUpdateError(null);
      setDownloadPercent(0);
    });
    const cleanupProgress = window.hermesAPI.onUpdateDownloadProgress(
      (info) => {
        setDownloadPercent(info.percent);
      },
    );
    const cleanupDownloaded = window.hermesAPI.onUpdateDownloaded(() => {
      setUpdateState("ready");
      setUpdateError(null);
    });
    const cleanupError = window.hermesAPI.onUpdateError((message) => {
      setUpdateState("error");
      setUpdateError(message);
      setDownloadPercent(0);
    });
    return () => {
      cleanupAvailable();
      cleanupProgress();
      cleanupDownloaded();
      cleanupError();
    };
  }, []);

  async function handleUpdate(): Promise<void> {
    if (updateState === "available" || updateState === "error") {
      setUpdateError(null);
      setDownloadPercent(0);
      setUpdateState("downloading");
      try {
        const ok = await window.hermesAPI.downloadUpdate();
        if (!ok) setUpdateState("error");
      } catch (err) {
        setUpdateError(err instanceof Error ? err.message : String(err));
        setUpdateState("error");
      }
    } else if (updateState === "ready") {
      await window.hermesAPI.installUpdate();
    }
  }

  const handleNewChat = useCallback(() => {
    // Abort any in-flight chat before clearing
    window.hermesAPI.abortChat();
    setMessages([]);
    setCurrentSessionId(null);
    goTo("chat");
  }, [goTo]);

  // Listen for menu IPC events (Cmd+N, Cmd+K from app menu)
  useEffect(() => {
    const cleanupNewChat = window.hermesAPI.onMenuNewChat(() => {
      handleNewChat();
    });
    const cleanupSearch = window.hermesAPI.onMenuSearchSessions(() => {
      goTo("sessions");
    });
    return () => {
      cleanupNewChat();
      cleanupSearch();
    };
  }, [handleNewChat, goTo]);

  const handleSelectProfile = useCallback((name: string) => {
    setActiveProfile(name);
    setMessages([]);
    setCurrentSessionId(null);
  }, []);

  const handleResumeSession = useCallback(
    async (sessionId: string) => {
      const items = (await window.hermesAPI.getSessionMessages(
        sessionId,
      )) as DbHistoryItem[];
      setMessages(dbItemsToChatMessages(items));
      setCurrentSessionId(sessionId);
      goTo("chat");
    },
    [goTo],
  );

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src={hermeslogo} height={30} alt="" />
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map(({ view: v, icon: Icon, labelKey }) => (
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

        <div className="sidebar-footer">
          {updateState && (
            <button
              className={`sidebar-update-btn ${
                updateState === "error" ? "error" : ""
              }`}
              onClick={handleUpdate}
              disabled={updateState === "downloading"}
              title={updateError ?? undefined}
            >
              <Download size={13} />
              {updateState === "available" && (
                <span>
                  {t("common.updateAvailable", { version: updateVersion })}
                </span>
              )}
              {updateState === "downloading" && (
                <span>
                  {t("common.downloading", { percent: downloadPercent })}
                </span>
              )}
              {updateState === "ready" && (
                <span>{t("common.restartToUpdate")}</span>
              )}
              {updateState === "error" && (
                <span>{t("common.updateFailed")}</span>
              )}
            </button>
          )}
          <ProfileSwitcher
            activeProfile={activeProfile}
            onSwitch={handleSelectProfile}
            onManage={() => goTo("agents")}
          />
        </div>
      </aside>

      <main className="content">
        {verifyWarning && onReinstall && onDismissVerifyWarning && (
          <VerifyWarningBanner
            onReinstall={onReinstall}
            onDismiss={onDismissVerifyWarning}
          />
        )}
        <div style={paneStyle("chat")}>
          <Chat
            messages={messages}
            setMessages={setMessages}
            sessionId={currentSessionId}
            profile={activeProfile}
            onNewChat={handleNewChat}
            onOpenDiagnose={() => goTo("settings")}
          />
        </div>

        {visitedViews.has("sessions") && (
          <div style={paneStyle("sessions")}>
            {remoteMode ? (
              <RemoteNotice feature="Sessions" />
            ) : (
              <Sessions
                onResumeSession={handleResumeSession}
                onNewChat={handleNewChat}
                currentSessionId={currentSessionId}
                visible={view === "sessions"}
              />
            )}
          </div>
        )}

        {visitedViews.has("agents") && (
          <div style={paneStyle("agents")}>
            {remoteMode ? (
              <RemoteNotice feature="Profiles" />
            ) : (
              <Agents
                activeProfile={activeProfile}
                onSelectProfile={handleSelectProfile}
                onChatWith={(name: string) => {
                  handleSelectProfile(name);
                  goTo("chat");
                }}
              />
            )}
          </div>
        )}

        {visitedViews.has("office") && (
          <div style={paneStyle("office")}>
            <Office profile={activeProfile} visible={view === "office"} />
          </div>
        )}

        {visitedViews.has("models") && (
          <div style={paneStyle("models")}>
            <Models visible={view === "models"} />
          </div>
        )}

        {visitedViews.has("providers") && (
          <div style={paneStyle("providers")}>
            {remoteMode ? (
              <RemoteNotice feature="Providers" />
            ) : (
              <Providers
                profile={activeProfile}
                visible={view === "providers"}
              />
            )}
          </div>
        )}

        {visitedViews.has("skills") && (
          <div style={paneStyle("skills")}>
            {remoteMode ? (
              <RemoteNotice feature="Skills" />
            ) : (
              <Skills profile={activeProfile} />
            )}
          </div>
        )}

        {visitedViews.has("memory") && (
          <div style={paneStyle("memory")}>
            {remoteMode ? (
              <RemoteNotice feature="Memory" />
            ) : (
              <Memory profile={activeProfile} />
            )}
          </div>
        )}

        {visitedViews.has("tools") && (
          <div style={paneStyle("tools")}>
            {remoteMode ? (
              <RemoteNotice feature="Tools" />
            ) : (
              <Tools profile={activeProfile} />
            )}
          </div>
        )}

        {visitedViews.has("schedules") && (
          <div style={paneStyle("schedules")}>
            <Schedules profile={activeProfile} />
          </div>
        )}

        {visitedViews.has("kanban") && (
          <div style={paneStyle("kanban")}>
            {remoteMode ? (
              <RemoteNotice feature="Kanban" />
            ) : (
              <Kanban profile={activeProfile} visible={view === "kanban"} />
            )}
          </div>
        )}

        {visitedViews.has("gateway") && (
          <div style={paneStyle("gateway")}>
            {remoteMode ? (
              <RemoteNotice feature="Gateway" />
            ) : (
              <Gateway profile={activeProfile} />
            )}
          </div>
        )}

        {visitedViews.has("settings") && (
          <div style={paneStyle("settings")}>
            <Settings profile={activeProfile} />
          </div>
        )}
      </main>
    </div>
  );
}

export default Layout;
