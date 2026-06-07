import { useState, useCallback, useEffect } from "react";
import Chat, { ChatMessage } from "../Chat/Chat";
import {
  dbItemsToChatMessages,
  type DbHistoryItem,
} from "../Chat/sessionHistory";
import Sessions from "../Sessions/Sessions";
import Agents from "../Agents/Agents";
import Settings from "../Settings/Settings";
import Skills from "../Skills/Skills";
import Memory from "../Memory/Memory";
import Personalization from "../Personalization/Personalization";
import Tools from "../Tools/Tools";
import Gateway from "../Gateway/Gateway";
import Office from "../Office/Office";
import Models from "../Models/Models";
import Providers from "../Providers/Providers";
import Schedules from "../Schedules/Schedules";
import Kanban from "../Kanban/Kanban";
import Insights from "../Insights/Insights";
import CapabilityReview from "../CapabilityReview/CapabilityReview";
import RemoteNotice from "../../components/RemoteNotice";
import VerifyWarningBanner from "../../components/VerifyWarningBanner";
import hermeslogo from "../../assets/hermes.png";
import {
  ChevronDown,
  Clock,
  Users,
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
import { BarChart3, UserCog, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import { loadAndApplyActiveSkin } from "../../utils/skin";

type View =
  | "chat"
  | "sessions"
  | "agents"
  | "office"
  | "models"
  | "providers"
  | "skills"
  | "memory"
  | "personalization"
  | "tools"
  | "schedules"
  | "kanban"
  | "insights"
  | "capabilityReview"
  | "gateway"
  | "spsAgent"
  | "settings";

// `label` (literal) overrides `labelKey` (i18n) when set — used for views added
// after the locale files were authored, to avoid touching every translation.
const NAV_ITEMS: {
  view: View;
  icon: LucideIcon;
  labelKey: string;
  label?: string;
}[] = [
  { view: "sessions", icon: Clock, labelKey: "navigation.sessions" },
  { view: "agents", icon: Users, labelKey: "navigation.agents" },
  { view: "office", icon: Building, labelKey: "navigation.office" },
  { view: "kanban", icon: KanbanIcon, labelKey: "navigation.kanban" },
  {
    view: "insights",
    icon: BarChart3,
    labelKey: "navigation.insights",
    // Disambiguate from the SPS workspace's own "Insights" surface — this is the
    // Hermes agent-level view.
    label: "Agent Insights",
  },
  { view: "models", icon: Layers, labelKey: "navigation.models" },
  { view: "providers", icon: KeyRound, labelKey: "navigation.providers" },
  { view: "skills", icon: Puzzle, labelKey: "navigation.skills" },
  {
    view: "memory",
    icon: Brain,
    labelKey: "navigation.memory",
    // Disambiguate from the SPS workspace's "Memory" surface.
    label: "Agent Memory",
  },
  {
    view: "personalization",
    icon: UserCog,
    labelKey: "navigation.personalization",
    label: "Personalization",
  },
  { view: "tools", icon: Wrench, labelKey: "navigation.tools" },
  {
    view: "capabilityReview",
    icon: ShieldCheck,
    labelKey: "navigation.capabilityReview",
    label: "Capabilities",
  },
  { view: "schedules", icon: Timer, labelKey: "navigation.schedules" },
  { view: "gateway", icon: Signal, labelKey: "navigation.gateway" },
  { view: "settings", icon: SettingsIcon, labelKey: "navigation.settings" },
];

interface LayoutProps {
  verifyWarning?: boolean;
  onReinstall?: () => void;
  onDismissVerifyWarning?: () => void;
  /** Opening view — used when Layout is shown as the SPS admin overlay. */
  initialView?: View;
}

function Layout({
  verifyWarning,
  onReinstall,
  onDismissVerifyWarning,
  initialView,
}: LayoutProps = {}): React.JSX.Element {
  const { t } = useI18n();
  const [view, setView] = useState<View>(initialView ?? "settings");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [activeProfile, setActiveProfile] = useState("default");
  // Tabs lazy-mount on first visit, then stay mounted (display:none toggle).
  // Keeps IPC refetch / DOM rebuild off the tab-switch hot path.
  const [visitedViews, setVisitedViews] = useState<Set<View>>(
    () => new Set<View>(["settings", ...(initialView ? [initialView] : [])]),
  );
  // Remote-only mode — SSH tunnel has full access; only pure HTTP remote mode restricts screens
  const [remoteMode, setRemoteMode] = useState(false);
  const [adminOpen, setAdminOpen] = useState(true);

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

  // Bridge: SPS surfaces (which can't reach goTo directly) ask the host to open
  // Hermes Settings — e.g. the config-health banner's "Show details" link.
  useEffect(() => {
    const openSettings = (): void => {
      setAdminOpen(true);
      goTo("settings");
    };
    window.addEventListener("hermes:open-settings", openSettings);
    return () =>
      window.removeEventListener("hermes:open-settings", openSettings);
  }, [goTo]);

  // Re-check remote mode on tab switch (picks up Settings changes)
  useEffect(() => {
    window.hermesAPI.isRemoteOnlyMode().then(setRemoteMode);
  }, [view]);

  // Apply the active skin (idea A6) for the current profile at the app root.
  useEffect(() => {
    void loadAndApplyActiveSkin(activeProfile);
  }, [activeProfile]);

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

  // Hermes *runtime* update (WS3) — distinct from the Electron-shell auto-update
  // above. Detects when the locally-checked-out agent is behind upstream and
  // offers an in-place `hermes update`.
  const [hermesUpdateState, setHermesUpdateState] = useState<
    "available" | "updating" | "done" | "error" | null
  >(null);
  const [hermesUpdateDetail, setHermesUpdateDetail] = useState<string | null>(
    null,
  );
  const [gitChangelog, setGitChangelog] = useState<string | null>(null);
  const [showChangelogModal, setShowChangelogModal] = useState(false);

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

  // Probe the runtime once on mount (best-effort, non-blocking).
  useEffect(() => {
    let cancelled = false;
    window.hermesAPI
      .checkHermesUpdate()
      .then((status) => {
        if (!cancelled && status.available) {
          setHermesUpdateState("available");
          window.hermesAPI.getGitChangelog()
            .then((log) => {
              if (!cancelled) setGitChangelog(log);
            })
            .catch(() => {});
        }
      })
      .catch(() => {
        /* offline / not a git checkout — stay silent */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleHermesUpdate(): Promise<void> {
    if (hermesUpdateState === "updating") return;
    setHermesUpdateState("updating");
    setHermesUpdateDetail(null);
    const cleanup = window.hermesAPI.onInstallProgress((p) => {
      setHermesUpdateDetail(p.detail || null);
    });
    try {
      const result = await window.hermesAPI.runHermesUpdate();
      setHermesUpdateState(result.success ? "done" : "error");
      if (!result.success) setHermesUpdateDetail(result.error ?? null);
    } catch (err) {
      setHermesUpdateState("error");
      setHermesUpdateDetail(err instanceof Error ? err.message : String(err));
    } finally {
      cleanup();
    }
  }

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
          <button
            type="button"
            className="sidebar-section-toggle"
            onClick={() => setAdminOpen((open) => !open)}
          >
            <ChevronDown
              size={14}
              className={adminOpen ? "sidebar-section-open" : ""}
            />
            Agent Control Center
          </button>
          {adminOpen &&
            NAV_ITEMS.map(({ view: v, icon: Icon, labelKey, label }) => (
              <button
                key={v}
                className={`sidebar-nav-item ${view === v ? "active" : ""}`}
                onClick={() => goTo(v)}
              >
                <Icon size={16} />
                {label ?? t(labelKey)}
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
          {hermesUpdateState && (
            <button
              className={`sidebar-update-btn ${
                hermesUpdateState === "error" ? "error" : ""
              }`}
              onClick={() => {
                if (hermesUpdateState === "available") {
                  setShowChangelogModal(true);
                } else {
                  handleHermesUpdate();
                }
              }}
              disabled={
                hermesUpdateState === "updating" || hermesUpdateState === "done"
              }
              title={hermesUpdateDetail ?? undefined}
            >
              <Download size={13} />
              {hermesUpdateState === "available" && (
                <span>{t("common.agentUpdateAvailable")}</span>
              )}
              {hermesUpdateState === "updating" && (
                <span>{t("common.agentUpdating")}</span>
              )}
              {hermesUpdateState === "done" && (
                <span>{t("common.agentUpdated")}</span>
              )}
              {hermesUpdateState === "error" && (
                <span>{t("common.agentUpdateFailed")}</span>
              )}
            </button>
          )}
          <div className="sidebar-footer-text">
            {activeProfile === "default" ? t("common.appName") : activeProfile}
          </div>
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
              <Skills profile={activeProfile} visible={view === "skills"} />
            )}
          </div>
        )}

        {visitedViews.has("memory") && (
          <div style={paneStyle("memory")}>
            {remoteMode ? (
              <RemoteNotice feature="Memory" />
            ) : (
              <Memory profile={activeProfile} visible={view === "memory"} />
            )}
          </div>
        )}

        {visitedViews.has("personalization") && (
          <div style={paneStyle("personalization")}>
            {remoteMode ? (
              <RemoteNotice feature="Personalization" />
            ) : (
              <Personalization
                profile={activeProfile}
                visible={view === "personalization"}
              />
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

        {visitedViews.has("insights") && (
          <div style={paneStyle("insights")}>
            <Insights profile={activeProfile} visible={view === "insights"} />
          </div>
        )}

        {visitedViews.has("capabilityReview") && (
          <div style={paneStyle("capabilityReview")}>
            <CapabilityReview
              profile={activeProfile}
              visible={view === "capabilityReview"}
            />
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

      {/* Git Changelog / What's New Modal */}
      {showChangelogModal && (
        <div className="skills-detail-overlay" onClick={() => setShowChangelogModal(false)}>
          <div className="schedules-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <div className="schedules-modal-header">
              <h3>What&apos;s New in Hermes Agent</h3>
              <button className="btn-ghost" onClick={() => setShowChangelogModal(false)} style={{ fontSize: 24, lineHeight: 1 }}>
                &times;
              </button>
            </div>
            <div className="schedules-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                An update is available for your Hermes Agent engine. Review the changes below before installing:
              </p>
              
              <div style={{
                maxHeight: 250,
                overflowY: 'auto',
                background: 'var(--bg-tertiary, rgba(127,127,127,0.06))',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: 12,
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                lineHeight: 1.4
              }}>
                {gitChangelog || "Fetching commits..."}
              </div>
            </div>
            <div className="schedules-modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowChangelogModal(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setShowChangelogModal(false);
                  handleHermesUpdate();
                }}
              >
                Update Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Layout;
