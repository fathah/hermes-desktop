import { useEffect } from "react";
import { Bot, CircleAlert, RefreshCw, Signal } from "lucide-react";
import { useI18n } from "../useI18n";
import { useSettings } from "./SettingsDataContext";

/** Log files selectable in the viewer, each with a representative icon. */
const LOG_FILES: {
  file: string;
  label: string;
  Icon: React.ComponentType<{ size?: number }>;
}[] = [
  { file: "gateway.log", label: "gateway", Icon: Signal },
  { file: "agent.log", label: "agent", Icon: Bot },
  { file: "errors.log", label: "errors", Icon: CircleAlert },
];

/** Gateway / agent / error log viewer. */
export default function LogsPane(): React.JSX.Element {
  const { t } = useI18n();
  const {
    logContent,
    logFile,
    setLogFile,
    logPath,
    setLogContent,
    setLogPath,
    loadLogs,
  } = useSettings();

  // The pane is only mounted when its nav item is active, so load on mount
  // (replaces the old expand-to-load toggle from the scrolling page).
  useEffect(() => {
    void loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="settings-modal-pane">
      <div className="settings-field">
        <div className="settings-log-tabs">
          {LOG_FILES.map(({ file, label, Icon }) => (
            <button
              key={file}
              className={`btn btn-sm ${logFile === file ? "btn-primary" : "btn-secondary"}`}
              onClick={() => {
                setLogFile(file);
                window.hermesAPI.readLogs(file, 300).then((r) => {
                  setLogContent(r.content);
                  setLogPath(r.path);
                });
              }}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
          <button className="btn btn-sm btn-secondary" onClick={loadLogs}>
            <RefreshCw size={13} />
            {t("settings.refresh")}
          </button>
        </div>
        {logPath && (
          <div className="settings-field-hint" style={{ marginBottom: 4 }}>
            {logPath}
          </div>
        )}
        <pre
          className="settings-hermes-doctor"
          style={{
            maxHeight: 360,
            overflow: "auto",
            fontSize: 11,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {logContent || t("settings.emptyLog")}
        </pre>
      </div>
    </div>
  );
}
