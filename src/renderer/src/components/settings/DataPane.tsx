import { Download, Upload } from "lucide-react";
import { useI18n } from "../useI18n";
import { useSettings } from "./SettingsDataContext";

/**
 * Export / import a full Hermes backup archive, plus the OpenClaw → Hermes
 * migration (which imports config, keys, sessions, and skills — a data import,
 * so it lives here rather than under Community).
 */
export default function DataPane(): React.JSX.Element {
  const { t } = useI18n();
  const {
    backingUp,
    backupResult,
    importing,
    importResult,
    handleBackup,
    handleImport,
    openclawFound,
    openclawPath,
    migrationDismissed,
    migrating,
    migrationLog,
    migrationResult,
    migrationResultType,
    migrationLogRef,
    handleMigrate,
    handleDismissMigration,
  } = useSettings();

  return (
    <div className="settings-modal-pane">
      <div className="settings-field">
        <div className="settings-field-hint" style={{ marginBottom: 10 }}>
          {t("settings.dataHint")}
        </div>
        <div className="settings-hermes-actions">
          <button
            className="btn btn-secondary"
            onClick={handleBackup}
            disabled={backingUp}
          >
            <Download size={14} style={{ marginRight: 6 }} />
            {backingUp ? t("settings.backingUp") : t("settings.exportBackup")}
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleImport}
            disabled={importing}
          >
            <Upload size={14} style={{ marginRight: 6 }} />
            {importing ? t("settings.importing") : t("settings.importBackup")}
          </button>
        </div>
        {backupResult && (
          <div
            className={`settings-hermes-result ${backupResult.includes("created") || backupResult.includes("success") ? "success" : "error"}`}
            style={{ marginTop: 8 }}
          >
            {backupResult}
          </div>
        )}
        {importResult && (
          <div
            className={`settings-hermes-result ${importResult.includes("complete") ? "success" : "error"}`}
            style={{ marginTop: 8 }}
          >
            {importResult}
          </div>
        )}
      </div>

      {openclawFound && !migrationDismissed && (
        <div className="settings-migration-banner">
          <div className="settings-migration-header">
            <div>
              <div className="settings-migration-title">
                {t("settings.migrationDetected")}
              </div>
              <div
                className="settings-migration-desc"
                dangerouslySetInnerHTML={{
                  __html: t("settings.migrationDesc", {
                    path: openclawPath || "",
                  }),
                }}
              />
            </div>
            <button
              className="btn-ghost settings-migration-dismiss"
              onClick={handleDismissMigration}
              title={t("settings.migrationDismiss")}
            >
              &times;
            </button>
          </div>
          {migrationLog && (
            <pre className="settings-hermes-doctor" ref={migrationLogRef}>
              {migrationLog}
            </pre>
          )}
          {migrationResult && (
            <div
              className={`settings-hermes-result ${migrationResultType || "error"}`}
            >
              {migrationResult}
            </div>
          )}
          <div className="settings-migration-actions">
            <button
              className="btn btn-primary "
              onClick={handleMigrate}
              disabled={migrating}
            >
              {migrating
                ? t("settings.migrating")
                : t("settings.migrateToHermes")}
            </button>
            <button
              className="btn btn-secondary "
              onClick={handleDismissMigration}
            >
              {t("settings.skip")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
