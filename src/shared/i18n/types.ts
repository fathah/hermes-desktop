export type AppLocale =
  | "en"
  | "be"
  | "ar"
  | "es"
  | "fa"
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
