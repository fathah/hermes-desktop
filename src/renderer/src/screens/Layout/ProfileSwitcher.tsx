import { useState, useEffect, useCallback } from "react";
import { Settings, Users, Check } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import ProfileAvatar from "../../components/common/ProfileAvatar";
import { useProfileModal } from "../../components/profile/ProfileModalContext";

interface ProfileInfo {
  id: string;
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
  /** Id of the currently active profile ("default" for the base workspace). */
  activeProfile: string;
  /** Called after a successful switch so the shell can reset chat state. */
  onSwitch: (name: string) => void;
  /** Open the full Profiles management screen. */
  onManage: () => void;
  /** Render as an icon-only sidebar footer affordance. */
  compact?: boolean;
}

/**
 * Sidebar-footer profile control, split into two affordances: the chip (avatar
 * + name) opens the current profile's edit modal, and a dedicated switch button
 * opens a modal to change the active profile. Collapsed, the single avatar opens
 * the switch modal.
 */
export default function ProfileSwitcher({
  activeProfile,
  onSwitch,
  onManage,
  compact = false,
}: ProfileSwitcherProps): React.JSX.Element {
  const { t } = useI18n();
  const { openProfile } = useProfileModal();
  const [switchOpen, setSwitchOpen] = useState(false);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);

  const load = useCallback(() => {
    window.hermesAPI
      .listProfiles()
      .then(setProfiles)
      .catch(() => {
        /* keep last-known list */
      });
  }, []);

  // Load once on mount so the chip shows the correct name/avatar immediately.
  useEffect(() => {
    load();
  }, [load]);

  // Refresh when the switch modal opens — counts and the gateway dot drift.
  useEffect(() => {
    if (switchOpen) load();
  }, [switchOpen, load]);

  // Escape closes the switch modal.
  useEffect(() => {
    if (!switchOpen) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setSwitchOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [switchOpen]);

  const activeInfo = profiles.find((p) => p.id === activeProfile);
  const hasDefaultFallbackName =
    activeInfo?.isDefault && activeInfo.name === activeInfo.id;
  const label =
    activeInfo && !hasDefaultFallbackName
      ? activeInfo.name
      : activeProfile === "default"
        ? t("common.appName")
        : activeProfile;

  function editCurrent(): void {
    openProfile(activeProfile, { onChanged: load });
  }

  async function handleSelect(name: string): Promise<void> {
    setSwitchOpen(false);
    if (name === activeProfile) return;
    try {
      await window.hermesAPI.setActiveProfile(name);
    } catch {
      /* still reflect the choice optimistically */
    }
    onSwitch(name);
  }

  return (
    <>
      <div className={`profile-switcher ${compact ? "compact" : ""}`}>
        <button
          className="profile-switcher-trigger"
          onClick={compact ? () => setSwitchOpen(true) : editCurrent}
          title={
            compact
              ? t("agents.switchProfile")
              : t("agents.editAppearanceFor", { name: label })
          }
        >
          <ProfileAvatar
            name={activeProfile}
            color={activeInfo?.color}
            avatar={activeInfo?.avatar}
            size={compact ? 22 : 18}
          />
          {!compact && <span className="profile-switcher-name">{label}</span>}
        </button>
        {!compact && (
          <button
            className="profile-switch-btn"
            onClick={() => setSwitchOpen(true)}
            title={t("agents.switchProfile")}
            aria-label={t("agents.switchProfile")}
          >
            <Users size={16} />
          </button>
        )}
      </div>

      {switchOpen && (
        <div
          className="profile-switch-overlay"
          onClick={() => setSwitchOpen(false)}
        >
          <div
            className="profile-switch-modal"
            role="dialog"
            aria-label={t("agents.switchProfile")}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="profile-switch-title">
              {t("agents.switchProfile")}
            </div>
            <div className="profile-switch-list">
              {profiles.map((p) => {
                const isActive = p.id === activeProfile;
                return (
                  <button
                    key={p.id}
                    className={`profile-menu-item ${isActive ? "active" : ""}`}
                    role="menuitemradio"
                    aria-checked={isActive}
                    onClick={() => handleSelect(p.id)}
                  >
                    <div className="profile-menu-avatar">
                      <ProfileAvatar
                        name={p.id}
                        color={p.color}
                        avatar={p.avatar}
                        size={28}
                      />
                    </div>
                    <span className="profile-menu-info">
                      <span className="profile-menu-name">
                        {p.name}
                        {p.isDefault && (
                          <span className="profile-menu-tag">
                            {t("agents.defaultTag")}
                          </span>
                        )}
                        {p.id !== p.name && (
                          <span className="profile-menu-tag">{p.id}</span>
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
                          t("agents.skillsCount", { count: p.skillCount }),
                        ].join(" · ")}
                      </span>
                    </span>
                    {isActive && (
                      <Check size={16} className="profile-menu-check" />
                    )}
                  </button>
                );
              })}
            </div>
            <button
              className="profile-menu-manage"
              onClick={() => {
                setSwitchOpen(false);
                onManage();
              }}
            >
              <Settings size={14} />
              {t("agents.manageProfiles")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
