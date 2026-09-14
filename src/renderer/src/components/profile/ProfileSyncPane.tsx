import { useCallback, useEffect, useState } from "react";
import { Check, Refresh } from "../../assets/icons";
import { useI18n } from "../useI18n";
import type {
  AgentSyncOutcome,
  AgentSyncResult,
  AgentSyncStatus,
} from "../../../../shared/agent-sync";

interface ProfileSyncPaneProps {
  /** Stable profile id — matches `outcome.profile` from a sync pass. */
  profile: string;
}

/** The last pass's outcome for this specific profile, if any. */
function outcomeForProfile(
  result: AgentSyncResult | null,
  profileId: string,
): AgentSyncOutcome | null {
  if (!result) return null;
  return result.outcomes.find((o) => o.profile === profileId) ?? null;
}

/**
 * Per-profile cloud-sync controls, shown as the profile modal's "Sync" tab.
 * Sync itself is app-wide (one pass reconciles every profile), so "Sync now"
 * triggers the same `syncAgents()` the Agents screen uses and then surfaces
 * this profile's result — a manual path when the auto-sync-on-visit hasn't run.
 */
export default function ProfileSyncPane({
  profile,
}: ProfileSyncPaneProps): React.JSX.Element {
  const { t } = useI18n();
  const [status, setStatus] = useState<AgentSyncStatus | null>(null);
  const [linkedAgentId, setLinkedAgentId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [s, linked] = await Promise.all([
        window.hermesAPI.getAgentSyncStatus(),
        window.hermesAPI.getLinkedAgentId(profile),
      ]);
      setStatus(s);
      setLinkedAgentId(linked);
    } catch {
      // Bridge unavailable (old preload/tests): leave the pane in its hint state.
    }
  }, [profile]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!window.hermesAPI.onAgentSyncUpdated) return undefined;
    return window.hermesAPI.onAgentSyncUpdated(() => {
      void refresh();
    });
  }, [refresh]);

  const runSync = useCallback(async (): Promise<void> => {
    setSyncing(true);
    try {
      await window.hermesAPI.syncAgents();
    } catch {
      // Result is surfaced via the status refresh below.
    } finally {
      setSyncing(false);
      void refresh();
    }
  }, [refresh]);

  const outcome = outcomeForProfile(status?.lastResult ?? null, profile);
  const warnings = outcome?.warnings ?? [];

  function actionLabel(action: AgentSyncOutcome["action"]): string {
    return t(`agents.syncAction.${action}`);
  }

  return (
    <div className="profile-modal-pane profile-sync-pane">
      <div className="profile-sync-header">
        <div>
          <div className="profile-sync-heading">{t("agents.syncTitle")}</div>
          <div className="profile-sync-subtitle">
            {t("agents.syncPaneSubtitle")}
          </div>
        </div>
        {status?.signedIn && (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => void runSync()}
            disabled={syncing || status.running}
          >
            <Refresh size={14} />
            {syncing || status.running
              ? t("agents.syncing")
              : t("agents.syncNow")}
          </button>
        )}
      </div>

      {status && !status.signedIn ? (
        <div className="profile-sync-note">{t("agents.syncSignInHint")}</div>
      ) : status ? (
        <div className="profile-sync-body">
          <div className="profile-sync-row">
            <span className="profile-sync-label">
              {t("agents.syncAccount")}
            </span>
            <span className="profile-sync-value">
              {status.accountLabel ?? "—"}
            </span>
          </div>
          <div className="profile-sync-row">
            <span className="profile-sync-label">{t("agents.syncLink")}</span>
            <span className="profile-sync-value">
              {linkedAgentId ? (
                <span className="profile-sync-linked">
                  <Check size={14} />
                  {t("agents.syncLinked")}
                </span>
              ) : (
                t("agents.syncNotLinked")
              )}
            </span>
          </div>
          {outcome && (
            <div className="profile-sync-row">
              <span className="profile-sync-label">
                {t("agents.syncLastResult")}
              </span>
              <span className="profile-sync-value">
                {actionLabel(outcome.action)}
              </span>
            </div>
          )}
          {status.lastResult?.status === "unauthorized" && (
            <div className="profile-sync-note profile-sync-note-warn">
              {t("agents.syncUnauthorized")}
            </div>
          )}
          {status.lastResult?.status === "error" && (
            <div className="profile-sync-note profile-sync-note-warn">
              {status.lastResult.error || t("agents.syncFailed")}
            </div>
          )}
          {warnings.length > 0 && (
            <ul className="profile-sync-warnings">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
