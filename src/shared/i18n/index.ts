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
import commonPl from "./locales/pl/common";
import navigationPl from "./locales/pl/navigation";
import welcomePl from "./locales/pl/welcome";
import setupPl from "./locales/pl/setup";
import chatPl from "./locales/pl/chat";
import settingsPl from "./locales/pl/settings";
import sessionsPl from "./locales/pl/sessions";
import modelsPl from "./locales/pl/models";
import providersPl from "./locales/pl/providers";
import errorsPl from "./locales/pl/errors";
import skillsPl from "./locales/pl/skills";
import gatewayPl from "./locales/pl/gateway";
import soulPl from "./locales/pl/soul";
import memoryPl from "./locales/pl/memory";
import installPl from "./locales/pl/install";
import constantsPl from "./locales/pl/constants";
import commonEs from "./locales/es/common";
import navigationEs from "./locales/es/navigation";
import welcomeEs from "./locales/es/welcome";
import setupEs from "./locales/es/setup";
import chatEs from "./locales/es/chat";
import settingsEs from "./locales/es/settings";
import sessionsEs from "./locales/es/sessions";
import modelsEs from "./locales/es/models";
import providersEs from "./locales/es/providers";
import errorsEs from "./locales/es/errors";
import skillsEs from "./locales/es/skills";
import gatewayEs from "./locales/es/gateway";
import soulEs from "./locales/es/soul";
import memoryEs from "./locales/es/memory";
import installEs from "./locales/es/install";
import constantsEs from "./locales/es/constants";
import commonId from "./locales/id/common";
import navigationId from "./locales/id/navigation";
import welcomeId from "./locales/id/welcome";
import setupId from "./locales/id/setup";
import chatId from "./locales/id/chat";
import settingsId from "./locales/id/settings";
import sessionsId from "./locales/id/sessions";
import modelsId from "./locales/id/models";
import providersId from "./locales/id/providers";
import errorsId from "./locales/id/errors";
import skillsId from "./locales/id/skills";
import gatewayId from "./locales/id/gateway";
import soulId from "./locales/id/soul";
import memoryId from "./locales/id/memory";
import installId from "./locales/id/install";
import constantsId from "./locales/id/constants";
import commonZh from "./locales/zh-CN/common";
import navigationZh from "./locales/zh-CN/navigation";
import welcomeZh from "./locales/zh-CN/welcome";
import setupZh from "./locales/zh-CN/setup";
import chatZh from "./locales/zh-CN/chat";
import settingsZh from "./locales/zh-CN/settings";
import sessionsZh from "./locales/zh-CN/sessions";
import modelsZh from "./locales/zh-CN/models";
import providersZh from "./locales/zh-CN/providers";
import errorsZh from "./locales/zh-CN/errors";
import skillsZh from "./locales/zh-CN/skills";
import gatewayZh from "./locales/zh-CN/gateway";
import soulZh from "./locales/zh-CN/soul";
import memoryZh from "./locales/zh-CN/memory";
import installZh from "./locales/zh-CN/install";
import constantsZh from "./locales/zh-CN/constants";
import commonZhTw from "./locales/zh-TW/common";
import navigationZhTw from "./locales/zh-TW/navigation";
import welcomeZhTw from "./locales/zh-TW/welcome";
import setupZhTw from "./locales/zh-TW/setup";
import chatZhTw from "./locales/zh-TW/chat";
import settingsZhTw from "./locales/zh-TW/settings";
import sessionsZhTw from "./locales/zh-TW/sessions";
import modelsZhTw from "./locales/zh-TW/models";
import providersZhTw from "./locales/zh-TW/providers";
import errorsZhTw from "./locales/zh-TW/errors";
import skillsZhTw from "./locales/zh-TW/skills";
import gatewayZhTw from "./locales/zh-TW/gateway";
import soulZhTw from "./locales/zh-TW/soul";
import memoryZhTw from "./locales/zh-TW/memory";
import installZhTw from "./locales/zh-TW/install";
import constantsZhTw from "./locales/zh-TW/constants";
import commonJa from "./locales/ja/common";
import navigationJa from "./locales/ja/navigation";
import welcomeJa from "./locales/ja/welcome";
import setupJa from "./locales/ja/setup";
import chatJa from "./locales/ja/chat";
import settingsJa from "./locales/ja/settings";
import sessionsJa from "./locales/ja/sessions";
import modelsJa from "./locales/ja/models";
import providersJa from "./locales/ja/providers";
import errorsJa from "./locales/ja/errors";
import skillsJa from "./locales/ja/skills";
import gatewayJa from "./locales/ja/gateway";
import soulJa from "./locales/ja/soul";
import memoryJa from "./locales/ja/memory";
import installJa from "./locales/ja/install";
import constantsJa from "./locales/ja/constants";
import commonPt from "./locales/pt-BR/common";
import navigationPt from "./locales/pt-BR/navigation";
import welcomePt from "./locales/pt-BR/welcome";
import setupPt from "./locales/pt-BR/setup";
import chatPt from "./locales/pt-BR/chat";
import settingsPt from "./locales/pt-BR/settings";
import sessionsPt from "./locales/pt-BR/sessions";
import modelsPt from "./locales/pt-BR/models";
import providersPt from "./locales/pt-BR/providers";
import errorsPt from "./locales/pt-BR/errors";
import skillsPt from "./locales/pt-BR/skills";
import gatewayPt from "./locales/pt-BR/gateway";
import soulPt from "./locales/pt-BR/soul";
import memoryPt from "./locales/pt-BR/memory";
import installPt from "./locales/pt-BR/install";
import constantsPt from "./locales/pt-BR/constants";
import commonPtPt from "./locales/pt-PT/common";
import navigationPtPt from "./locales/pt-PT/navigation";
import welcomePtPt from "./locales/pt-PT/welcome";
import setupPtPt from "./locales/pt-PT/setup";
import chatPtPt from "./locales/pt-PT/chat";
import settingsPtPt from "./locales/pt-PT/settings";
import sessionsPtPt from "./locales/pt-PT/sessions";
import modelsPtPt from "./locales/pt-PT/models";
import providersPtPt from "./locales/pt-PT/providers";
import errorsPtPt from "./locales/pt-PT/errors";
import skillsPtPt from "./locales/pt-PT/skills";
import gatewayPtPt from "./locales/pt-PT/gateway";
import soulPtPt from "./locales/pt-PT/soul";
import memoryPtPt from "./locales/pt-PT/memory";
import installPtPt from "./locales/pt-PT/install";
import constantsPtPt from "./locales/pt-PT/constants";
import diagnosePtPt from "./locales/pt-PT/diagnose";

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
  pl: {
    translation: {
      common: commonPl,
      navigation: navigationPl,
      welcome: welcomePl,
      setup: setupPl,
      chat: chatPl,
      settings: settingsPl,
      sessions: sessionsPl,
      models: modelsPl,
      providers: providersPl,
      errors: errorsPl,
      skills: skillsPl,
      gateway: gatewayPl,
      soul: soulPl,
      memory: memoryPl,
      install: installPl,
      constants: constantsPl,
    },
  },
  es: {
    translation: {
      common: commonEs,
      navigation: navigationEs,
      welcome: welcomeEs,
      setup: setupEs,
      chat: chatEs,
      settings: settingsEs,
      sessions: sessionsEs,
      models: modelsEs,
      providers: providersEs,
      errors: errorsEs,
      skills: skillsEs,
      gateway: gatewayEs,
      soul: soulEs,
      memory: memoryEs,
      install: installEs,
      constants: constantsEs,
    },
  },
  id: {
    translation: {
      common: commonId,
      navigation: navigationId,
      welcome: welcomeId,
      setup: setupId,
      chat: chatId,
      settings: settingsId,
      sessions: sessionsId,
      models: modelsId,
      providers: providersId,
      errors: errorsId,
      skills: skillsId,
      gateway: gatewayId,
      soul: soulId,
      memory: memoryId,
      install: installId,
      constants: constantsId,
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
      sessions: sessionsZh,
      models: modelsZh,
      providers: providersZh,
      errors: errorsZh,
      skills: skillsZh,
      gateway: gatewayZh,
      soul: soulZh,
      memory: memoryZh,
      install: installZh,
      constants: constantsZh,
    },
  },
  "zh-TW": {
    translation: {
      common: commonZhTw,
      navigation: navigationZhTw,
      welcome: welcomeZhTw,
      setup: setupZhTw,
      chat: chatZhTw,
      settings: settingsZhTw,
      sessions: sessionsZhTw,
      models: modelsZhTw,
      providers: providersZhTw,
      errors: errorsZhTw,
      skills: skillsZhTw,
      gateway: gatewayZhTw,
      soul: soulZhTw,
      memory: memoryZhTw,
      install: installZhTw,
      constants: constantsZhTw,
    },
  },
  "pt-BR": {
    translation: {
      common: commonPt,
      navigation: navigationPt,
      welcome: welcomePt,
      setup: setupPt,
      chat: chatPt,
      settings: settingsPt,
      sessions: sessionsPt,
      models: modelsPt,
      providers: providersPt,
      errors: errorsPt,
      skills: skillsPt,
      gateway: gatewayPt,
      soul: soulPt,
      memory: memoryPt,
      install: installPt,
      constants: constantsPt,
    },
  },
  "pt-PT": {
    translation: {
      common: commonPtPt,
      navigation: navigationPtPt,
      welcome: welcomePtPt,
      setup: setupPtPt,
      chat: chatPtPt,
      settings: settingsPtPt,
      sessions: sessionsPtPt,
      models: modelsPtPt,
      providers: providersPtPt,
      errors: errorsPtPt,
      skills: skillsPtPt,
      gateway: gatewayPtPt,
      soul: soulPtPt,
      memory: memoryPtPt,
      install: installPtPt,
      constants: constantsPtPt,
      diagnose: diagnosePtPt,
    },
  },
  ja: {
    translation: {
      common: commonJa,
      navigation: navigationJa,
      welcome: welcomeJa,
      setup: setupJa,
      chat: chatJa,
      settings: settingsJa,
      sessions: sessionsJa,
      models: modelsJa,
      providers: providersJa,
      errors: errorsJa,
      skills: skillsJa,
      gateway: gatewayJa,
      soul: soulJa,
      memory: memoryJa,
      install: installJa,
      constants: constantsJa,
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
