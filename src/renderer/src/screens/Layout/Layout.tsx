import { useState, useCallback, useEffect } from "react";
import Settings from "../Settings/Settings";
import Gateway from "../Gateway/Gateway";
import Models from "../Models/Models";
import CouncilSettings from "../Council/CouncilSettings";
import Providers from "../Providers/Providers";
import ControlCenterOverview from "./ControlCenterOverview";
import RemoteNotice from "../../components/RemoteNotice";
import VerifyWarningBanner from "../../components/VerifyWarningBanner";
import hermeslogo from "../../assets/hermes.png";
import {
  ChevronDown,
  Settings as SettingsIcon,
  Signal,
  Layers,
  KeyRound,
  Download,
} from "../../assets/icons";
import {
  Activity,
  BrainCircuit,
  Home,
  Shield,
  SlidersHorizontal,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "../../components/useI18n";
import { loadAndApplyActiveSkin } from "../../utils/skin";
import { useStore as useSpsStore } from "../SpsAgent/store";
import {
  OPEN_SETTINGS_EVENT,
  normalizeAdminView,
  writeLastAdminView,
  type AdminView,
  type NormalizedAdminView,
} from "../../lib/openSettings";

// The deep-linkable view set is owned by lib/openSettings so callers and this
// host can't drift. Layout's nav is a subset of these.
type View = NormalizedAdminView;

// Nav is grouped by user goal rather than a flat scan. Group headers are static
// labels; the whole Control Center still collapses via the master toggle.
interface NavItem {
  view: View;
  icon: LucideIcon;
  labelKey: string;
}
interface NavGroup {
  id: string;
  headerKey: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: "start",
    headerKey: "navigation.groupStart",
    items: [
      { view: "overview", icon: Home, labelKey: "navigation.overview" },
      { view: "aiSetup", icon: KeyRound, labelKey: "navigation.aiSetup" },
      {
        view: "personalization",
        icon: Wand2,
        labelKey: "navigation.personalization",
      },
    ],
  },
  {
    id: "workspace",
    headerKey: "navigation.groupWorkspace",
    items: [
      {
        view: "preferences",
        icon: SlidersHorizontal,
        labelKey: "navigation.preferences",
      },
      {
        view: "dataPrivacy",
        icon: Shield,
        labelKey: "navigation.dataPrivacy",
      },
      {
        view: "connectedApps",
        icon: Signal,
        labelKey: "navigation.connectedApps",
      },
    ],
  },
  {
    id: "power",
    headerKey: "navigation.groupPowerUser",
    items: [
      { view: "models", icon: Layers, labelKey: "navigation.models" },
      { view: "council", icon: BrainCircuit, labelKey: "navigation.council" },
      {
        view: "troubleshooting",
        icon: Activity,
        labelKey: "navigation.troubleshooting",
      },
      { view: "advanced", icon: SettingsIcon, labelKey: "navigation.advanced" },
    ],
  },
];

function normalizeReleaseNotes(notes: unknown): string {
  if (!notes) return "";
  if (typeof notes === "string") return notes;
  if (Array.isArray(notes)) {
    return notes
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const note = (item as Record<string, unknown>).note;
          return typeof note === "string" ? note : "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return String(notes);
}

interface LayoutProps {
  verifyWarning?: boolean;
  onReinstall?: () => void;
  onDismissVerifyWarning?: () => void;
  /** Opening view — used when Layout is shown as the SPS admin overlay. */
  initialView?: AdminView;
  onClose?: () => void;
}

function Layout({
  verifyWarning,
  onReinstall,
  onDismissVerifyWarning,
  initialView,
  onClose,
}: LayoutProps = {}): React.JSX.Element {
  const { t } = useI18n();
  const [view, setView] = useState<View>(normalizeAdminView(initialView));
  const [activeProfile, setActiveProfile] = useState("default");
  // Tabs lazy-mount on first visit, then stay mounted (display:none toggle).
  // Keeps IPC refetch / DOM rebuild off the tab-switch hot path.
  const [visitedViews, setVisitedViews] = useState<Set<View>>(
    () => new Set<View>(["overview", normalizeAdminView(initialView)]),
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

  const openPersonalization = useCallback(() => {
    useSpsStore.getState().setSurface("you");
    onClose?.();
  }, [onClose]);

  // Remember the active tab so the overlay reopens where the user left off
  // (App reads this via readLastAdminView when no deep-link/no-API-key applies).
  useEffect(() => {
    writeLastAdminView(view);
  }, [view]);

  useEffect(() => {
    if (view === "personalization") openPersonalization();
  }, [openPersonalization, view]);

  // Roving focus: arrow keys move between nav items across group boundaries.
  const handleNavKeys = useCallback(
    (e: React.KeyboardEvent<HTMLElement>): void => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = Array.from(
        e.currentTarget.querySelectorAll<HTMLButtonElement>(
          ".sidebar-nav-item",
        ),
      );
      const idx = items.indexOf(document.activeElement as HTMLButtonElement);
      if (idx === -1) return;
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const next = (idx + delta + items.length) % items.length;
      items[next]?.focus();
    },
    [],
  );

  // Bridge: SPS surfaces (which can't reach goTo directly) ask the host to open
  // a specific Hermes admin tab — e.g. the config-health banner's "Show details"
  // link, or the status chip deep-linking to Providers/Gateway. A missing
  // detail.view re-targets nothing (the overlay just opens on its current view).
  useEffect(() => {
    const onOpen = (e: WindowEventMap[typeof OPEN_SETTINGS_EVENT]): void => {
      setAdminOpen(true);
      const target = normalizeAdminView(e.detail?.view);
      goTo(target);
    };
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, onOpen);
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
  const [updateReleaseNotes, setUpdateReleaseNotes] = useState("");
  const [showAppUpdateModal, setShowAppUpdateModal] = useState(false);

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
      setUpdateReleaseNotes(normalizeReleaseNotes(info.releaseNotes));
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
      setShowAppUpdateModal(false);
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
          window.hermesAPI
            .getGitChangelog()
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

  async function downloadAppUpdate(): Promise<void> {
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
  }

  async function handleUpdate(): Promise<void> {
    if (updateState === "available") {
      setShowAppUpdateModal(true);
    } else if (updateState === "error") {
      await downloadAppUpdate();
    } else if (updateState === "ready") {
      await window.hermesAPI.installUpdate();
    }
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src={hermeslogo} height={30} alt="" />
        </div>

        <nav className="sidebar-nav" onKeyDown={handleNavKeys}>
          <button
            type="button"
            className="sidebar-section-toggle"
            onClick={() => setAdminOpen((open) => !open)}
            aria-expanded={adminOpen}
          >
            <ChevronDown
              size={14}
              className={adminOpen ? "sidebar-section-open" : ""}
            />
            {t("navigation.controlCenterTitle")}
          </button>
          {adminOpen &&
            NAV_GROUPS.map((group) => (
              <div
                key={group.id}
                className="sidebar-nav-section"
                role="group"
                aria-label={t(group.headerKey)}
              >
                <div className="sidebar-nav-group-header">
                  {t(group.headerKey)}
                </div>
                {group.items
                  .filter(
                    ({ view: v }) =>
                      !(
                        remoteMode &&
                        (v === "aiSetup" || v === "connectedApps")
                      ),
                  )
                  .map(({ view: v, icon: Icon, labelKey }) => (
                    <button
                      key={v}
                      className={`sidebar-nav-item ${view === v ? "active" : ""}`}
                      onClick={() =>
                        v === "personalization"
                          ? openPersonalization()
                          : goTo(v)
                      }
                    >
                      <Icon size={16} />
                      {t(labelKey)}
                    </button>
                  ))}
              </div>
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
        {visitedViews.has("overview") && (
          <div style={paneStyle("overview")}>
            <ControlCenterOverview
              profile={activeProfile}
              remoteMode={remoteMode}
              onNavigate={goTo}
              onClose={onClose ?? (() => {})}
            />
          </div>
        )}

        {visitedViews.has("models") && (
          <div style={paneStyle("models")}>
            <Models visible={view === "models"} />
          </div>
        )}

        {visitedViews.has("council") && (
          <div style={paneStyle("council")}>
            <CouncilSettings profile={activeProfile} />
          </div>
        )}

        {visitedViews.has("aiSetup") && (
          <div style={paneStyle("aiSetup")}>
            {remoteMode ? (
              <RemoteNotice feature="AI Setup" />
            ) : (
              <Providers profile={activeProfile} visible={view === "aiSetup"} />
            )}
          </div>
        )}

        {visitedViews.has("connectedApps") && (
          <div style={paneStyle("connectedApps")}>
            {remoteMode ? (
              <RemoteNotice feature="Connected Apps" />
            ) : (
              <Gateway profile={activeProfile} />
            )}
          </div>
        )}

        {visitedViews.has("preferences") && (
          <div style={paneStyle("preferences")}>
            <Settings profile={activeProfile} section="preferences" />
          </div>
        )}

        {visitedViews.has("dataPrivacy") && (
          <div style={paneStyle("dataPrivacy")}>
            <Settings profile={activeProfile} section="dataPrivacy" />
          </div>
        )}

        {visitedViews.has("troubleshooting") && (
          <div style={paneStyle("troubleshooting")}>
            <Settings profile={activeProfile} section="troubleshooting" />
          </div>
        )}

        {visitedViews.has("advanced") && (
          <div style={paneStyle("advanced")}>
            <Settings profile={activeProfile} section="advanced" />
          </div>
        )}
      </main>

      {/* Desktop app release notes modal */}
      {showAppUpdateModal && (
        <div
          className="skills-detail-overlay"
          onClick={() => setShowAppUpdateModal(false)}
        >
          <div
            className="schedules-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 500 }}
          >
            <div className="schedules-modal-header">
              <h3>
                {t("common.desktopUpdateTitle", {
                  version: updateVersion || "",
                })}
              </h3>
              <button
                className="btn-ghost"
                onClick={() => setShowAppUpdateModal(false)}
                style={{ fontSize: 24, lineHeight: 1 }}
              >
                &times;
              </button>
            </div>
            <div
              className="schedules-modal-body"
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {t("common.desktopUpdateIntro")}
              </p>

              <div
                style={{
                  maxHeight: 250,
                  overflowY: "auto",
                  background: "var(--bg-tertiary, rgba(127,127,127,0.06))",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: 12,
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.4,
                }}
              >
                {updateReleaseNotes ||
                  t("common.desktopUpdateReleaseNotesFallback")}
              </div>
            </div>
            <div className="schedules-modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setShowAppUpdateModal(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setShowAppUpdateModal(false);
                  void downloadAppUpdate();
                }}
              >
                {t("common.downloadUpdate")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Git Changelog / What's New Modal */}
      {showChangelogModal && (
        <div
          className="skills-detail-overlay"
          onClick={() => setShowChangelogModal(false)}
        >
          <div
            className="schedules-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 500 }}
          >
            <div className="schedules-modal-header">
              <h3>What&apos;s New in Hermes Agent</h3>
              <button
                className="btn-ghost"
                onClick={() => setShowChangelogModal(false)}
                style={{ fontSize: 24, lineHeight: 1 }}
              >
                &times;
              </button>
            </div>
            <div
              className="schedules-modal-body"
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                An update is available for your Hermes Agent engine. Review the
                changes below before installing:
              </p>

              <div
                style={{
                  maxHeight: 250,
                  overflowY: "auto",
                  background: "var(--bg-tertiary, rgba(127,127,127,0.06))",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: 12,
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.4,
                }}
              >
                {gitChangelog || "Fetching commits..."}
              </div>
            </div>
            <div className="schedules-modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setShowChangelogModal(false)}
              >
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
