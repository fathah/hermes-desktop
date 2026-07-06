import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, Settings } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import ProfileAvatar from "../../components/common/ProfileAvatar";
import { useProfileModal } from "../../components/profile/ProfileModalContext";

interface ProfileInfo {
  name: string;
  isDefault: boolean;
  isActive: boolean;
  model: string;
  skillCount: number;
  gatewayRunning: boolean;
  color?: string;
  avatar?: string | null;
}

interface ProfileSwitcherProps {
  /** Name of the currently active profile ("default" for the base workspace). */
  activeProfile: string;
  /** Called after a successful switch so the shell can reset chat state. */
  onSwitch: (name: string) => void;
  /** Open the full Profiles management screen. */
  onManage: () => void;
  /** Render as an icon-only sidebar footer affordance. */
  compact?: boolean;
}

/**
 * Sidebar footer control: shows the active profile and, on click, opens a
 * popover to switch between profiles or jump to the management screen.
 */
export default function ProfileSwitcher({
  activeProfile,
  onSwitch,
  onManage,
  compact = false,
}: ProfileSwitcherProps): React.JSX.Element {
  const { t } = useI18n();
  const { openProfile } = useProfileModal();
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    window.hermesAPI
      .listProfiles()
      .then(setProfiles)
      .catch(() => {
        /* keep last-known list */
      });
  }, []);

  // Load once on mount so the sidebar trigger shows the correct gateway
  // status immediately, without requiring the user to open the menu first.
  useEffect(() => {
    load();
  }, [load]);

  // Refresh the list each time the menu opens — model/skill counts and the
  // gateway-running dot can change while the app is open.
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Dismiss on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label =
    activeProfile === "default" ? t("common.appName") : activeProfile;
  const activeInfo = profiles.find((p) => p.name === activeProfile);

  async function handleSelect(name: string): Promise<void> {
    setOpen(false);
    if (name === activeProfile) return;
    try {
      await window.hermesAPI.setActiveProfile(name);
    } catch {
      /* still reflect the choice optimistically */
    }
    onSwitch(name);
  }

  return (
    <div
      className={`profile-switcher ${compact ? "compact" : ""}`}
      ref={rootRef}
    >
      {open && (
        <div className="profile-menu" role="menu">
          {(() => {
            const active = profiles.find((p) => p.name === activeProfile);
            const others = profiles.filter((p) => p.name !== activeProfile);
            return (
              <>
                {active && (
                  <button
                    type="button"
                    className="profile-menu-active-section"
                    role="menuitem"
                    title={t("agents.editAppearanceFor", { name: active.name })}
                    onClick={() => {
                      setOpen(false);
                      openProfile(active.name, { onChanged: load });
                    }}
                  >
                    <div className="profile-menu-avatar">
                      <ProfileAvatar
                        name={active.name}
                        color={active.color}
                        avatar={active.avatar}
                        size={32}
                      />
                      {active.gatewayRunning && (
                        <span className="profile-menu-avatar-dot" />
                      )}
                    </div>
                    <span className="profile-menu-info">
                      <span className="profile-menu-name">
                        {active.name}
                        {active.isDefault && (
                          <span className="profile-menu-tag">
                            {t("agents.defaultTag")}
                          </span>
                        )}
                      </span>
                      <span className="profile-menu-meta">
                        {[
                          active.model || t("agents.noModel"),
                          t("agents.skillsCount", { count: active.skillCount }),
                        ].join(" · ")}
                      </span>
                    </span>
                  </button>
                )}
                {others.length > 0 && (
                  <>
                    <div className="profile-menu-divider" />
                    <div className="profile-menu-list">
                      {others.map((p) => (
                        <button
                          key={p.name}
                          className="profile-menu-item"
                          role="menuitemradio"
                          aria-checked={false}
                          onClick={() => handleSelect(p.name)}
                        >
                          <ProfileAvatar
                            name={p.name}
                            color={p.color}
                            avatar={p.avatar}
                            size={20}
                          />
                          <span className="profile-menu-info">
                            <span className="profile-menu-name">
                              {p.name}
                              {p.isDefault && (
                                <span className="profile-menu-tag">
                                  {t("agents.defaultTag")}
                                </span>
                              )}
                              <span
                                className={`profile-menu-gateway ${
                                  p.gatewayRunning ? "active" : ""
                                }`}
                              />
                            </span>
                            <span className="profile-menu-meta">
                              {[
                                p.model || t("agents.noModel"),
                                t("agents.skillsCount", {
                                  count: p.skillCount,
                                }),
                              ].join(" · ")}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            );
          })()}
          <button
            className="profile-menu-manage"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
          >
            <Settings size={14} />
            {t("agents.manageProfiles")}
          </button>
        </div>
      )}

      <button
        className={`profile-switcher-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={`${t("agents.switchProfile")}: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ProfileAvatar
          name={activeProfile}
          color={activeInfo?.color}
          avatar={activeInfo?.avatar}
          size={compact ? 22 : 18}
        />
        {!compact && <span className="profile-switcher-name">{label}</span>}
        {!compact && (
          <ChevronDown size={14} className="profile-switcher-chevron" />
        )}
      </button>
    </div>
  );
}
