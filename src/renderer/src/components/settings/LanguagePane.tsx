import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
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
        <LanguageSelect locale={locale} onSelect={setLocale} />
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
        <label className="tools-toggle">
          <input
            type="checkbox"
            aria-label={t("settings.spellcheck.enable")}
            checked={spellcheckEnabled}
            onChange={(event) => setSpellcheckEnabled(event.target.checked)}
          />
          <span className="tools-toggle-track" />
        </label>
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

function LanguageSelect({
  locale,
  onSelect,
}: {
  locale: AppLocale;
  onSelect: (l: AppLocale) => void;
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [isOpen]);

  return (
    <div className="settings-language-select" ref={ref}>
      <button
        type="button"
        className="settings-language-trigger"
        onClick={() => setIsOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span>{LANGUAGE_NATIVE_NAMES[locale]}</span>
        <ChevronDown size={14} />
      </button>
      {isOpen && (
        <div className="settings-language-dropdown" role="listbox">
          {APP_LOCALES.map((l) => {
            const active = l === locale;
            return (
              <button
                key={l}
                type="button"
                role="option"
                aria-selected={active}
                className={`settings-language-option ${active ? "active" : ""}`}
                onClick={() => {
                  onSelect(l);
                  setIsOpen(false);
                }}
              >
                <span>{LANGUAGE_NATIVE_NAMES[l]}</span>
                {active && <Check size={14} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
