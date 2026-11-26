import { useContext } from "react";
import { useTranslation } from "react-i18next";
import {
  getLocale,
  setLocale as setSharedLocale,
  t as sharedT,
  type AppLocale,
} from "../../../shared/i18n";
import { localizeDefinition } from "../../../shared/i18n/definitions";
import { I18nContext } from "./I18nContext";

export function useI18n(): {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
} {
  const value = useContext(I18nContext);
  const { t } = useTranslation();

  // Components are also exercised outside <I18nProvider> (unit tests, isolated
  // previews). Fall back to the shared i18n instance instead of throwing.
  return {
    locale: value?.locale ?? getLocale(),
    setLocale: value?.setLocale ?? setSharedLocale,
    t: value ? t : (key, options) => sharedT(key, options),
  };
}

/** Пераклад радкоў, якія жывуць у даных (палі платформаў, апісанні камандаў). */
export function useLocalize(): (text: string) => string {
  const { locale } = useI18n();
  return (text: string) => localizeDefinition(text, locale);
}
