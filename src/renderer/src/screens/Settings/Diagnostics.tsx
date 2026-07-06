import { useCallback, useEffect, useState } from "react";
import { Stethoscope } from "lucide-react";
import { useI18n } from "../../components/useI18n";

// "Diagnostics" — MED-10 surface over the local errors-only sink
// (<HERMES_HOME>/logs/hermes-errors.jsonl). Read-only and strictly local:
// crash/error records are written by the main process and nothing here (or
// there) sends data off the machine.
export default function Diagnostics(): React.JSX.Element {
  const { t } = useI18n();
  const [records, setRecords] = useState<string[]>([]);
  const [busy, setBusy] = useState("");

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const tail = await window.hermesAPI.systemReadErrorLog(100);
      setRecords(tail);
    } catch {
      setRecords([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function openLogs(): Promise<void> {
    setBusy("open");
    try {
      await window.hermesAPI.systemOpenLogs();
    } finally {
      setBusy("");
    }
  }

  async function copyErrors(): Promise<void> {
    await navigator.clipboard?.writeText?.(records.join("\n"));
  }

  async function clearLog(): Promise<void> {
    setBusy("clear");
    try {
      await window.hermesAPI.systemClearErrorLog();
      await refresh();
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="settings-section" data-section-tab="troubleshooting">
      <div className="settings-section-title">
        <Stethoscope size={14} style={{ marginRight: 6 }} />
        {t("settings.diagnosticsSection")}
      </div>
      <div className="settings-field">
        <div className="settings-field-hint" style={{ marginBottom: 10 }}>
          {t("settings.diagnosticsHint")}
        </div>
        <div className="settings-hermes-actions">
          <button
            className="btn btn-secondary"
            onClick={() => void openLogs()}
            disabled={Boolean(busy)}
          >
            {t("settings.diagnosticsOpenFolder")}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => void refresh()}
            disabled={Boolean(busy)}
          >
            {t("settings.refresh")}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => void copyErrors()}
            disabled={Boolean(busy) || records.length === 0}
          >
            {t("settings.diagnosticsCopy")}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => void clearLog()}
            disabled={Boolean(busy) || records.length === 0}
          >
            {busy === "clear"
              ? t("settings.diagnosticsClearing")
              : t("settings.diagnosticsClear")}
          </button>
        </div>
        {records.length === 0 ? (
          <div className="settings-field-hint" style={{ marginTop: 10 }}>
            {t("settings.diagnosticsEmpty")}
          </div>
        ) : (
          <pre
            style={{
              marginTop: 10,
              maxHeight: 240,
              overflow: "auto",
              fontSize: 12,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {records.join("\n")}
          </pre>
        )}
      </div>
    </div>
  );
}
