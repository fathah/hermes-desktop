import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import artoriaAvalon from "../assets/backgrounds/artoria-avalon.png";
import artoriaCoronation from "../assets/backgrounds/artoria-coronation.jpg";
import cyberpunkMoon from "../assets/backgrounds/cyberpunk-moon.png";
import {
  isCustomSoftBackgroundId,
  type CustomSoftBackground,
} from "../../../shared/soft-backgrounds";

export const SOFT_BACKGROUNDS = [
  { id: "artoria-avalon", name: "Artoria · Avalon", image: artoriaAvalon },
  {
    id: "artoria-coronation",
    name: "Artoria · Coronation",
    image: artoriaCoronation,
  },
  { id: "cyberpunk-moon", name: "Cyberpunk · Moon", image: cyberpunkMoon },
] as const;

export type SoftBackgroundId =
  | "none"
  | (typeof SOFT_BACKGROUNDS)[number]["id"]
  | `custom:${string}`;

interface SoftBackgroundContextValue {
  activeProfile: string;
  backgroundForProfile: (profile: string) => SoftBackgroundId;
  customBackgrounds: CustomSoftBackground[];
  addCustomBackgrounds: () => Promise<CustomSoftBackground[]>;
  removeCustomBackground: (id: `custom:${string}`) => Promise<void>;
  customBackgroundBusy: boolean;
  customBackgroundError: boolean;
  setActiveProfile: (profile: string) => void;
  setBackgroundForProfile: (
    profile: string,
    background: SoftBackgroundId,
  ) => void;
}

const LEGACY_STORAGE_KEY = "hermes-soft-background";
const STORAGE_KEY = "hermes-soft-backgrounds-by-profile";
const BACKGROUND_IDS = new Set<SoftBackgroundId>([
  "none",
  ...SOFT_BACKGROUNDS.map((background) => background.id),
]);

const SoftBackgroundContext = createContext<SoftBackgroundContextValue>({
  activeProfile: "default",
  backgroundForProfile: () => "none",
  customBackgrounds: [],
  addCustomBackgrounds: async () => [],
  removeCustomBackground: async () => {},
  customBackgroundBusy: false,
  customBackgroundError: false,
  setActiveProfile: () => {},
  setBackgroundForProfile: () => {},
});

function isKnownBackground(value: string | null): value is SoftBackgroundId {
  return (
    value !== null &&
    (BACKGROUND_IDS.has(value as SoftBackgroundId) ||
      isCustomSoftBackgroundId(value))
  );
}

function loadBackgroundsByProfile(): Record<string, SoftBackgroundId> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      const valid: Record<string, SoftBackgroundId> = {};
      for (const [profile, value] of Object.entries(parsed)) {
        if (typeof value === "string" && isKnownBackground(value)) {
          valid[profile] = value;
        }
      }
      return valid;
    }
  } catch {
    /* fall through to the legacy preference */
  }

  const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  return isKnownBackground(legacy) ? { default: legacy } : {};
}

function persistBackgroundsByProfile(
  backgrounds: Record<string, SoftBackgroundId>,
): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(backgrounds));
}

/** Persists and applies the optional, softly rendered app wallpaper. */
export function SoftBackgroundProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [activeProfile, setActiveProfileState] = useState("default");
  const [backgroundsByProfile, setBackgroundsByProfile] = useState<
    Record<string, SoftBackgroundId>
  >(loadBackgroundsByProfile);
  const [customBackgrounds, setCustomBackgrounds] = useState<
    CustomSoftBackground[]
  >([]);
  const [customBackgroundsLoaded, setCustomBackgroundsLoaded] = useState(false);
  const [customBackgroundBusy, setCustomBackgroundBusy] = useState(false);
  const [customBackgroundError, setCustomBackgroundError] = useState(false);

  const backgroundForProfile = useCallback(
    (profile: string): SoftBackgroundId =>
      backgroundsByProfile[profile || "default"] ?? "none",
    [backgroundsByProfile],
  );

  const setActiveProfile = useCallback((profile: string): void => {
    setActiveProfileState(profile || "default");
  }, []);

  const setBackgroundForProfile = useCallback(
    (profile: string, next: SoftBackgroundId): void => {
      const profileId = profile || "default";
      setBackgroundsByProfile((current) => {
        const updated = { ...current, [profileId]: next };
        persistBackgroundsByProfile(updated);
        return updated;
      });
    },
    [],
  );

  useEffect(() => {
    window.hermesAPI
      .listSoftBackgrounds()
      .then(setCustomBackgrounds)
      .catch(() => setCustomBackgroundError(true))
      .finally(() => setCustomBackgroundsLoaded(true));
  }, []);

  useEffect(() => {
    if (!customBackgroundsLoaded) return;
    setBackgroundsByProfile((current) => {
      let changed = false;
      const updated = { ...current };
      for (const [profile, value] of Object.entries(updated)) {
        if (
          isCustomSoftBackgroundId(value) &&
          !customBackgrounds.some((option) => option.id === value)
        ) {
          updated[profile] = "none";
          changed = true;
        }
      }
      if (changed) persistBackgroundsByProfile(updated);
      return changed ? updated : current;
    });
  }, [customBackgrounds, customBackgroundsLoaded]);

  const addCustomBackgrounds = useCallback(async (): Promise<
    CustomSoftBackground[]
  > => {
    setCustomBackgroundBusy(true);
    setCustomBackgroundError(false);
    try {
      const added = await window.hermesAPI.addSoftBackgrounds();
      if (added.length === 0) return [];
      setCustomBackgrounds((current) => [...current, ...added]);
      return added;
    } catch {
      setCustomBackgroundError(true);
      return [];
    } finally {
      setCustomBackgroundBusy(false);
    }
  }, []);

  const removeCustomBackground = useCallback(
    async (id: `custom:${string}`): Promise<void> => {
      setCustomBackgroundBusy(true);
      setCustomBackgroundError(false);
      try {
        const removed = await window.hermesAPI.removeSoftBackground(id);
        if (!removed) {
          setCustomBackgroundError(true);
          return;
        }
        setCustomBackgrounds((current) =>
          current.filter((option) => option.id !== id),
        );
        setBackgroundsByProfile((current) => {
          let changed = false;
          const updated = { ...current };
          for (const [profile, value] of Object.entries(updated)) {
            if (value === id) {
              updated[profile] = "none";
              changed = true;
            }
          }
          if (changed) persistBackgroundsByProfile(updated);
          return changed ? updated : current;
        });
      } catch {
        setCustomBackgroundError(true);
      } finally {
        setCustomBackgroundBusy(false);
      }
    },
    [],
  );

  const availableBackgrounds = useMemo(
    () => [...SOFT_BACKGROUNDS, ...customBackgrounds],
    [customBackgrounds],
  );
  const background = backgroundForProfile(activeProfile);

  useEffect(() => {
    const root = document.documentElement;
    const selected = availableBackgrounds.find(
      (option) => option.id === background,
    );

    root.dataset.softBackground = background;
    if (selected) {
      root.style.setProperty(
        "--soft-background-image",
        `url("${selected.image}")`,
      );
    } else {
      root.style.removeProperty("--soft-background-image");
    }
  }, [availableBackgrounds, background]);

  return (
    <SoftBackgroundContext.Provider
      value={{
        activeProfile,
        backgroundForProfile,
        customBackgrounds,
        addCustomBackgrounds,
        removeCustomBackground,
        customBackgroundBusy,
        customBackgroundError,
        setActiveProfile,
        setBackgroundForProfile,
      }}
    >
      {children}
    </SoftBackgroundContext.Provider>
  );
}

export function useSoftBackground(): SoftBackgroundContextValue {
  return useContext(SoftBackgroundContext);
}
