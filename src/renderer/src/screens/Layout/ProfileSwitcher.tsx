import { useState, useRef, useEffect, useCallback } from "react";
import { Bot, Check, ChevronDown, Settings } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";

interface ProfileInfo {
  name: string;
  isDefault: boolean;
  isActive: boolean;
  model: string;
  skillCount: number;
  gatewayRunning: boolean;
}

interface ProfileSwitcherProps {
  /** Name of the currently active profile ("default" for the base workspace). */
  activeProfile: string;
  /** Called after a successful switch so the shell can reset chat state. */
  onSwitch: (name: string) => void;
  /** Open the full Profiles management screen. */
  onManage: () => void;
}

/**
 * Sidebar footer control: shows the active profile and, on click, opens a
 * popover to switch between profiles or jump to the management screen.
 */
export default function ProfileSwitcher({
  activeProfile,
  onSwitch,
  onManage,
}: ProfileSwitcherProps): React.JSX.Element {
  const { t } = useI18n();
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
  const activeRunning = profiles.find(
    (p) => p.name === activeProfile,
  )?.gatewayRunning;

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
    <div className="profile-switcher" ref={rootRef}>
      {open && (
        <div className="profile-menu" role="menu">
          <div className="profile-menu-list">
            {profiles.map((p) => {
              const isActive = p.name === activeProfile;
              const meta = [
                p.model || t("agents.noModel"),
                t("agents.skillsCount", { count: p.skillCount }),
              ].join(" · ");
              return (
                <button
                  key={p.name}
                  className={`profile-menu-item ${isActive ? "active" : ""}`}
                  role="menuitemradio"
                  aria-checked={isActive}
                  onClick={() => handleSelect(p.name)}
                >
                  <Bot
                    size={16}
                    className={`profile-icon ${
                      p.gatewayRunning ? "running" : ""
                    }`}
                    aria-hidden
                  />
                  <span className="profile-menu-info">
                    <span className="profile-menu-name">
                      {p.name}
                      {p.isDefault && (
                        <span className="profile-menu-tag">
                          {t("agents.defaultTag")}
                        </span>
                      )}
                    </span>
                    <span className="profile-menu-meta">{meta}</span>
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
        title={t("agents.switchProfile")}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Bot
          size={16}
          className={`profile-icon ${activeRunning ? "running" : ""}`}
          aria-hidden
        />
        <span className="profile-switcher-name">{label}</span>
        <ChevronDown size={14} className="profile-switcher-chevron" />
      </button>
    </div>
  );
}
