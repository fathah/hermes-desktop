export type AppLocale =
  | "en"
  | "es"
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
