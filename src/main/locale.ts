import {
  DEFAULT_ACTIVE_LOCALE,
  getLocale as getSharedLocale,
  setLocale as setSharedLocale,
  type AppLocale,
} from "../shared/i18n";

export function getAppLocale(): AppLocale {
  return getSharedLocale() || DEFAULT_ACTIVE_LOCALE;
}

export function setAppLocale(locale: AppLocale): AppLocale {
  return setSharedLocale(locale);
}
