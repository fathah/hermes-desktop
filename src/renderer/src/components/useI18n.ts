import { useContext } from "react";
import { useTranslation } from "react-i18next";
import { I18nContext } from "./I18nContext";
import type { AppLocale } from "../../../shared/i18n";

export function useI18n(): {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
} {
  const value = useContext(I18nContext);
  const { t } = useTranslation();

  if (!value) {
    throw new Error("useI18n must be used within I18nProvider");
  }

  return {
    ...value,
    t,
  };
}
