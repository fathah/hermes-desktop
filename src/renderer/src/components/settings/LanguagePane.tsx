import { Toggle } from "../common/Toggle";
import { SelectMenu } from "../common/SelectMenu";
import { useI18n } from "../useI18n";
import { APP_LOCALES, type AppLocale } from "../../../../shared/i18n";
import { LANGUAGE_NATIVE_NAMES } from "./settingsHelpers";
import { useChatPreferences } from "../ChatPreferencesProvider";

/** Interface language selector. */
export default function LanguagePane(): React.JSX.Element {
  const { t, locale, setLocale } = useI18n();
  const {
    spellcheckEnabled,
    setSpellcheckEnabled,
    spellcheckUseSystemLanguages,
    setSpellcheckUseSystemLanguages,
    spellcheckLanguages,
    setSpellcheckLanguages,
    availableSpellcheckLanguages,
    systemSpellcheckLanguages,
  } = useChatPreferences();

  const toggleLanguage = (language: string): void => {
    if (spellcheckLanguages.includes(language)) {
      if (spellcheckLanguages.length === 1) return;
      setSpellcheckLanguages(
        spellcheckLanguages.filter((item) => item !== language),
      );
    } else {
      setSpellcheckLanguages([...spellcheckLanguages, language]);
    }
  };

  return (
    <div className="settings-modal-pane">
      <div className="settings-field">
        <label className="settings-field-label">
          {t("settings.language.label")}
        </label>
        <SelectMenu
          value={locale}
          triggerLabel={LANGUAGE_NATIVE_NAMES[locale]}
          options={APP_LOCALES.map((item) => ({
            value: item,
            label: LANGUAGE_NATIVE_NAMES[item],
          }))}
          onSelect={(value) => setLocale(value as AppLocale)}
        />
        <div className="settings-field-hint">{t("settings.language.hint")}</div>
      </div>

      <div className="settings-field settings-toggle-row">
        <div className="settings-toggle-text">
          <div className="settings-toggle-title">
            {t("settings.spellcheck.enable")}
          </div>
          <div className="settings-field-hint">
            {t("settings.spellcheck.enableHint")}
          </div>
        </div>
        <Toggle
          checked={spellcheckEnabled}
          label={t("settings.spellcheck.enable")}
          onCheckedChange={setSpellcheckEnabled}
        />
      </div>

      {spellcheckEnabled && (
        <div className="settings-field">
          <label className="settings-spellcheck-mode">
            <input
              type="radio"
              name="spellcheck-language-mode"
              checked={spellcheckUseSystemLanguages}
              onChange={() => setSpellcheckUseSystemLanguages(true)}
            />
            <span>
              <strong>{t("settings.spellcheck.useSystem")}</strong>
              <small>{t("settings.spellcheck.useSystemHint")}</small>
              {systemSpellcheckLanguages.length > 0 && (
                <code>{systemSpellcheckLanguages.join(", ")}</code>
              )}
            </span>
          </label>
          <label className="settings-spellcheck-mode">
            <input
              type="radio"
              name="spellcheck-language-mode"
              checked={!spellcheckUseSystemLanguages}
              onChange={() => setSpellcheckUseSystemLanguages(false)}
            />
            <span>
              <strong>{t("settings.spellcheck.chooseLanguages")}</strong>
              <small>{t("settings.spellcheck.chooseLanguagesHint")}</small>
            </span>
          </label>

          {!spellcheckUseSystemLanguages &&
            (availableSpellcheckLanguages.length === 0 ? (
              <div className="settings-field-hint">
                {t("settings.spellcheck.unavailable")}
              </div>
            ) : (
              <div className="settings-spellcheck-languages">
                {availableSpellcheckLanguages.map((language) => (
                  <label key={language}>
                    <input
                      type="checkbox"
                      checked={spellcheckLanguages.includes(language)}
                      onChange={() => toggleLanguage(language)}
                    />
                    <span>{language}</span>
                  </label>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
