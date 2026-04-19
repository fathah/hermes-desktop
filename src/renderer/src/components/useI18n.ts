import { useContext } from "react";
import { useTranslation } from "react-i18next";
import { I18nContext } from "./I18nContext";

export function useI18n(): {
  locale: "en";
  setLocale: (locale: "en") => void;
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
