import { useEffect, useMemo, useState } from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import {
  APP_LOCALES,
  DEFAULT_ACTIVE_LOCALE,
  setLocale as setSharedLocale,
  sharedI18n,
  type AppLocale,
} from "../../../shared/i18n";
import { I18nContext, type I18nContextValue } from "./I18nContext";

void sharedI18n.use(initReactI18next);

const STORAGE_KEY = "hermes-locale";

function readStoredLocale(): AppLocale {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && (APP_LOCALES as string[]).includes(raw)) {
      return raw as AppLocale;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_ACTIVE_LOCALE;
}

const initialLocale = readStoredLocale();
setSharedLocale(initialLocale);

export function I18nProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [locale, setLocaleState] = useState<AppLocale>(initialLocale);

  useEffect(() => {
    setSharedLocale(locale);
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale: setLocaleState,
    }),
    [locale],
  );

  return (
    <I18nContext.Provider value={value}>
      <I18nextProvider i18n={sharedI18n}>{children}</I18nextProvider>
    </I18nContext.Provider>
  );
}
