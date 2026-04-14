export type AppLocale = "en" | "zh-CN";

export type TranslationTree = {
  [key: string]: string | TranslationTree;
};
