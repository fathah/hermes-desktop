import { useState, useEffect, useCallback, useRef } from "react";
import {
  Brain,
  Database,
  Plug,
  Pencil,
  Puzzle,
  Settings,
  Signal,
  Sparkles,
  Trash,
  User,
  Wallet,
  X,
} from "../../assets/icons";
import ProfileAvatar from "../common/ProfileAvatar";
import { PROFILE_COLORS } from "../../../../shared/profileColors";
import { fileToAvatarDataUrl } from "../../utils/imageResize";
import { useI18n } from "../useI18n";
import Soul from "../../screens/Soul/Soul";
import { MemoryEntries } from "../../screens/Memory/MemoryEntries";
import type { MemoryData } from "../../screens/Memory/types";
import { AppModal, AppModalTitle } from "../modal/AppModal";
import ProfileWalletPane from "./ProfileWalletPane";
import type { ProfileSection } from "./ProfileModalContext";

/** Mirrors the entry shape returned by `window.hermesAPI.listProfiles()`. */
interface ProfileInfo {
  id: string;
  name: string;
  path: string;
  isDefault: boolean;
  isActive: boolean;
  model: string;
  provider: string;
  hasEnv: boolean;
  hasSoul: boolean;
  skillCount: number;
  gatewayRunning: boolean;
  color?: string;
  avatar?: string | null;
}

export interface ProfileModalProps {
  /** Profile to view/edit (legacy prop name; value is the profile id). */
  name: string;
  open: boolean;
  onClose: () => void;
  onExited?: () => void;
  /** Fired after any successful mutation so the opener can refresh its list. */
  onChanged?: () => void;
  /** Fired after the profile is deleted, before the modal closes. */
  onDeleted?: (name: string) => void;
  /** Section to show when the modal opens; defaults to "profile". */
  initialSection?: ProfileSection;
}
type ProfileChipIcon = React.ComponentType<{
  size?: number;
  className?: string;
}>;

/** Left-nav sections. Built to grow; each renders into the right-hand content
 *  pane. */
const PROFILE_SECTIONS: ReadonlyArray<{
  id: ProfileSection;
  labelKey: string;
  Icon: React.ComponentType<{ size?: number }>;
}> = [
  { id: "profile", labelKey: "agents.sectionProfile", Icon: User },
  { id: "persona", labelKey: "agents.sectionPersona", Icon: Sparkles },
  { id: "agentMemory", labelKey: "agents.sectionAgentMemory", Icon: Database },
  { id: "wallet", labelKey: "agents.sectionWallet", Icon: Wallet },
  { id: "advanced", labelKey: "agents.sectionAdvanced", Icon: Settings },
];

/**
 * Global profile detail/appearance modal (80vw × 80vh). Opened from anywhere
 * via the ProfileModalProvider's `openProfile`. Self-loads its data through
 * `listProfiles()` (there is no single-profile IPC) and re-loads after each
 * mutation so it always reflects the live profile. Notifies the opener via
 * `onChanged` / `onDeleted` so sibling lists (sidebar, Agents) stay in sync.
 */
export default function ProfileModal({
  name,
  open,
  onClose,
  onExited,
  onChanged,
  onDeleted,
  initialSection,
}: ProfileModalProps): React.JSX.Element {
  const id = name;
  const { t } = useI18n();
  const [profile, setProfile] = useState<ProfileInfo | null>(null);
  const [section, setSection] = useState<ProfileSection>(
    initialSection ?? "profile",
  );
  // Re-apply on every open so a reused modal instance honours the opener's
  // requested section (e.g. the bank ATM deep-links to "wallet").
  useEffect(() => {
    if (open) setSection(initialSection ?? "profile");
  }, [open, initialSection]);
  const [error, setError] = useState("");
  const [memoryData, setMemoryData] = useState<MemoryData | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameEditing, setNameEditing] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const skipNextNameBlurSaveRef = useRef(false);
  const profileName = profile?.name;

  const load = useCallback(async (): Promise<void> => {
    try {
      const list = await window.hermesAPI.listProfiles();
      setProfile(list.find((p) => p.id === id) ?? null);
    } catch {
      /* keep last-known profile */
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!profileName) return;
    setNameDraft(profileName);
  }, [profileName]);

  useEffect(() => {
    if (!nameEditing) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, [nameEditing]);

  const loadMemoryData = useCallback(async (): Promise<void> => {
    if (!profile) return;
    setMemoryLoading(true);
    setMemoryError("");
    try {
      const data = await window.hermesAPI.readMemory(profile.id);
      setMemoryData(data as MemoryData);
    } catch {
      setMemoryError(t("memory.loadFailed"));
    } finally {
      setMemoryLoading(false);
    }
  }, [profile, t]);

  useEffect(() => {
    setMemoryData(null);
    setMemoryError("");
  }, [id]);

  useEffect(() => {
    if (section === "agentMemory" && profile && !memoryData && !memoryLoading) {
      void loadMemoryData();
    }
  }, [loadMemoryData, memoryData, memoryLoading, profile, section]);

  const afterMutation = useCallback(async (): Promise<void> => {
    await load();
    onChanged?.();
  }, [load, onChanged]);

  async function handlePickColor(color: string): Promise<void> {
    setProfile((cur) => (cur ? { ...cur, color } : cur));
    const result = await window.hermesAPI.setProfileColor(id, color);
    if (!result.success) setError(result.error || t("agents.appearanceFailed"));
    await afterMutation();
  }

  async function handleAvatarFile(
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      const result = await window.hermesAPI.setProfileAvatar(id, dataUrl);
      if (!result.success)
        setError(result.error || t("agents.uploadImageFailed"));
    } catch {
      setError(t("agents.uploadImageFailed"));
    }
    await afterMutation();
  }

  async function handleRemoveAvatar(): Promise<void> {
    const result = await window.hermesAPI.removeProfileAvatar(id);
    if (!result.success) setError(result.error || t("agents.appearanceFailed"));
    await afterMutation();
  }

  async function handleSaveName(): Promise<void> {
    if (!profile || nameSaving) return;
    const currentName = profile.name;
    if (skipNextNameBlurSaveRef.current) {
      skipNextNameBlurSaveRef.current = false;
      setNameDraft(currentName);
      return;
    }
    if (nameDraft.trim() === currentName) {
      setNameDraft(currentName);
      setNameEditing(false);
      return;
    }
    setNameSaving(true);
    setError("");
    try {
      const result = await window.hermesAPI.setProfileName(
        profile.id,
        nameDraft,
      );
      if (!result.success) {
        setError(result.error || t("common.updateFailed"));
        setNameEditing(true);
        return;
      }
      setNameEditing(false);
      await afterMutation();
    } catch {
      setError(t("common.updateFailed"));
      setNameEditing(true);
    } finally {
      setNameSaving(false);
    }
  }

  function handleCancelNameEdit(): void {
    if (!profile) return;
    skipNextNameBlurSaveRef.current = true;
    setNameDraft(profile.name);
    setNameEditing(false);
  }

  function handleStartNameEdit(): void {
    skipNextNameBlurSaveRef.current = false;
    setNameEditing(true);
  }

  async function handleDelete(): Promise<void> {
    setConfirmDelete(false);
    setError("");
    const result = await window.hermesAPI.deleteProfile(id);
    if (result.success) {
      onDeleted?.(id);
      onChanged?.();
      onClose();
    } else {
      setError(result.error || t("agents.deleteFailed"));
    }
  }

  function providerLabel(provider: string): string {
    if (!provider || provider === "auto") return t("agents.auto");
    if (provider === "custom") return t("agents.local");
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  }

  const profileChips: ReadonlyArray<{
    key: string;
    value: string;
    Icon: ProfileChipIcon;
    state?: "on" | "off";
  }> = profile
    ? [
        {
          key: "provider",
          value: providerLabel(profile.provider),
          Icon: Plug,
        },
        {
          key: "model",
          value: profile.model
            ? profile.model.split("/").pop() || profile.model
            : t("agents.noModel"),
          Icon: Brain,
        },
        {
          key: "skills",
          value: t("agents.skillsCount", { count: profile.skillCount }),
          Icon: Puzzle,
        },
        {
          key: "gateway",
          value: profile.gatewayRunning
            ? t("agents.gatewayRunning")
            : t("agents.gatewayOff"),
          Icon: Signal,
          state: profile.gatewayRunning ? "on" : "off",
        },
      ]
    : [];
  const agentName = profile?.name || id;

  return (
    <AppModal
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      onExitComplete={onExited}
      className="profile-modal"
      overlayClassName="profile-modal-overlay"
      labelledBy="profile-modal-title"
    >
      <div className="profile-modal-header">
        <div className="profile-modal-header-main">
          {profile && (
            <ProfileAvatar
              name={profile.id}
              color={profile.color}
              avatar={profile.avatar}
              size={28}
            />
          )}
          <AppModalTitle
            id="profile-modal-title"
            className="profile-modal-title"
          >
            {agentName}
          </AppModalTitle>
        </div>
        <button
          type="button"
          className="profile-modal-close"
          onClick={onClose}
          aria-label={t("common.cancel")}
        >
          <X size={18} />
        </button>
      </div>

      {profile ? (
        <div className="profile-modal-layout">
          <nav className="profile-modal-nav" aria-label={t("agents.title")}>
            {PROFILE_SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`profile-modal-nav-item ${
                  section === s.id ? "active" : ""
                }`}
                onClick={() => setSection(s.id)}
              >
                <s.Icon size={16} />
                {t(s.labelKey)}
              </button>
            ))}
          </nav>

          <div className="profile-modal-content">
            {section === "profile" && (
              <div className="profile-modal-pane">
                <div className="profile-modal-identity">
                  <div className="profile-modal-avatar-wrap">
                    <ProfileAvatar
                      name={profile.id}
                      color={profile.color}
                      avatar={profile.avatar}
                      size={96}
                    />
                    {profile.gatewayRunning && (
                      <span className="profile-modal-avatar-dot" />
                    )}
                  </div>
                  <div className="profile-modal-identity-meta">
                    <div className="profile-modal-name-row">
                      {nameEditing ? (
                        <input
                          ref={nameInputRef}
                          className="profile-modal-name-input"
                          value={nameDraft}
                          maxLength={80}
                          placeholder={profile.name}
                          aria-label={t("agents.nameLabel")}
                          disabled={nameSaving}
                          onChange={(e) => {
                            setNameDraft(e.target.value);
                            setError("");
                          }}
                          onBlur={() => {
                            void handleSaveName();
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              e.currentTarget.blur();
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              handleCancelNameEdit();
                            }
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="profile-modal-name-edit"
                          onClick={handleStartNameEdit}
                          aria-label={t("agents.nameLabel")}
                          title={t("agents.nameLabel")}
                        >
                          <span className="profile-modal-name">
                            {agentName}
                          </span>
                          <Pencil size={14} aria-hidden="true" />
                        </button>
                      )}
                      {profile.id !== profile.name && (
                        <span className="profile-modal-tag">{profile.id}</span>
                      )}
                      {nameSaving && (
                        <span className="profile-modal-tag">
                          {t("setup.saving")}
                        </span>
                      )}
                    </div>
                    <div className="profile-modal-image-actions">
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {t("agents.uploadImage")}
                      </button>
                      {profile.avatar && (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={handleRemoveAvatar}
                        >
                          {t("agents.removeImage")}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="profile-modal-stats">
                  {profileChips.map(({ key, value, Icon, state }) => (
                    <span
                      className={`profile-modal-stat-value ${
                        state ? `is-${state}` : ""
                      }`}
                      key={key}
                    >
                      <Icon size={14} className="profile-modal-stat-icon" />
                      {value}
                    </span>
                  ))}
                </div>

                <div className="profile-modal-section">
                  <span className="profile-modal-label">
                    {t("agents.color")}
                  </span>
                  <div className="profile-modal-swatches">
                    {PROFILE_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`profile-modal-swatch ${
                          (profile.color || "").toLowerCase() ===
                          c.toLowerCase()
                            ? "active"
                            : ""
                        }`}
                        style={{ background: c }}
                        title={c}
                        aria-label={c}
                        onClick={() => handlePickColor(c)}
                      />
                    ))}
                  </div>
                </div>

                {error && <div className="agents-create-error">{error}</div>}
              </div>
            )}

            {section === "persona" && (
              <div className="profile-modal-pane profile-modal-memory-pane">
                <div className="memory-soul-tab">
                  <Soul profile={profile.id} />
                </div>
              </div>
            )}

            {section === "agentMemory" && (
              <div className="profile-modal-pane profile-modal-memory-pane">
                {memoryLoading && !memoryData ? (
                  <div className="profile-modal-loading">
                    <div className="loading-spinner" />
                  </div>
                ) : memoryData ? (
                  <MemoryEntries
                    entries={memoryData.memory.entries}
                    profile={profile.id}
                    onRefresh={loadMemoryData}
                  />
                ) : memoryError ? (
                  <div className="memory-error">{memoryError}</div>
                ) : null}
              </div>
            )}

            {section === "wallet" && <ProfileWalletPane profile={profile.id} />}

            {section === "advanced" && (
              <div className="profile-modal-pane">
                {profile.isDefault ? (
                  <p className="profile-modal-danger-info">
                    {t("agents.defaultNotDeletable")}
                  </p>
                ) : (
                  <div className="profile-modal-danger">
                    <span className="profile-modal-label profile-modal-danger-label">
                      {t("agents.dangerZone")}
                    </span>
                    <p className="profile-modal-danger-info">
                      {t("agents.deleteProfileInfo")}
                    </p>
                    {confirmDelete ? (
                      <div className="profile-modal-danger-confirm">
                        <span>{t("agents.deleteProfileConfirm")}</span>
                        <div className="profile-modal-image-actions">
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={handleDelete}
                          >
                            {t("agents.deleteProfile")}
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setConfirmDelete(false)}
                          >
                            {t("common.cancel")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="btn btn-danger-ghost btn-sm"
                        onClick={() => setConfirmDelete(true)}
                      >
                        <Trash size={13} />
                        {t("agents.deleteProfile")}
                      </button>
                    )}
                  </div>
                )}

                {error && <div className="agents-create-error">{error}</div>}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="profile-modal-loading">
          <div className="loading-spinner" />
        </div>
      )}

      <div className="profile-modal-footer">
        <button className="btn btn-primary btn-sm" onClick={onClose}>
          {t("common.done")}
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleAvatarFile}
      />
    </AppModal>
  );
}
