export type AppLocale =
  | "en"
  | "es"
  | "he"
  | "id"
  | "ja"
  | "pl"
  | "pt-BR"
  | "pt-PT"
  | "tr"
  | "ru"
  | "zh-CN"
  | "zh-TW";

export type TranslationTree = {
  [key: string]: string | TranslationTree;
};
