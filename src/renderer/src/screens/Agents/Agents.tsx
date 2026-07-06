import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, ChatBubble, Pencil, X } from "../../assets/icons";
import ProfileAvatar from "../../components/common/ProfileAvatar";
import { AppModal, AppModalTitle } from "../../components/modal/AppModal";
import { useI18n } from "../../components/useI18n";
import { useProfileModal } from "../../components/profile/ProfileModalContext";

interface ProfileInfo {
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

interface AgentsProps {
  activeProfile: string;
  onSelectProfile: (name: string) => void;
  onChatWith: (name: string) => void;
}

function Agents({
  activeProfile,
  onSelectProfile,
  onChatWith,
}: AgentsProps): React.JSX.Element {
  const { t } = useI18n();
  const { openProfile } = useProfileModal();
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [cloneConfig, setCloneConfig] = useState(true);
  // Source profile to clone config/keys/skills from when `cloneConfig` is on.
  const [cloneSource, setCloneSource] = useState("default");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  // Profile whose gateway we're waiting on after a switch — drives the
  // "Starting…" status while it spins up.
  const [startingProfile, setStartingProfile] = useState<string | null>(null);

  const loadProfiles = useCallback(async (): Promise<void> => {
    const list = await window.hermesAPI.listProfiles();
    setProfiles(list);
    setLoading(false);
  }, []);

  // A switched profile starts its gateway asynchronously, so the pid file the
  // status reads from isn't written yet when the switch returns. Poll the list
  // until that profile reports running (or we give up) so the row flips to
  // "Running" on its own instead of only after a manual refresh/revisit.
  const gatewayPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopGatewayPoll = useCallback((): void => {
    if (gatewayPollRef.current) {
      clearTimeout(gatewayPollRef.current);
      gatewayPollRef.current = null;
    }
  }, []);

  const pollGatewayReady = useCallback(
    (name: string): void => {
      stopGatewayPoll();
      // ~15 attempts × 700ms ≈ 10s, enough for a cold gateway to come up.
      let attemptsLeft = 15;
      const settle = (): void =>
        setStartingProfile((current) => (current === name ? null : current));
      const tick = async (): Promise<void> => {
        attemptsLeft -= 1;
        try {
          const list = await window.hermesAPI.listProfiles();
          setProfiles(list);
          if (list.find((p) => p.name === name)?.gatewayRunning) {
            settle();
            return;
          }
        } catch {
          // A transient listing failure (e.g. SSH) shouldn't strand the
          // spinner — fall through to retry or give up like any other miss.
        }
        if (attemptsLeft <= 0) {
          settle();
          return;
        }
        gatewayPollRef.current = setTimeout(tick, 700);
      };
      gatewayPollRef.current = setTimeout(tick, 700);
    },
    [stopGatewayPoll],
  );

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  // Cancel any in-flight gateway poll when the page unmounts.
  useEffect(() => stopGatewayPoll, [stopGatewayPoll]);

  // Open the create modal, defaulting the clone source to the active profile.
  function openCreate(): void {
    setNewName("");
    setError("");
    setCloneConfig(true);
    setCloneSource(activeProfile || "default");
    setShowCreate(true);
  }

  function closeCreate(): void {
    setShowCreate(false);
    setError("");
  }

  async function handleCreate(): Promise<void> {
    const name = newName.trim().toLowerCase();
    if (!name) return;
    setCreating(true);
    setError("");
    const result = await window.hermesAPI.createProfile(
      name,
      cloneConfig ? cloneSource : null,
    );
    setCreating(false);
    if (result.success) {
      setShowCreate(false);
      setNewName("");
    } else {
      setError(result.error || t("agents.createFailed"));
    }
    loadProfiles();
  }

  async function handleSelect(name: string): Promise<void> {
    // Show "Starting…" only when this profile's gateway isn't already up, so
    // switching to an already-running profile doesn't flash a fake spinner.
    const alreadyRunning = profiles.find(
      (p) => p.name === name,
    )?.gatewayRunning;
    setStartingProfile(alreadyRunning ? null : name);
    await window.hermesAPI.setActiveProfile(name);
    onSelectProfile(name);
    loadProfiles();
    pollGatewayReady(name);
  }

  // "Chat" button — make the agent active (starts its gateway) then open a
  // conversation with it. The only path here that starts a chat.
  async function handleChatWith(name: string): Promise<void> {
    await window.hermesAPI.setActiveProfile(name);
    onChatWith(name);
    loadProfiles();
  }

  function providerLabel(provider: string): string {
    if (!provider || provider === "auto") return t("agents.auto");
    if (provider === "custom") return t("agents.local");
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  }

  if (loading) {
    return (
      <div className="agents-container">
        <div className="agents-loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="agents-container">
      <div className="agents-header">
        <div>
          <h2 className="agents-title">{t("agents.title")}</h2>
          <p className="agents-subtitle">{t("agents.subtitle")}</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openCreate}>
          <Plus size={14} />
          {t("agents.newAgent")}
        </button>
      </div>

      {!showCreate && error && (
        <div className="agents-create-error">{error}</div>
      )}

      <AppModal
        open={showCreate}
        onOpenChange={(open) => {
          if (!open) closeCreate();
        }}
        className="agents-create-modal"
        labelledBy="agents-create-title"
      >
        <div className="agents-create-modal-header">
          <AppModalTitle
            id="agents-create-title"
            className="agents-create-modal-title"
          >
            {t("agents.createTitle")}
          </AppModalTitle>
          <button
            className="profile-modal-close"
            onClick={closeCreate}
            aria-label={t("common.close")}
          >
            <X size={18} />
          </button>
        </div>
        <div className="agents-create-modal-body">
          <label className="agents-create-field">
            <span>{t("agents.nameLabel")}</span>
            <input
              className="input"
              placeholder={t("agents.namePlaceholder")}
              value={newName}
              onChange={(e) => {
                const v = e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9_-]/g, "");
                setNewName(v);
                setError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
            />
          </label>
          <label className="agents-create-clone">
            <input
              type="checkbox"
              checked={cloneConfig}
              onChange={(e) => setCloneConfig(e.target.checked)}
            />
            <span>{t("agents.cloneConfig")}</span>
          </label>
          {cloneConfig && (
            <label className="agents-create-field">
              <span>{t("agents.cloneFromLabel")}</span>
              <select
                className="input"
                value={cloneSource}
                onChange={(e) => setCloneSource(e.target.value)}
              >
                {profiles.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {error && <div className="agents-create-error">{error}</div>}
          <div className="agents-create-modal-actions">
            <button className="btn btn-secondary" onClick={closeCreate}>
              {t("common.cancel")}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
            >
              {creating ? t("agents.creating") : t("agents.create")}
            </button>
          </div>
        </div>
      </AppModal>

      <div className="agents-table">
        <div className="agents-table-head">
          <span className="agents-cell-profile">{t("agents.colProfile")}</span>
          <span className="agents-cell-model">{t("agents.colModel")}</span>
          <span className="agents-cell-status">{t("agents.colStatus")}</span>
          <span className="agents-cell-actions">{t("agents.colActions")}</span>
        </div>
        {profiles.map((p) => (
          <div
            key={p.name}
            className={`agents-row ${activeProfile === p.name ? "active" : ""}`}
            onClick={() => handleSelect(p.name)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              // Only the row itself — not Enter bubbling up from the edit/chat
              // buttons — should switch the profile.
              if (e.key === "Enter" && e.target === e.currentTarget) {
                handleSelect(p.name);
              }
            }}
          >
            <div className="agents-cell-profile">
              <ProfileAvatar
                name={p.name}
                color={p.color}
                avatar={p.avatar}
                size={36}
              />
              <div className="agents-row-info">
                <div className="agents-row-name">{p.name}</div>
                <div className="agents-row-sub">
                  {providerLabel(p.provider)} ·{" "}
                  {t("agents.skillsCount", { count: p.skillCount })}
                </div>
              </div>
            </div>
            <div className="agents-cell-model">
              {p.model ? (
                <code className="agents-model-chip">
                  {p.model.split("/").pop()}
                </code>
              ) : (
                <span className="agents-model-empty">
                  {t("agents.noModel")}
                </span>
              )}
            </div>
            <div className="agents-cell-status">
              {startingProfile === p.name && !p.gatewayRunning ? (
                <span className="agents-status-pill starting">
                  <span className="agents-status-spinner" />
                  {t("agents.starting")}
                </span>
              ) : (
                <span
                  className={`agents-status-pill ${
                    p.gatewayRunning ? "on" : "off"
                  }`}
                  title={
                    p.gatewayRunning
                      ? t("agents.gatewayRunning")
                      : t("agents.gatewayOff")
                  }
                >
                  <span className="agents-status-dot" />
                  {p.gatewayRunning ? t("agents.running") : t("agents.off")}
                </span>
              )}
            </div>
            <div className="agents-cell-actions">
              <button
                type="button"
                className="agents-row-edit"
                title={t("agents.editAppearance")}
                aria-label={t("agents.editAppearance")}
                onClick={(e) => {
                  e.stopPropagation();
                  setError("");
                  openProfile(p.name, {
                    onChanged: loadProfiles,
                    onDeleted: (n) => {
                      if (activeProfile === n) onSelectProfile("default");
                    },
                  });
                }}
              >
                <Pencil size={14} />
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleChatWith(p.name);
                }}
              >
                <ChatBubble size={13} />
                {t("agents.chat")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Agents;
