import { createContext, useContext, useEffect, useState } from "react";
import {
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  THEMES,
  THEME_STORAGE_KEY as STORAGE_KEY,
} from "../constants";

const THEME_APPEARANCE = new Map(THEMES.map((t) => [t.id, t.appearance]));

/** "system" follows the OS preference; any other value is a theme id. */
type Theme = "system" | string;

interface ThemeContextValue {
  /** The user's selection: "system" or a specific theme id. */
  theme: Theme;
  /** The theme id actually applied to <html> (never "system"). */
  resolved: string;
  setTheme: (theme: Theme) => void;
  /** Whether corners are rounded (radius tokens) or squared off (0). */
  rounded: boolean;
  setRounded: (rounded: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  resolved: DEFAULT_DARK_THEME,
  setTheme: () => {},
  rounded: true,
  setRounded: () => {},
});

const THEME_IDS = new Set(THEMES.map((t) => t.id));
const RADIUS_STORAGE_KEY = "hermes-rounded";

function getSystemTheme(): string {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? DEFAULT_DARK_THEME
    : DEFAULT_LIGHT_THEME;
}

function resolve(theme: Theme): string {
  return theme === "system" ? getSystemTheme() : theme;
}

export function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "system" || (stored && THEME_IDS.has(stored))) return stored;
    return DEFAULT_DARK_THEME;
  });
  const [resolved, setResolved] = useState<string>(() => resolve(theme));
  const [rounded, setRoundedState] = useState<boolean>(
    () => localStorage.getItem(RADIUS_STORAGE_KEY) !== "false",
  );

  function setTheme(next: Theme): void {
    setThemeState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }

  function setRounded(next: boolean): void {
    setRoundedState(next);
    localStorage.setItem(RADIUS_STORAGE_KEY, String(next));
  }

  // Listen for system preference changes
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function onChange(): void {
      if (theme === "system") {
        setResolved(getSystemTheme());
      }
    }
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  // Update resolved whenever theme changes
  useEffect(() => {
    setResolved(resolve(theme));
  }, [theme]);

  // Apply data-theme attribute to <html>
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved);
  }, [resolved]);

  // Keep the native window appearance (macOS vibrancy material tone) in step
  // with the theme. "System" passes through so its prefers-color-scheme still
  // follows the OS; an explicit theme forces its own appearance so the sidebar
  // material matches it instead of the OS setting.
  useEffect(() => {
    const source =
      theme === "system"
        ? "system"
        : (THEME_APPEARANCE.get(resolved) ?? "dark");
    void window.hermesAPI?.setNativeAppearance?.(source);
  }, [theme, resolved]);

  // Apply data-radius attribute to <html> ("none" squares off all corners)
  useEffect(() => {
    document.documentElement.setAttribute(
      "data-radius",
      rounded ? "default" : "none",
    );
  }, [rounded]);

  return (
    <ThemeContext.Provider
      value={{ theme, resolved, setTheme, rounded, setRounded }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
