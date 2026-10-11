import { useI18n } from "../useI18n";
import { setAnalyticsConsent } from "../../utils/analytics";
import { Toggle } from "../common/Toggle";
import { useSettings } from "./SettingsDataContext";

/** Anonymous usage analytics consent. */
export default function PrivacyPane(): React.JSX.Element {
  const { t } = useI18n();
  const { analyticsEnabled, setAnalyticsEnabled } = useSettings();

  return (
    <div className="settings-modal-pane">
      <div className="settings-field settings-toggle-row">
        <div className="settings-toggle-text">
          <div className="settings-toggle-title">
            {t("settings.analytics.label")}
          </div>
          <div className="settings-field-hint">
            {t("settings.analytics.hint")}
          </div>
        </div>
        <Toggle
          checked={analyticsEnabled}
          label={t("settings.analytics.label")}
          onCheckedChange={(enabled) => {
            setAnalyticsEnabled(enabled);
            setAnalyticsConsent(enabled);
          }}
        />
      </div>
    </div>
  );
}
