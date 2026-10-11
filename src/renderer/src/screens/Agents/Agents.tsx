import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, ChatBubble, Pencil, X } from "../../assets/icons";
import ProfileAvatar from "../../components/common/ProfileAvatar";
import { AppModal, AppModalTitle } from "../../components/modal/AppModal";
import { useI18n } from "../../components/useI18n";
import { OrbLoader } from "../../components/OrbLoader";
import { useProfileEditorTarget } from "../../hooks/useProfileEditorTarget";
import { useProfileEditorLifetime } from "../../hooks/useProfileEditorLifetime";
import type { ProfileEditorTarget } from "../../../../shared/profile-editor-target";
import { useProfileModal } from "../../components/profile/ProfileModalContext";
import type {
  AgentSyncResult,
  AgentSyncStatus,
} from "../../../../shared/agent-sync";

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

interface AgentsProps {
  connectionId?: string;
  activeProfile: string;
  onSelectProfile: (name: string) => void;
  onChatWith: (name: string) => void;
}

function AgentsScreen({
  activeProfile,
  onSelectProfile,
  onChatWith,
  target,
  isCurrent,
}: AgentsProps & {
  target: ProfileEditorTarget;
  isCurrent: (target: ProfileEditorTarget) => boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const { openProfile } = useProfileModal();
  const live = useProfileEditorLifetime({ target, isCurrent });
  const local = target.mode === "local";
  const remote = target.mode === "remote";
  const readGeneration = useRef(0);
  const createGeneration = useRef(0);
  const actionGeneration = useRef(0);
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
    if (!live()) return;
    const generation = ++readGeneration.current;
    try {
      const list = await window.hermesAPI.listProfiles(target);
      if (live() && readGeneration.current === generation) setProfiles(list);
    } catch (reason) {
      if (live() && readGeneration.current === generation)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (live() && readGeneration.current === generation) setLoading(false);
    }
  }, [target, live]);

  const gatewayPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollGeneration = useRef(0);
  const stopGatewayPoll = useCallback((): void => {
    pollGeneration.current += 1;
    if (gatewayPollRef.current) clearTimeout(gatewayPollRef.current);
    gatewayPollRef.current = null;
  }, []);
  const pollGatewayReady = useCallback(
    (name: string): void => {
      if (!live() || remote) return;
      stopGatewayPoll();
      const generation = pollGeneration.current;
      let attempts = 15;
      const current = (): boolean =>
        live() && pollGeneration.current === generation;
      const tick = async (): Promise<void> => {
        if (!current()) return;
        attempts -= 1;
        const read = ++readGeneration.current;
        try {
          const list = await window.hermesAPI.listProfiles(target);
          if (!current()) return;
          if (readGeneration.current === read) setProfiles(list);
          if (list.find((p) => p.id === name)?.gatewayRunning) {
            setStartingProfile(null);
            return;
          }
        } catch {
          /* A transient SSH read can retry within the captured lifetime. */
        }
        if (!current()) return;
        if (attempts <= 0) {
          setStartingProfile(null);
          return;
        }
        gatewayPollRef.current = setTimeout(tick, 700);
      };
      gatewayPollRef.current = setTimeout(tick, 700);
    },
    [target, live, remote, stopGatewayPoll],
  );
  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);
  useEffect(() => stopGatewayPoll, [stopGatewayPoll]);

  const [syncStatus, setSyncStatus] = useState<AgentSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const syncBusy = useRef(false);
  const autoSyncedRef = useRef(false);
  const refreshSyncStatus = useCallback(async (): Promise<void> => {
    if (!local || !live()) return;
    try {
      const status = await window.hermesAPI.getAgentSyncStatus();
      if (live()) setSyncStatus(status);
    } catch {
      /* An unavailable account bridge leaves sync hidden. */
    }
  }, [local, live]);
  const runSync = useCallback(async (): Promise<void> => {
    if (!local || !live() || syncBusy.current) return;
    syncBusy.current = true;
    setSyncing(true);
    try {
      const result = await window.hermesAPI.syncAgents(target);
      if (!live()) return;
      setSyncStatus((s) => (s ? { ...s, lastResult: result } : s));
      if (result.outcomes.some((o) => o.action === "created-local"))
        await loadProfiles();
    } catch (reason) {
      if (live())
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      syncBusy.current = false;
      if (live()) {
        setSyncing(false);
        void refreshSyncStatus();
      }
    }
  }, [local, live, target, loadProfiles, refreshSyncStatus]);
  useEffect(() => {
    if (!local) return;
    void (async () => {
      try {
        const status = await window.hermesAPI.getAgentSyncStatus();
        if (!live()) return;
        setSyncStatus(status);
        if (status.signedIn && !status.running && !autoSyncedRef.current) {
          autoSyncedRef.current = true;
          void runSync();
        }
      } catch {
        /* Account bridge unavailable. */
      }
    })();
  }, [local, live, runSync]);
  useEffect(() => {
    if (!local || !window.hermesAPI.onAgentSyncUpdated) return;
    return window.hermesAPI.onAgentSyncUpdated((result: AgentSyncResult) => {
      if (!live()) return;
      setSyncStatus((s) => (s ? { ...s, lastResult: result } : s));
      if (result.outcomes.some((o) => o.action === "created-local"))
        void loadProfiles();
    });
  }, [local, live, loadProfiles]);

  function syncSummary(result: AgentSyncResult): string {
    if (result.status === "unauthorized") return t("agents.syncUnauthorized");
    if (result.status === "error")
      return result.error || t("agents.syncFailed");
    const counts = { pushed: 0, pulled: 0, created: 0, errors: 0 };
    for (const o of result.outcomes) {
      if (o.action === "pushed" || o.action === "created-remote")
        counts.pushed++;
      else if (o.action === "pulled") counts.pulled++;
      if (o.action === "created-local") counts.created++;
      if (o.action === "error") counts.errors++;
    }
    if (counts.errors > 0)
      return t("agents.syncErrors", { count: counts.errors });
    if (counts.pushed + counts.pulled + counts.created === 0)
      return t("agents.syncUpToDate");
    return t("agents.syncSummary", counts);
  }

  function openCreate(): void {
    if (!live()) return;
    createGeneration.current += 1;
    setCreating(false);
    setNewName("");
    setError("");
    setCloneConfig(true);
    setCloneSource(activeProfile || "default");
    setShowCreate(true);
  }
  function closeCreate(): void {
    createGeneration.current += 1;
    setCreating(false);
    setShowCreate(false);
    setError("");
  }
  async function handleCreate(): Promise<void> {
    const name = newName.trim();
    if (!live() || !name || creating) return;
    const generation = ++createGeneration.current;
    const current = (): boolean =>
      live() && createGeneration.current === generation;
    setCreating(true);
    setError("");
    try {
      const result = await window.hermesAPI.createProfile(
        name,
        cloneConfig ? cloneSource : null,
        target,
      );
      if (!current()) return;
      if (result.success) {
        setShowCreate(false);
        setNewName("");
      } else setError(result.error || t("agents.createFailed"));
      await loadProfiles();
    } catch (reason) {
      if (current()) {
        setError(reason instanceof Error ? reason.message : String(reason));
        await loadProfiles();
      }
    } finally {
      if (current()) setCreating(false);
    }
  }
  async function selectProfile(name: string, chat: boolean): Promise<void> {
    if (!live()) return;
    const generation = ++actionGeneration.current;
    stopGatewayPoll();
    const current = (): boolean =>
      live() && actionGeneration.current === generation;
    setError("");
    const alreadyRunning = profiles.find((p) => p.id === name)?.gatewayRunning;
    setStartingProfile(remote || alreadyRunning ? null : name);
    try {
      if (!(await window.hermesAPI.setActiveProfile(name, target)))
        throw new Error("The profile could not be selected.");
      if (!current()) return;
      if (chat) onChatWith(name);
      else onSelectProfile(name);
      if (!current()) return;
      void loadProfiles();
      if (!chat) pollGatewayReady(name);
    } catch (reason) {
      if (current()) {
        setStartingProfile(null);
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    }
  }
  const handleSelect = (name: string): Promise<void> =>
    selectProfile(name, false);
  const handleChatWith = (name: string): Promise<void> =>
    selectProfile(name, true);

  function providerLabel(provider: string): string {
    if (!provider || provider === "auto") return t("agents.auto");
    if (provider === "custom") return t("agents.local");
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  }

  if (loading) {
    return (
      <div className="agents-container">
        <div className="agents-loading">
          <OrbLoader state="searching" size={64} />
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
        <div className="agents-header-actions">
          {local && syncStatus && !syncStatus.signedIn && (
            <span
              className="agents-sync-hint"
              title={t("agents.syncSignedOutHint")}
            >
              {t("agents.syncSignedOut")}
            </span>
          )}
          {local && syncStatus?.signedIn && (
            <span
              className="agents-sync-hint"
              title={
                syncStatus.lastResult?.outcomes
                  .flatMap((o) => o.warnings.map((w) => `${o.profile}: ${w}`))
                  .join("\n") ||
                (syncStatus.accountLabel ?? "")
              }
            >
              {syncStatus.lastResult
                ? syncSummary(syncStatus.lastResult)
                : (syncStatus.accountLabel ?? "")}
            </span>
          )}
          {local && syncStatus?.signedIn && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => void runSync()}
              disabled={syncing}
            >
              {syncing ? t("agents.syncing") : t("agents.sync")}
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={openCreate}>
            <Plus size={14} />
            {t("agents.newAgent")}
          </button>
        </div>
      </div>

      {!showCreate && error && (
        <div role="alert" className="agents-create-error">
          {error}
        </div>
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
                setNewName(e.target.value);
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
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {error && (
            <div role="alert" className="agents-create-error">
              {error}
            </div>
          )}
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
            key={p.id}
            className={`agents-row ${activeProfile === p.id ? "active" : ""}`}
            onClick={() => handleSelect(p.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              // Only the row itself — not Enter bubbling up from the edit/chat
              // buttons — should switch the profile.
              if (e.key === "Enter" && e.target === e.currentTarget) {
                handleSelect(p.id);
              }
            }}
          >
            <div className="agents-cell-profile">
              <ProfileAvatar
                name={p.id}
                color={p.color}
                avatar={p.avatar}
                size={36}
              />
              <div className="agents-row-info">
                <div className="agents-row-name">{p.name}</div>
                <div className="agents-row-sub">
                  {p.id !== p.name ? `${p.id} · ` : ""}
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
              {startingProfile === p.id && !p.gatewayRunning ? (
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
              {!remote && (
                <button
                  type="button"
                  className="agents-row-edit"
                  title={t("agents.editAppearanceFor", {
                    name: p.name,
                  })}
                  aria-label={t("agents.editAppearanceFor", {
                    name: p.name,
                  })}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!live()) return;
                    setError("");
                    openProfile(p.id, {
                      onChanged: loadProfiles,
                      onDeleted: (n) => {
                        if (live() && activeProfile === n)
                          onSelectProfile("default");
                      },
                    });
                  }}
                >
                  <Pencil size={14} />
                </button>
              )}
              <button
                className="btn btn-primary btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleChatWith(p.id);
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

export default function Agents(props: AgentsProps): React.JSX.Element {
  const scope = useProfileEditorTarget("default", props.connectionId);
  if (!scope.target)
    return (
      <div className="agents-container">
        {scope.error ? (
          <div role="alert">{scope.error}</div>
        ) : (
          <OrbLoader state="searching" size={64} />
        )}
      </div>
    );
  return (
    <AgentsScreen
      key={JSON.stringify([scope.target.scopeToken, scope.revision])}
      {...props}
      target={scope.target}
      isCurrent={scope.isCurrent}
    />
  );
}
