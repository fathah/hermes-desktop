import {
  APP_LOCALES,
  DEFAULT_ACTIVE_LOCALE,
  getLocale as getSharedLocale,
  setLocale as setSharedLocale,
  type AppLocale,
} from "../shared/i18n";
import { readDesktopConfig, writeDesktopConfig } from "./config";

const DESKTOP_LOCALE_KEY = "locale";

function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && APP_LOCALES.includes(value as AppLocale);
}

function readSavedLocale(): AppLocale | undefined {
  const value = readDesktopConfig()[DESKTOP_LOCALE_KEY];
  return isAppLocale(value) ? value : undefined;
}

function writeSavedLocale(locale: AppLocale): void {
  const data = readDesktopConfig();
  data[DESKTOP_LOCALE_KEY] = locale;
  writeDesktopConfig(data);
}

const savedLocale = readSavedLocale();
if (savedLocale) {
  setSharedLocale(savedLocale);
}

export function getAppLocale(): AppLocale {
  return readSavedLocale() || getSharedLocale() || DEFAULT_ACTIVE_LOCALE;
}

export function setAppLocale(locale: AppLocale): AppLocale {
  const nextLocale = setSharedLocale(locale);
  writeSavedLocale(nextLocale);
  return nextLocale;
}
