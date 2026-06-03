export type SpellcheckMode = "off" | "native";
export type AutocompleteMode = "off" | "dictionary" | "llm";
export type TranslationMode = "off" | "on_demand" | "pre_send";

export interface WritingAssistSpellcheckSettings {
  mode: SpellcheckMode;
  language: string;
}

export interface WritingAssistAutocompleteSettings {
  mode: AutocompleteMode;
  modelRef: string;
  debounceMs: number;
  minChars: number;
}

export interface WritingAssistTranslationSettings {
  mode: TranslationMode;
  modelRef: string;
  sourceLanguage: string;
  targetLanguage: string;
  preserveTone: boolean;
}

export interface WritingAssistSettings {
  enabled: boolean;
  spellcheck: WritingAssistSpellcheckSettings;
  autocomplete: WritingAssistAutocompleteSettings;
  translation: WritingAssistTranslationSettings;
}

export const DEFAULT_WRITING_ASSIST_SETTINGS: WritingAssistSettings = {
  enabled: true,
  spellcheck: {
    mode: "native",
    language: "auto",
  },
  autocomplete: {
    mode: "off",
    modelRef: "",
    debounceMs: 250,
    minChars: 3,
  },
  translation: {
    mode: "on_demand",
    modelRef: "",
    sourceLanguage: "auto",
    targetLanguage: "",
    preserveTone: true,
  },
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(
  value: unknown,
  fallback: number,
  min?: number,
  max?: number,
): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  let next = value;
  if (min !== undefined) next = Math.max(min, next);
  if (max !== undefined) next = Math.min(max, next);
  return next;
}

export function normalizeWritingAssistSettings(
  value: unknown,
): WritingAssistSettings {
  const data = asRecord(value);
  const spellcheck = asRecord(data.spellcheck);
  const autocomplete = asRecord(data.autocomplete);
  const translation = asRecord(data.translation);

  const spellcheckMode = asString(
    spellcheck.mode,
    DEFAULT_WRITING_ASSIST_SETTINGS.spellcheck.mode,
  );
  const autocompleteMode = asString(
    autocomplete.mode,
    DEFAULT_WRITING_ASSIST_SETTINGS.autocomplete.mode,
  );
  const translationMode = asString(
    translation.mode,
    DEFAULT_WRITING_ASSIST_SETTINGS.translation.mode,
  );

  return {
    enabled: asBoolean(data.enabled, DEFAULT_WRITING_ASSIST_SETTINGS.enabled),
    spellcheck: {
      mode:
        spellcheckMode === "off" || spellcheckMode === "native"
          ? spellcheckMode
          : DEFAULT_WRITING_ASSIST_SETTINGS.spellcheck.mode,
      language: asString(
        spellcheck.language,
        DEFAULT_WRITING_ASSIST_SETTINGS.spellcheck.language,
      ),
    },
    autocomplete: {
      mode:
        autocompleteMode === "off" ||
        autocompleteMode === "dictionary" ||
        autocompleteMode === "llm"
          ? autocompleteMode
          : DEFAULT_WRITING_ASSIST_SETTINGS.autocomplete.mode,
      modelRef: asString(
        autocomplete.modelRef,
        DEFAULT_WRITING_ASSIST_SETTINGS.autocomplete.modelRef,
      ),
      debounceMs: asNumber(
        autocomplete.debounceMs,
        DEFAULT_WRITING_ASSIST_SETTINGS.autocomplete.debounceMs,
        50,
        2000,
      ),
      minChars: asNumber(
        autocomplete.minChars,
        DEFAULT_WRITING_ASSIST_SETTINGS.autocomplete.minChars,
        1,
        20,
      ),
    },
    translation: {
      mode:
        translationMode === "off" ||
        translationMode === "on_demand" ||
        translationMode === "pre_send"
          ? translationMode
          : DEFAULT_WRITING_ASSIST_SETTINGS.translation.mode,
      modelRef: asString(
        translation.modelRef,
        DEFAULT_WRITING_ASSIST_SETTINGS.translation.modelRef,
      ),
      sourceLanguage: asString(
        translation.sourceLanguage,
        DEFAULT_WRITING_ASSIST_SETTINGS.translation.sourceLanguage,
      ),
      targetLanguage: asString(
        translation.targetLanguage,
        DEFAULT_WRITING_ASSIST_SETTINGS.translation.targetLanguage,
      ),
      preserveTone: asBoolean(
        translation.preserveTone,
        DEFAULT_WRITING_ASSIST_SETTINGS.translation.preserveTone,
      ),
    },
  };
}
