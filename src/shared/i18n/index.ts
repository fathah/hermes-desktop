import i18next, { type Resource } from "i18next";
import {
  APP_LOCALES,
  DEFAULT_ACTIVE_LOCALE,
  FALLBACK_LOCALE,
  SOURCE_LOCALE,
} from "./config";
import type { AppLocale } from "./types";
import commonEn from "./locales/en/common";
import navigationEn from "./locales/en/navigation";
import welcomeEn from "./locales/en/welcome";
import setupEn from "./locales/en/setup";
import onboardingEn from "./locales/en/onboarding";
import chatEn from "./locales/en/chat";
import settingsEn from "./locales/en/settings";
import sessionsEn from "./locales/en/sessions";
import modelsEn from "./locales/en/models";
import providersEn from "./locales/en/providers";
import errorsEn from "./locales/en/errors";
import skillsEn from "./locales/en/skills";
import gatewayEn from "./locales/en/gateway";
import soulEn from "./locales/en/soul";
import memoryEn from "./locales/en/memory";
import installEn from "./locales/en/install";
import constantsEn from "./locales/en/constants";
import diagnoseEn from "./locales/en/diagnose";

export const resources = {
  en: {
    translation: {
      common: commonEn,
      navigation: navigationEn,
      welcome: welcomeEn,
      setup: setupEn,
      onboarding: onboardingEn,
      chat: chatEn,
      settings: settingsEn,
      sessions: sessionsEn,
      models: modelsEn,
      providers: providersEn,
      errors: errorsEn,
      skills: skillsEn,
      gateway: gatewayEn,
      soul: soulEn,
      memory: memoryEn,
      install: installEn,
      constants: constantsEn,
      diagnose: diagnoseEn,
    },
  },
} satisfies Resource;

function readKey(node: unknown, path: string): string | undefined {
  const result = path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, node);

  return typeof result === "string" ? result : undefined;
}

function normalizeLocale(value: unknown): AppLocale {
  return APP_LOCALES.includes(value as AppLocale)
    ? (value as AppLocale)
    : DEFAULT_ACTIVE_LOCALE;
}

let locale: AppLocale = DEFAULT_ACTIVE_LOCALE;

export const sharedI18n = i18next.createInstance();

void sharedI18n.init({
  lng: locale,
  fallbackLng: FALLBACK_LOCALE,
  supportedLngs: APP_LOCALES,
  defaultNS: "translation",
  ns: ["translation"],
  interpolation: {
    escapeValue: false,
  },
  resources,
  initImmediate: false,
});

export function getLocale(): AppLocale {
  return locale;
}

export function setLocale(nextLocale: AppLocale): AppLocale {
  locale = normalizeLocale(nextLocale);
  void sharedI18n.changeLanguage(locale);
  return locale;
}

export function t(
  key: string,
  lang: AppLocale = locale,
  options?: Record<string, unknown>,
): string {
  const translated = readKey(
    resources[normalizeLocale(lang)]?.translation,
    key,
  );
  const fallback = readKey(resources[FALLBACK_LOCALE].translation, key);
  const base = translated ?? fallback ?? key;

  if (!options) return base;

  return Object.entries(options).reduce((message, [name, value]) => {
    return message.replaceAll(`{{${name}}}`, String(value));
  }, base);
}

export { APP_LOCALES, DEFAULT_ACTIVE_LOCALE, FALLBACK_LOCALE, SOURCE_LOCALE };
export type { AppLocale };
