import { useMemo } from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import {
  DEFAULT_ACTIVE_LOCALE,
  getLocale,
  setLocale as setSharedLocale,
  sharedI18n,
  type AppLocale,
} from "../../../shared/i18n";
import { I18nContext, type I18nContextValue } from "./I18nContext";

void sharedI18n.use(initReactI18next);

export function I18nProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const locale = getLocale() || DEFAULT_ACTIVE_LOCALE;

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale: (nextLocale: AppLocale) => {
        setSharedLocale(nextLocale);
      },
    }),
    [locale],
  );

  return (
    <I18nContext.Provider value={value}>
      <I18nextProvider i18n={sharedI18n}>{children}</I18nextProvider>
    </I18nContext.Provider>
  );
}
