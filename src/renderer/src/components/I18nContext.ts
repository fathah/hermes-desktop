import { createContext } from "react";
import type { AppLocale } from "../../../shared/i18n";

export type I18nContextValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
};

export const I18nContext = createContext<I18nContextValue | null>(null);
