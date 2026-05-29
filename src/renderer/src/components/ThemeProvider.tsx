import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";
type ColorTheme = "hermes" | "nous" | "bronze" | "slate" | "mono";
type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  colorTheme: ColorTheme;
  resolved: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  setColorTheme: (colorTheme: ColorTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  colorTheme: "hermes",
  resolved: "dark",
  setTheme: () => {},
  setColorTheme: () => {},
});

import { THEME_STORAGE_KEY as STORAGE_KEY } from "../constants";

const COLOR_THEME_KEY = "hermes-color-theme";

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolve(theme: Theme): ResolvedTheme {
  return theme === "system" ? getSystemTheme() : theme;
}

export function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system")
      return stored;
    return "system";
  });
  const [colorTheme, setColorThemeState] = useState<ColorTheme>(() => {
    const stored = localStorage.getItem(COLOR_THEME_KEY);
    if (stored === "nous" || stored === "bronze" || stored === "slate" || stored === "mono" || stored === "hermes") {
      return stored;
    }
    return "hermes";
  });
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(theme));

  function setTheme(next: Theme): void {
    setThemeState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }

  function setColorTheme(next: ColorTheme): void {
    setColorThemeState(next);
    localStorage.setItem(COLOR_THEME_KEY, next);
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

  useEffect(() => {
    document.documentElement.setAttribute("data-color-theme", colorTheme);
  }, [colorTheme]);

  return (
    <ThemeContext.Provider value={{ theme, colorTheme, resolved, setTheme, setColorTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
