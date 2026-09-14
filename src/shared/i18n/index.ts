import i18next, { type Resource } from "i18next";
import {
  APP_LOCALES,
  DEFAULT_ACTIVE_LOCALE,
  FALLBACK_LOCALE,
  SOURCE_LOCALE,
  RTL_LOCALES,
  getLocaleDirection,
  type TextDirection,
} from "./config";
import type { AppLocale } from "./types";
import commonEn from "./locales/en/common";
import navigationEn from "./locales/en/navigation";
import discoverEn from "./locales/en/discover";
import welcomeEn from "./locales/en/welcome";
import setupEn from "./locales/en/setup";
import chatEn from "./locales/en/chat";
import settingsEn from "./locales/en/settings";
import toolsEn from "./locales/en/tools";
import sessionsEn from "./locales/en/sessions";
import modelsEn from "./locales/en/models";
import providersEn from "./locales/en/providers";
import officeEn from "./locales/en/office";
import errorsEn from "./locales/en/errors";
import schedulesEn from "./locales/en/schedules";
import skillsEn from "./locales/en/skills";
import gatewayEn from "./locales/en/gateway";
import agentsEn from "./locales/en/agents";
import soulEn from "./locales/en/soul";
import memoryEn from "./locales/en/memory";
import installEn from "./locales/en/install";
import constantsEn from "./locales/en/constants";
import kanbanEn from "./locales/en/kanban";
import diagnoseEn from "./locales/en/diagnose";
import commonHe from "./locales/he/common";
import navigationHe from "./locales/he/navigation";
import discoverHe from "./locales/he/discover";
import welcomeHe from "./locales/he/welcome";
import setupHe from "./locales/he/setup";
import chatHe from "./locales/he/chat";
import settingsHe from "./locales/he/settings";
import toolsHe from "./locales/he/tools";
import sessionsHe from "./locales/he/sessions";
import modelsHe from "./locales/he/models";
import providersHe from "./locales/he/providers";
import officeHe from "./locales/he/office";
import errorsHe from "./locales/he/errors";
import schedulesHe from "./locales/he/schedules";
import skillsHe from "./locales/he/skills";
import gatewayHe from "./locales/he/gateway";
import agentsHe from "./locales/he/agents";
import soulHe from "./locales/he/soul";
import memoryHe from "./locales/he/memory";
import installHe from "./locales/he/install";
import constantsHe from "./locales/he/constants";
import kanbanHe from "./locales/he/kanban";
import diagnoseHe from "./locales/he/diagnose";
import commonPl from "./locales/pl/common";
import navigationPl from "./locales/pl/navigation";
import welcomePl from "./locales/pl/welcome";
import setupPl from "./locales/pl/setup";
import chatPl from "./locales/pl/chat";
import settingsPl from "./locales/pl/settings";
import toolsPl from "./locales/pl/tools";
import sessionsPl from "./locales/pl/sessions";
import modelsPl from "./locales/pl/models";
import providersPl from "./locales/pl/providers";
import officePl from "./locales/pl/office";
import errorsPl from "./locales/pl/errors";
import schedulesPl from "./locales/pl/schedules";
import skillsPl from "./locales/pl/skills";
import gatewayPl from "./locales/pl/gateway";
import agentsPl from "./locales/pl/agents";
import soulPl from "./locales/pl/soul";
import memoryPl from "./locales/pl/memory";
import installPl from "./locales/pl/install";
import constantsPl from "./locales/pl/constants";
import kanbanPl from "./locales/pl/kanban";
import commonEs from "./locales/es/common";
import navigationEs from "./locales/es/navigation";
import welcomeEs from "./locales/es/welcome";
import setupEs from "./locales/es/setup";
import chatEs from "./locales/es/chat";
import settingsEs from "./locales/es/settings";
import toolsEs from "./locales/es/tools";
import sessionsEs from "./locales/es/sessions";
import modelsEs from "./locales/es/models";
import providersEs from "./locales/es/providers";
import officeEs from "./locales/es/office";
import errorsEs from "./locales/es/errors";
import schedulesEs from "./locales/es/schedules";
import skillsEs from "./locales/es/skills";
import gatewayEs from "./locales/es/gateway";
import agentsEs from "./locales/es/agents";
import soulEs from "./locales/es/soul";
import memoryEs from "./locales/es/memory";
import installEs from "./locales/es/install";
import constantsEs from "./locales/es/constants";
import kanbanEs from "./locales/es/kanban";
import diagnoseEs from "./locales/es/diagnose";
import commonId from "./locales/id/common";
import navigationId from "./locales/id/navigation";
import welcomeId from "./locales/id/welcome";
import setupId from "./locales/id/setup";
import chatId from "./locales/id/chat";
import settingsId from "./locales/id/settings";
import toolsId from "./locales/id/tools";
import sessionsId from "./locales/id/sessions";
import modelsId from "./locales/id/models";
import providersId from "./locales/id/providers";
import officeId from "./locales/id/office";
import errorsId from "./locales/id/errors";
import schedulesId from "./locales/id/schedules";
import skillsId from "./locales/id/skills";
import gatewayId from "./locales/id/gateway";
import agentsId from "./locales/id/agents";
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
import toolsZh from "./locales/zh-CN/tools";
import sessionsZh from "./locales/zh-CN/sessions";
import modelsZh from "./locales/zh-CN/models";
import providersZh from "./locales/zh-CN/providers";
import officeZh from "./locales/zh-CN/office";
import errorsZh from "./locales/zh-CN/errors";
import schedulesZh from "./locales/zh-CN/schedules";
import skillsZh from "./locales/zh-CN/skills";
import gatewayZh from "./locales/zh-CN/gateway";
import agentsZh from "./locales/zh-CN/agents";
import soulZh from "./locales/zh-CN/soul";
import memoryZh from "./locales/zh-CN/memory";
import installZh from "./locales/zh-CN/install";
import constantsZh from "./locales/zh-CN/constants";
import kanbanZh from "./locales/zh-CN/kanban";
import commonZhTw from "./locales/zh-TW/common";
import navigationZhTw from "./locales/zh-TW/navigation";
import welcomeZhTw from "./locales/zh-TW/welcome";
import setupZhTw from "./locales/zh-TW/setup";
import chatZhTw from "./locales/zh-TW/chat";
import settingsZhTw from "./locales/zh-TW/settings";
import toolsZhTw from "./locales/zh-TW/tools";
import sessionsZhTw from "./locales/zh-TW/sessions";
import modelsZhTw from "./locales/zh-TW/models";
import providersZhTw from "./locales/zh-TW/providers";
import officeZhTw from "./locales/zh-TW/office";
import errorsZhTw from "./locales/zh-TW/errors";
import schedulesZhTw from "./locales/zh-TW/schedules";
import skillsZhTw from "./locales/zh-TW/skills";
import gatewayZhTw from "./locales/zh-TW/gateway";
import agentsZhTw from "./locales/zh-TW/agents";
import soulZhTw from "./locales/zh-TW/soul";
import memoryZhTw from "./locales/zh-TW/memory";
import installZhTw from "./locales/zh-TW/install";
import constantsZhTw from "./locales/zh-TW/constants";
import kanbanZhTw from "./locales/zh-TW/kanban";
import commonJa from "./locales/ja/common";
import navigationJa from "./locales/ja/navigation";
import welcomeJa from "./locales/ja/welcome";
import setupJa from "./locales/ja/setup";
import chatJa from "./locales/ja/chat";
import settingsJa from "./locales/ja/settings";
import toolsJa from "./locales/ja/tools";
import sessionsJa from "./locales/ja/sessions";
import modelsJa from "./locales/ja/models";
import providersJa from "./locales/ja/providers";
import officeJa from "./locales/ja/office";
import errorsJa from "./locales/ja/errors";
import schedulesJa from "./locales/ja/schedules";
import skillsJa from "./locales/ja/skills";
import gatewayJa from "./locales/ja/gateway";
import agentsJa from "./locales/ja/agents";
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
import toolsPt from "./locales/pt-BR/tools";
import sessionsPt from "./locales/pt-BR/sessions";
import modelsPt from "./locales/pt-BR/models";
import providersPt from "./locales/pt-BR/providers";
import officePt from "./locales/pt-BR/office";
import errorsPt from "./locales/pt-BR/errors";
import schedulesPt from "./locales/pt-BR/schedules";
import skillsPt from "./locales/pt-BR/skills";
import gatewayPt from "./locales/pt-BR/gateway";
import agentsPt from "./locales/pt-BR/agents";
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
import toolsPtPt from "./locales/pt-PT/tools";
import sessionsPtPt from "./locales/pt-PT/sessions";
import modelsPtPt from "./locales/pt-PT/models";
import providersPtPt from "./locales/pt-PT/providers";
import officePtPt from "./locales/pt-PT/office";
import errorsPtPt from "./locales/pt-PT/errors";
import schedulesPtPt from "./locales/pt-PT/schedules";
import skillsPtPt from "./locales/pt-PT/skills";
import gatewayPtPt from "./locales/pt-PT/gateway";
import agentsPtPt from "./locales/pt-PT/agents";
import soulPtPt from "./locales/pt-PT/soul";
import memoryPtPt from "./locales/pt-PT/memory";
import installPtPt from "./locales/pt-PT/install";
import constantsPtPt from "./locales/pt-PT/constants";
import kanbanPtPt from "./locales/pt-PT/kanban";
import diagnosePtPt from "./locales/pt-PT/diagnose";
import commonTr from "./locales/tr/common";
import navigationTr from "./locales/tr/navigation";
import discoverTr from "./locales/tr/discover";
import welcomeTr from "./locales/tr/welcome";
import setupTr from "./locales/tr/setup";
import chatTr from "./locales/tr/chat";
import settingsTr from "./locales/tr/settings";
import toolsTr from "./locales/tr/tools";
import sessionsTr from "./locales/tr/sessions";
import modelsTr from "./locales/tr/models";
import providersTr from "./locales/tr/providers";
import officeTr from "./locales/tr/office";
import errorsTr from "./locales/tr/errors";
import schedulesTr from "./locales/tr/schedules";
import skillsTr from "./locales/tr/skills";
import gatewayTr from "./locales/tr/gateway";
import agentsTr from "./locales/tr/agents";
import soulTr from "./locales/tr/soul";
import memoryTr from "./locales/tr/memory";
import installTr from "./locales/tr/install";
import constantsTr from "./locales/tr/constants";
import kanbanTr from "./locales/tr/kanban";
import diagnoseTr from "./locales/tr/diagnose";
import commonAr from "./locales/ar/common";
import navigationAr from "./locales/ar/navigation";
import discoverAr from "./locales/ar/discover";
import welcomeAr from "./locales/ar/welcome";
import setupAr from "./locales/ar/setup";
import chatAr from "./locales/ar/chat";
import settingsAr from "./locales/ar/settings";
import toolsAr from "./locales/ar/tools";
import sessionsAr from "./locales/ar/sessions";
import modelsAr from "./locales/ar/models";
import providersAr from "./locales/ar/providers";
import officeAr from "./locales/ar/office";
import errorsAr from "./locales/ar/errors";
import schedulesAr from "./locales/ar/schedules";
import skillsAr from "./locales/ar/skills";
import gatewayAr from "./locales/ar/gateway";
import agentsAr from "./locales/ar/agents";
import soulAr from "./locales/ar/soul";
import memoryAr from "./locales/ar/memory";
import installAr from "./locales/ar/install";
import constantsAr from "./locales/ar/constants";
import kanbanAr from "./locales/ar/kanban";
import diagnoseAr from "./locales/ar/diagnose";

export const resources = {
  en: {
    translation: {
      common: commonEn,
      navigation: navigationEn,
      discover: discoverEn,
      welcome: welcomeEn,
      setup: setupEn,
      chat: chatEn,
      settings: settingsEn,
      tools: toolsEn,
      sessions: sessionsEn,
      models: modelsEn,
      providers: providersEn,
      office: officeEn,
      errors: errorsEn,
      schedules: schedulesEn,
      skills: skillsEn,
      gateway: gatewayEn,
      agents: agentsEn,
      soul: soulEn,
      memory: memoryEn,
      install: installEn,
      constants: constantsEn,
      kanban: kanbanEn,
      diagnose: diagnoseEn,
    },
  },
  he: {
    translation: {
      common: commonHe,
      navigation: navigationHe,
      discover: discoverHe,
      welcome: welcomeHe,
      setup: setupHe,
      chat: chatHe,
      settings: settingsHe,
      tools: toolsHe,
      sessions: sessionsHe,
      models: modelsHe,
      providers: providersHe,
      office: officeHe,
      errors: errorsHe,
      schedules: schedulesHe,
      skills: skillsHe,
      gateway: gatewayHe,
      agents: agentsHe,
      soul: soulHe,
      memory: memoryHe,
      install: installHe,
      constants: constantsHe,
      kanban: kanbanHe,
      diagnose: diagnoseHe,
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
      tools: toolsPl,
      sessions: sessionsPl,
      models: modelsPl,
      providers: providersPl,
      office: officePl,
      errors: errorsPl,
      schedules: schedulesPl,
      skills: skillsPl,
      gateway: gatewayPl,
      agents: agentsPl,
      soul: soulPl,
      memory: memoryPl,
      install: installPl,
      constants: constantsPl,
      kanban: kanbanPl,
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
      tools: toolsEs,
      sessions: sessionsEs,
      models: modelsEs,
      providers: providersEs,
      office: officeEs,
      errors: errorsEs,
      schedules: schedulesEs,
      skills: skillsEs,
      gateway: gatewayEs,
      agents: agentsEs,
      soul: soulEs,
      memory: memoryEs,
      install: installEs,
      constants: constantsEs,
      kanban: kanbanEs,
      diagnose: diagnoseEs,
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
      tools: toolsId,
      sessions: sessionsId,
      models: modelsId,
      providers: providersId,
      office: officeId,
      errors: errorsId,
      schedules: schedulesId,
      skills: skillsId,
      gateway: gatewayId,
      agents: agentsId,
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
      tools: toolsZh,
      sessions: sessionsZh,
      models: modelsZh,
      providers: providersZh,
      office: officeZh,
      errors: errorsZh,
      schedules: schedulesZh,
      skills: skillsZh,
      gateway: gatewayZh,
      agents: agentsZh,
      soul: soulZh,
      memory: memoryZh,
      install: installZh,
      constants: constantsZh,
      kanban: kanbanZh,
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
      tools: toolsZhTw,
      sessions: sessionsZhTw,
      models: modelsZhTw,
      providers: providersZhTw,
      office: officeZhTw,
      errors: errorsZhTw,
      schedules: schedulesZhTw,
      skills: skillsZhTw,
      gateway: gatewayZhTw,
      agents: agentsZhTw,
      soul: soulZhTw,
      memory: memoryZhTw,
      install: installZhTw,
      constants: constantsZhTw,
      kanban: kanbanZhTw,
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
      tools: toolsPt,
      sessions: sessionsPt,
      models: modelsPt,
      providers: providersPt,
      office: officePt,
      errors: errorsPt,
      schedules: schedulesPt,
      skills: skillsPt,
      gateway: gatewayPt,
      agents: agentsPt,
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
      tools: toolsPtPt,
      sessions: sessionsPtPt,
      models: modelsPtPt,
      providers: providersPtPt,
      office: officePtPt,
      errors: errorsPtPt,
      schedules: schedulesPtPt,
      skills: skillsPtPt,
      gateway: gatewayPtPt,
      agents: agentsPtPt,
      soul: soulPtPt,
      memory: memoryPtPt,
      install: installPtPt,
      constants: constantsPtPt,
      kanban: kanbanPtPt,
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
      tools: toolsJa,
      sessions: sessionsJa,
      models: modelsJa,
      providers: providersJa,
      office: officeJa,
      errors: errorsJa,
      schedules: schedulesJa,
      skills: skillsJa,
      gateway: gatewayJa,
      agents: agentsJa,
      soul: soulJa,
      memory: memoryJa,
      install: installJa,
      constants: constantsJa,
    },
  },
  tr: {
    translation: {
      common: commonTr,
      navigation: navigationTr,
      discover: discoverTr,
      welcome: welcomeTr,
      setup: setupTr,
      chat: chatTr,
      settings: settingsTr,
      tools: toolsTr,
      sessions: sessionsTr,
      models: modelsTr,
      providers: providersTr,
      office: officeTr,
      errors: errorsTr,
      schedules: schedulesTr,
      skills: skillsTr,
      gateway: gatewayTr,
      agents: agentsTr,
      soul: soulTr,
      memory: memoryTr,
      install: installTr,
      constants: constantsTr,
      kanban: kanbanTr,
      diagnose: diagnoseTr,
    },
  },
  ar: {
    translation: {
      common: commonAr,
      navigation: navigationAr,
      discover: discoverAr,
      welcome: welcomeAr,
      setup: setupAr,
      chat: chatAr,
      settings: settingsAr,
      tools: toolsAr,
      sessions: sessionsAr,
      models: modelsAr,
      providers: providersAr,
      office: officeAr,
      errors: errorsAr,
      schedules: schedulesAr,
      skills: skillsAr,
      gateway: gatewayAr,
      agents: agentsAr,
      soul: soulAr,
      memory: memoryAr,
      install: installAr,
      constants: constantsAr,
      kanban: kanbanAr,
      diagnose: diagnoseAr,
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

export {
  APP_LOCALES,
  DEFAULT_ACTIVE_LOCALE,
  FALLBACK_LOCALE,
  SOURCE_LOCALE,
  RTL_LOCALES,
  getLocaleDirection,
};
export type { AppLocale, TextDirection };
