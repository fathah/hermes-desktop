export type AppLocale =
  | "en"
  | "ar"
  | "es"
  | "he"
  | "id"
  | "ja"
  | "pl"
  | "pt-BR"
  | "pt-PT"
  | "tr"
  | "zh-CN"
  | "zh-TW";

export type TranslationTree = {
  [key: string]: string | TranslationTree;
};
