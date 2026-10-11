import { useState, useEffect, useCallback, useRef } from "react";
import { Settings, Users, Check, Search } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import ProfileAvatar from "../../components/common/ProfileAvatar";
import { useProfileEditorTarget } from "../../hooks/useProfileEditorTarget";
import { useProfileEditorLifetime } from "../../hooks/useProfileEditorLifetime";
import type { ProfileEditorTarget } from "../../../../shared/profile-editor-target";
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
  connectionId?: string;
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
 * opens a command-palette-style picker to change the active profile. Collapsed,
 * the single avatar opens the picker. The picker also opens from anywhere via
 * Cmd/Ctrl+P: a fuzzy search field on top, running profiles grouped above a
 * "Stopped" section, each row showing its model in monospace and a running dot.
 */
function ProfileSwitcherScreen({
  activeProfile,
  onSwitch,
  onManage,
  compact = false,
  target,
  isCurrent,
}: ProfileSwitcherProps & {
  target: ProfileEditorTarget;
  isCurrent: (target: ProfileEditorTarget) => boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const { openProfile } = useProfileModal();
  const live = useProfileEditorLifetime({ target, isCurrent });
  const readGeneration = useRef(0);
  const actionGeneration = useRef(0);
  const [error, setError] = useState("");
  const [switchOpen, setSwitchOpen] = useState(false);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isMac = window.electron?.process?.platform === "darwin";
  const mod = isMac ? "⌘" : "Ctrl";

  const load = useCallback(() => {
    if (!live()) return;
    const generation = ++readGeneration.current;
    window.hermesAPI
      .listProfiles(target)
      .then((list) => {
        if (live() && generation === readGeneration.current) setProfiles(list);
      })
      .catch(() => {
        /* keep last-known list */
      });
  }, [target, live]);

  // Load once on mount so the chip shows the correct name/avatar immediately.
  useEffect(() => {
    load();
  }, [load]);

  // Cmd/Ctrl+P toggles the picker from anywhere. P is unbound in the app menu,
  // so the renderer reliably receives it; preventDefault keeps the browser
  // print dialog from stealing it.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        (e.key === "p" || e.key === "P")
      ) {
        e.preventDefault();
        setSwitchOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Refresh + reset search/focus each time the picker opens — counts and the
  // gateway dot drift while it's closed.
  useEffect(() => {
    if (!switchOpen) return;
    load();
    setQuery("");
    setHighlight(0);
    // Focus after the open animation's first frame so the caret lands reliably.
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [switchOpen, load]);

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
    if (!live()) return;
    openProfile(activeProfile, { onChanged: load });
  }

  const handleSelect = useCallback(
    async (name: string): Promise<void> => {
      if (!live()) return;
      setSwitchOpen(false);
      if (name === activeProfile) return;
      const generation = ++actionGeneration.current;
      setError("");
      try {
        if (!(await window.hermesAPI.setActiveProfile(name, target)))
          throw new Error("The profile could not be selected.");
        if (live() && actionGeneration.current === generation) onSwitch(name);
      } catch (reason) {
        if (live() && actionGeneration.current === generation)
          setError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [activeProfile, onSwitch, live, target],
  );

  // Fuzzy-ish filter across the user-facing name, the stable id, and the model.
  const q = query.trim().toLowerCase();
  const matches = (p: ProfileInfo): boolean =>
    !q ||
    p.name.toLowerCase().includes(q) ||
    p.id.toLowerCase().includes(q) ||
    (p.model || "").toLowerCase().includes(q);
  // Active profile floats to the top of its group; the rest keep list order.
  const byActiveFirst = (a: ProfileInfo, b: ProfileInfo): number =>
    Number(b.id === activeProfile) - Number(a.id === activeProfile);
  const filtered = profiles.filter(matches);
  const running = filtered.filter((p) => p.gatewayRunning).sort(byActiveFirst);
  const stopped = filtered.filter((p) => !p.gatewayRunning).sort(byActiveFirst);
  // Flat order drives keyboard navigation across both groups.
  const flat = [...running, ...stopped];

  // Keep the highlighted row scrolled into view as the selection moves.
  useEffect(() => {
    if (!switchOpen) return;
    listRef.current
      ?.querySelector(".profile-menu-item.highlighted")
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight, switchOpen]);

  function onSearchKey(e: React.KeyboardEvent): void {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      // Clamp to the (possibly empty) filtered list — an empty list keeps 0
      // rather than drifting to -1.
      setHighlight((h) => Math.max(0, Math.min(flat.length - 1, h + 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // No-op when the query matches nothing — `flat[highlight]` is undefined.
      const target = flat[highlight];
      if (target) void handleSelect(target.id);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      setSwitchOpen(false);
    }
  }

  function renderRow(p: ProfileInfo, flatIndex: number): React.JSX.Element {
    const isActive = p.id === activeProfile;
    return (
      <button
        key={p.id}
        className={`profile-menu-item ${isActive ? "active" : ""} ${
          flatIndex === highlight ? "highlighted" : ""
        }`}
        role="menuitemradio"
        aria-checked={isActive}
        onClick={() => void handleSelect(p.id)}
        onMouseMove={() => setHighlight(flatIndex)}
      >
        <ProfileAvatar
          name={p.id}
          color={p.color}
          avatar={p.avatar}
          size={32}
        />
        <span className="profile-menu-name">{p.name}</span>
        <span className="profile-menu-model">
          {p.model || t("agents.noModel")}
        </span>
        <span className="profile-menu-status">
          <span
            className={`profile-menu-gateway ${p.gatewayRunning ? "active" : ""}`}
            aria-hidden
          />
          {isActive && <Check size={16} className="profile-menu-check" />}
        </span>
      </button>
    );
  }

  return (
    <>
      {error && <div role="alert">{error}</div>}
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
            title={`${t("agents.switchProfile")} (${mod}P)`}
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
            <div className="profile-switch-search">
              <Search
                size={16}
                className="profile-switch-search-icon"
                aria-hidden
              />
              <input
                ref={searchRef}
                className="profile-switch-search-input"
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlight(0);
                }}
                onKeyDown={onSearchKey}
                placeholder={t("agents.switchProfile")}
                aria-label={t("agents.switchProfile")}
              />
              <kbd className="profile-switch-kbd">{mod}P</kbd>
            </div>

            <div className="profile-switch-list" ref={listRef}>
              {flat.length === 0 ? (
                <div className="profile-switch-empty">
                  {t("agents.noProfilesMatch")}
                </div>
              ) : (
                <>
                  {running.map((p, i) => renderRow(p, i))}
                  {stopped.length > 0 && (
                    <div className="profile-switch-group">
                      {t("agents.stopped")}
                    </div>
                  )}
                  {stopped.map((p, i) => renderRow(p, running.length + i))}
                </>
              )}
            </div>

            <button
              className="profile-menu-manage"
              onClick={() => {
                if (!live()) return;
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

export default function ProfileSwitcher(
  props: ProfileSwitcherProps,
): React.JSX.Element {
  const scope = useProfileEditorTarget("default", props.connectionId);
  if (!scope.target)
    return <div>{scope.error && <div role="alert">{scope.error}</div>}</div>;
  return (
    <ProfileSwitcherScreen
      key={JSON.stringify([scope.target.scopeToken, scope.revision])}
      {...props}
      target={scope.target}
      isCurrent={scope.isCurrent}
    />
  );
}
