export type AppLocale = "en";

export type TranslationTree = {
  [key: string]: string | TranslationTree;
};
