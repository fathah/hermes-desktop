import { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import type {
  MacContactsStatus,
  MacSyncResult,
} from "../../../../shared/contacts";

// "Connected Apps" — opt-in sync of the local macOS address book into vault
// people. macOS-only; the section self-hides on every other platform. All the
// privileged work lives behind the already-wired macContacts* IPC, so this
// component only reflects status and reports the sync outcome. The merge is
// non-destructive (vault notes/aliases/tags kept; Contacts fills in
// email/phone/org) — see src/main/mac-contacts.ts.
export default function ConnectedApps({
  profile,
}: {
  profile?: string;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const isMac = window.electron?.process?.platform === "darwin";
  const [status, setStatus] = useState<MacContactsStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<MacSyncResult | null>(null);

  useEffect(() => {
    if (!isMac) return;
    let cancelled = false;
    void window.hermesAPI.macContactsStatus().then((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, [isMac]);

  if (!isMac) return null;

  async function handleSync(): Promise<void> {
    setSyncing(true);
    setResult(null);
    try {
      const synced = await window.hermesAPI.macContactsSync(profile);
      setResult(synced);
      setStatus({ available: synced.available, authorized: synced.authorized });
    } catch (err) {
      setResult({
        available: status?.available ?? true,
        authorized: status?.authorized ?? false,
        added: 0,
        updated: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSyncing(false);
    }
  }

  const unavailable = status !== null && !status.available;
  const permissionRequired =
    status !== null && status.available && !status.authorized && !result;

  let resultMessage: string | null = null;
  let resultOk = false;
  if (result) {
    if (result.error) {
      resultMessage = result.error;
    } else if (result.added === 0 && result.updated === 0) {
      resultMessage = t("settings.macContactsUpToDate");
      resultOk = true;
    } else {
      resultMessage = t("settings.macContactsSynced", {
        added: result.added,
        updated: result.updated,
      });
      resultOk = true;
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-section-title">
        {t("settings.connectedAppsSection")}
      </div>
      <div className="settings-field">
        <div className="settings-field-hint" style={{ marginBottom: 10 }}>
          {t("settings.macContactsHint")}
        </div>
        {unavailable && (
          <div className="settings-field-hint" style={{ marginBottom: 10 }}>
            {t("settings.macContactsUnavailable")}
          </div>
        )}
        {permissionRequired && (
          <div className="settings-field-hint" style={{ marginBottom: 10 }}>
            {t("settings.macContactsPermissionRequired")}
          </div>
        )}
        <div className="settings-hermes-actions">
          <button
            className="btn btn-secondary"
            onClick={handleSync}
            disabled={syncing || unavailable}
          >
            <RefreshCw size={14} style={{ marginRight: 6 }} />
            {syncing
              ? t("settings.macContactsSyncing")
              : t("settings.macContactsSync")}
          </button>
        </div>
        {resultMessage && (
          <div
            className={`settings-hermes-result ${resultOk ? "success" : "error"}`}
            style={{ marginTop: 8 }}
          >
            {resultMessage}
          </div>
        )}
      </div>
    </div>
  );
}
