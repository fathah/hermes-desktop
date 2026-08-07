import { useChatPreferences } from "../ChatPreferencesProvider";
import { useI18n } from "../useI18n";

/** Desktop response notification preferences. */
export default function NotificationsPane(): React.JSX.Element {
  const { t } = useI18n();
  const { completionSoundEnabled, setCompletionSoundEnabled } =
    useChatPreferences();

  return (
    <div className="settings-modal-pane">
      <div className="settings-field settings-toggle-row">
        <div className="settings-toggle-text">
          <div className="settings-toggle-title">
            {t("settings.notifications.completionSound")}
          </div>
          <div className="settings-field-hint">
            {t("settings.notifications.completionSoundHint")}
          </div>
        </div>
        <label className="tools-toggle">
          <input
            type="checkbox"
            aria-label={t("settings.notifications.completionSound")}
            checked={completionSoundEnabled}
            onChange={(event) =>
              setCompletionSoundEnabled(event.target.checked)
            }
          />
          <span className="tools-toggle-track" />
        </label>
      </div>
    </div>
  );
}
