export type AppLocale =
  | "en"
  | "es"
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
