import { useCallback, useEffect, useState } from "react";
import { Archive } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import type { WorkspaceBackupInfo } from "../../../../shared/sps-types";

// "Workspace Backups" — MED-11 recovery surface over the sps-*-backup IPC.
// A snapshot holds the three authoritative artifacts (workspace.json, vault
// markdown, _manifest.json); restore replaces them, rebuilds the derived note
// index in the main process, and reloads the renderer so the store rehydrates
// from the restored blob.
export default function WorkspaceBackups({
  profile,
}: {
  profile?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const [backups, setBackups] = useState<WorkspaceBackupInfo[]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [messageOk, setMessageOk] = useState(true);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await window.hermesAPI.spsListBackups(profile);
      setBackups(list);
    } catch {
      setBackups([]);
    }
  }, [profile]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function createBackup(): Promise<void> {
    setBusy("create");
    setMessage("");
    try {
      const info = await window.hermesAPI.spsCreateBackup(profile);
      if (info) {
        setMessageOk(true);
        setMessage(t("settings.backupCreated"));
      } else {
        setMessageOk(false);
        setMessage(t("settings.backupFailed"));
      }
      await refresh();
    } finally {
      setBusy("");
    }
  }

  async function restoreBackup(id: string): Promise<void> {
    const confirmed = window.confirm(t("settings.backupRestoreConfirm"));
    if (!confirmed) return;
    setBusy(id);
    setMessage("");
    try {
      const result = await window.hermesAPI.spsRestoreBackup(id, profile);
      if (result.ok) {
        // Rehydrate the workspace store from the restored artifacts.
        window.location.reload();
        return;
      }
      setMessageOk(false);
      setMessage(result.error || t("settings.backupRestoreFailed"));
    } catch (err) {
      setMessageOk(false);
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="settings-section" data-section-tab="dataPrivacy">
      <div className="settings-section-title">
        <Archive size={14} style={{ marginRight: 6 }} />
        {t("settings.backupsSection")}
      </div>
      <div className="settings-field">
        <div className="settings-field-hint" style={{ marginBottom: 10 }}>
          {t("settings.backupsHint")}
        </div>
        <div className="settings-hermes-actions">
          <button
            className="btn btn-secondary"
            onClick={() => void createBackup()}
            disabled={Boolean(busy)}
          >
            {busy === "create"
              ? t("settings.backupCreating")
              : t("settings.backupCreateNow")}
          </button>
        </div>
        {message && (
          <div
            className={`settings-hermes-result ${messageOk ? "success" : "error"}`}
            style={{ marginTop: 8 }}
          >
            {message}
          </div>
        )}
        {backups.length === 0 ? (
          <div className="settings-field-hint" style={{ marginTop: 10 }}>
            {t("settings.backupsEmpty")}
          </div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, marginTop: 10 }}>
            {backups.map((backup) => (
              <li
                key={backup.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 0",
                }}
              >
                <span>{new Date(backup.createdAt).toLocaleString()}</span>
                <span className="settings-field-hint">
                  {formatBytes(backup.bytes)} · {backup.fileCount}{" "}
                  {t("settings.backupFiles")}
                </span>
                <span style={{ flex: 1 }} />
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={Boolean(busy)}
                  onClick={() => void restoreBackup(backup.id)}
                >
                  {busy === backup.id
                    ? t("settings.backupRestoring")
                    : t("settings.backupRestore")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
