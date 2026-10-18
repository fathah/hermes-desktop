export type AppLocale =
  | "en"
  | "ar"
  | "es"
  | "fa"
  | "he"
  | "id"
  | "ja"
  | "ko"
  | "pl"
  | "pt-BR"
  | "pt-PT"
  | "tr"
  | "zh-CN"
  | "zh-TW";

export type TranslationTree = {
  [key: string]: string | TranslationTree;
};
