export type AppLocale = "en" | "es" | "pt-BR" | "zh-CN";

export type TranslationTree = {
  [key: string]: string | TranslationTree;
};
