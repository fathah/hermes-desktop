import i18next, { type Resource, type i18n } from "i18next";
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
import chatEn from "./locales/en/chat";
import settingsEn from "./locales/en/settings";
import toolsEn from "./locales/en/tools";
import sessionsEn from "./locales/en/sessions";
import modelsEn from "./locales/en/models";
import officeEn from "./locales/en/office";
import errorsEn from "./locales/en/errors";
import schedulesEn from "./locales/en/schedules";
import skillsEn from "./locales/en/skills";
import gatewayEn from "./locales/en/gateway";
import agentsEn from "./locales/en/agents";
import soulEn from "./locales/en/soul";
import memoryEn from "./locales/en/memory";
import installEn from "./locales/en/install";
import commonZh from "./locales/zh-CN/common";
import navigationZh from "./locales/zh-CN/navigation";
import welcomeZh from "./locales/zh-CN/welcome";
import setupZh from "./locales/zh-CN/setup";
import chatZh from "./locales/zh-CN/chat";
import settingsZh from "./locales/zh-CN/settings";
import toolsZh from "./locales/zh-CN/tools";
import sessionsZh from "./locales/zh-CN/sessions";
import modelsZh from "./locales/zh-CN/models";
import officeZh from "./locales/zh-CN/office";
import errorsZh from "./locales/zh-CN/errors";
import schedulesZh from "./locales/zh-CN/schedules";
import skillsZh from "./locales/zh-CN/skills";
import gatewayZh from "./locales/zh-CN/gateway";
import agentsZh from "./locales/zh-CN/agents";
import soulZh from "./locales/zh-CN/soul";
import memoryZh from "./locales/zh-CN/memory";
import installZh from "./locales/zh-CN/install";

export const resources = {
  en: {
    translation: {
      common: commonEn,
      navigation: navigationEn,
      welcome: welcomeEn,
      setup: setupEn,
      chat: chatEn,
      settings: settingsEn,
      tools: toolsEn,
      sessions: sessionsEn,
      models: modelsEn,
      office: officeEn,
      errors: errorsEn,
      schedules: schedulesEn,
      skills: skillsEn,
      gateway: gatewayEn,
      agents: agentsEn,
      soul: soulEn,
      memory: memoryEn,
      install: installEn,
    },
  },
  "zh-CN": {
    translation: {
      common: commonZh,
      navigation: navigationZh,
      welcome: welcomeZh,
      setup: setupZh,
      chat: chatZh,
      settings: settingsZh,
      tools: toolsZh,
      sessions: sessionsZh,
      models: modelsZh,
      office: officeZh,
      errors: errorsZh,
      schedules: schedulesZh,
      skills: skillsZh,
      gateway: gatewayZh,
      agents: agentsZh,
      soul: soulZh,
      memory: memoryZh,
      install: installZh,
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

let locale: AppLocale = DEFAULT_ACTIVE_LOCALE;

export const sharedI18n: i18n = i18next.createInstance();

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
  locale = nextLocale;
  void sharedI18n.changeLanguage(nextLocale);
  return locale;
}

export function t(
  key: string,
  lang: AppLocale = locale,
  options?: Record<string, unknown>,
): string {
  const translated = readKey(resources[lang]?.translation, key);
  const fallback = readKey(resources[FALLBACK_LOCALE].translation, key);
  const base = translated ?? fallback ?? key;

  if (!options) return base;

  return Object.entries(options).reduce((message, [name, value]) => {
    return message.replaceAll(`{{${name}}}`, String(value));
  }, base);
}

export { APP_LOCALES, DEFAULT_ACTIVE_LOCALE, FALLBACK_LOCALE, SOURCE_LOCALE };
export type { AppLocale };
