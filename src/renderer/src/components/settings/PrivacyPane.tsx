import { useI18n } from "../useI18n";
import { setAnalyticsConsent } from "../../utils/analytics";
import { useSettings } from "./SettingsDataContext";

/** Anonymous usage analytics consent. */
export default function PrivacyPane(): React.JSX.Element {
  const { t } = useI18n();
  const { analyticsEnabled, setAnalyticsEnabled } = useSettings();

  return (
    <div className="settings-modal-pane">
      <div className="settings-field">
        <label className="settings-field-label">
          {t("settings.analytics.label")}
          <label
            className="tools-toggle"
            style={{ marginLeft: 12, verticalAlign: "middle" }}
          >
            <input
              type="checkbox"
              checked={analyticsEnabled}
              onChange={(e) => {
                const enabled = e.target.checked;
                setAnalyticsEnabled(enabled);
                setAnalyticsConsent(enabled);
              }}
            />
            <span className="tools-toggle-track" />
          </label>
        </label>
        <div className="settings-field-hint">
          {t("settings.analytics.hint")}
        </div>
      </div>
    </div>
  );
}
