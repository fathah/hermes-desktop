import { createContext, useContext, useEffect, useState } from "react";

const SOUND_KEY = "hermes.preferences.completionSound";
const SPELLCHECK_ENABLED_KEY = "hermes.preferences.spellcheckEnabled";
const SPELLCHECK_SYSTEM_KEY = "hermes.preferences.spellcheckUseSystem";
const SPELLCHECK_LANGUAGES_KEY = "hermes.preferences.spellcheckLanguages";

function storedBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

function storedLanguages(): string[] {
  try {
    const value = JSON.parse(
      localStorage.getItem(SPELLCHECK_LANGUAGES_KEY) || "[]",
    );
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

interface ChatPreferencesValue {
  completionSoundEnabled: boolean;
  setCompletionSoundEnabled: (enabled: boolean) => void;
  spellcheckEnabled: boolean;
  setSpellcheckEnabled: (enabled: boolean) => void;
  spellcheckUseSystemLanguages: boolean;
  setSpellcheckUseSystemLanguages: (enabled: boolean) => void;
  spellcheckLanguages: string[];
  setSpellcheckLanguages: (languages: string[]) => void;
  availableSpellcheckLanguages: string[];
  systemSpellcheckLanguages: string[];
}

const FALLBACK_CHAT_PREFERENCES: ChatPreferencesValue = {
  completionSoundEnabled: true,
  setCompletionSoundEnabled: () => undefined,
  spellcheckEnabled: true,
  setSpellcheckEnabled: () => undefined,
  spellcheckUseSystemLanguages: true,
  setSpellcheckUseSystemLanguages: () => undefined,
  spellcheckLanguages: [],
  setSpellcheckLanguages: () => undefined,
  availableSpellcheckLanguages: [],
  systemSpellcheckLanguages: [],
};

const ChatPreferencesContext = createContext<ChatPreferencesValue>(
  FALLBACK_CHAT_PREFERENCES,
);

export function ChatPreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [completionSoundEnabled, setCompletionSoundEnabledState] = useState(
    () => storedBoolean(SOUND_KEY, true),
  );
  const [spellcheckEnabled, setSpellcheckEnabledState] = useState(() =>
    storedBoolean(SPELLCHECK_ENABLED_KEY, true),
  );
  const [spellcheckUseSystemLanguages, setSpellcheckUseSystemLanguagesState] =
    useState(() => storedBoolean(SPELLCHECK_SYSTEM_KEY, true));
  const [spellcheckLanguages, setSpellcheckLanguagesState] =
    useState<string[]>(storedLanguages);
  const [availableSpellcheckLanguages, setAvailableSpellcheckLanguages] =
    useState<string[]>([]);
  const [systemSpellcheckLanguages, setSystemSpellcheckLanguages] = useState<
    string[]
  >([]);
  const [spellcheckerReady, setSpellcheckerReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const getSpellCheckerInfo = window.hermesAPI?.getSpellCheckerInfo;
    if (!getSpellCheckerInfo) return;
    void getSpellCheckerInfo()
      .then((info) => {
        if (cancelled) return;
        const available = Array.from(new Set(info.available)).sort();
        const availableSet = new Set(available);
        const system = (
          info.system.length > 0 ? info.system : info.selected
        ).filter((item) => availableSet.has(item));
        const stored = storedLanguages().filter((item) =>
          availableSet.has(item),
        );
        setAvailableSpellcheckLanguages(available);
        setSystemSpellcheckLanguages(system);
        setSpellcheckLanguagesState(stored.length > 0 ? stored : system);
        setSpellcheckerReady(true);
      })
      .catch(() => {
        // Older Electron/main-process builds keep Chromium's default behavior.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!spellcheckerReady) return;
    const selected = spellcheckUseSystemLanguages
      ? systemSpellcheckLanguages
      : spellcheckLanguages;
    const setSpellCheckerLanguages = window.hermesAPI?.setSpellCheckerLanguages;
    if (!setSpellCheckerLanguages) return;
    void setSpellCheckerLanguages(spellcheckEnabled ? selected : []).catch(
      () => undefined,
    );
  }, [
    spellcheckEnabled,
    spellcheckLanguages,
    spellcheckUseSystemLanguages,
    spellcheckerReady,
    systemSpellcheckLanguages,
  ]);

  const setCompletionSoundEnabled = (enabled: boolean): void => {
    setCompletionSoundEnabledState(enabled);
    try {
      localStorage.setItem(SOUND_KEY, String(enabled));
    } catch {
      /* ignore unavailable storage */
    }
  };
  const setSpellcheckEnabled = (enabled: boolean): void => {
    setSpellcheckEnabledState(enabled);
    try {
      localStorage.setItem(SPELLCHECK_ENABLED_KEY, String(enabled));
    } catch {
      /* ignore unavailable storage */
    }
  };
  const setSpellcheckUseSystemLanguages = (enabled: boolean): void => {
    setSpellcheckUseSystemLanguagesState(enabled);
    try {
      localStorage.setItem(SPELLCHECK_SYSTEM_KEY, String(enabled));
    } catch {
      /* ignore unavailable storage */
    }
  };
  const setSpellcheckLanguages = (languages: string[]): void => {
    const available = new Set(availableSpellcheckLanguages);
    const next = Array.from(
      new Set(languages.filter((language) => available.has(language))),
    ).sort();
    setSpellcheckLanguagesState(next);
    try {
      localStorage.setItem(SPELLCHECK_LANGUAGES_KEY, JSON.stringify(next));
    } catch {
      /* ignore unavailable storage */
    }
  };

  const value: ChatPreferencesValue = {
    completionSoundEnabled,
    setCompletionSoundEnabled,
    spellcheckEnabled,
    setSpellcheckEnabled,
    spellcheckUseSystemLanguages,
    setSpellcheckUseSystemLanguages,
    spellcheckLanguages,
    setSpellcheckLanguages,
    availableSpellcheckLanguages,
    systemSpellcheckLanguages,
  };

  return (
    <ChatPreferencesContext.Provider value={value}>
      {children}
    </ChatPreferencesContext.Provider>
  );
}

export function useChatPreferences(): ChatPreferencesValue {
  return useContext(ChatPreferencesContext);
}
