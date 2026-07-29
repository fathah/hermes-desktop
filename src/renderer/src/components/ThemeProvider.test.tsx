import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { THEMES, THEME_STORAGE_KEY } from "../constants";
import { ThemeProvider, useTheme } from "./ThemeProvider";

type ColorSchemeListener = (event: MediaQueryListEvent) => void;

function installMatchMedia(initiallyDark: boolean): {
  setDark: (dark: boolean) => void;
} {
  let matches = initiallyDark;
  const listeners = new Set<ColorSchemeListener>();
  const mediaQuery = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_type: string, listener: ColorSchemeListener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: ColorSchemeListener) => {
      listeners.delete(listener);
    },
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as MediaQueryList;

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => mediaQuery),
  });

  return {
    setDark(dark: boolean) {
      matches = dark;
      const event = {
        matches: dark,
        media: mediaQuery.media,
      } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
}

function ThemeProbe(): React.JSX.Element {
  const { theme, resolved } = useTheme();
  return <div>{`${theme}:${resolved}`}</div>;
}

describe("ThemeProvider", () => {
  const setNativeAppearance = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-radius");
    setNativeAppearance.mockClear();
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: { setNativeAppearance },
    });
  });

  it("keeps a stored system choice and follows runtime OS changes", async () => {
    // @lat: [[theme-selection#Tests#Stored system theme follows runtime changes]]
    const colorScheme = installMatchMedia(true);
    localStorage.setItem(THEME_STORAGE_KEY, "system");

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    expect(screen.getByText("system:dark")).toBeTruthy();
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-theme", "dark");
      expect(setNativeAppearance).toHaveBeenLastCalledWith("system");
    });

    colorScheme.setDark(false);

    await waitFor(() => {
      expect(screen.getByText("system:light")).toBeTruthy();
      expect(document.documentElement).toHaveAttribute("data-theme", "light");
      expect(setNativeAppearance).toHaveBeenLastCalledWith("system");
    });
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });

  it.each(THEMES)(
    "preserves stored preset $id and pins its native appearance",
    async ({ id, appearance }) => {
      // @lat: [[theme-selection#Tests#Stored presets keep their appearance]]
      installMatchMedia(true);
      localStorage.setItem(THEME_STORAGE_KEY, id);

      render(
        <ThemeProvider>
          <ThemeProbe />
        </ThemeProvider>,
      );

      expect(screen.getByText(`${id}:${id}`)).toBeTruthy();
      await waitFor(() => {
        expect(document.documentElement).toHaveAttribute("data-theme", id);
        expect(setNativeAppearance).toHaveBeenLastCalledWith(appearance);
      });
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(id);
    },
  );
});
