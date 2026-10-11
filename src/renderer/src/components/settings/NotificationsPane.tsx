import { useChatPreferences } from "../ChatPreferencesProvider";
import { Toggle } from "../common/Toggle";
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
        <Toggle
          checked={completionSoundEnabled}
          label={t("settings.notifications.completionSound")}
          onCheckedChange={setCompletionSoundEnabled}
        />
      </div>
    </div>
  );
}
