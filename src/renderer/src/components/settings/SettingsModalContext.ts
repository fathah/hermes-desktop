import { createContext, useContext } from "react";

/** Optional arguments supplied when opening the settings modal. */
export interface OpenSettingsOptions {
  /** Active profile whose config the modal reads/writes. Defaults to "default". */
  profile?: string;
}

export interface SettingsModalContextValue {
  /**
   * Open the global settings modal. `section` jumps to a nav item
   * (e.g. `appearance`, `privacy`, `connection`); an unknown/omitted name
   * lands on the first item.
   */
  openSettings: (section?: string, opts?: OpenSettingsOptions) => void;
  /** Close the modal if open. */
  closeSettings: () => void;
}

export const SettingsModalContext =
  createContext<SettingsModalContextValue | null>(null);

/**
 * Access the global settings modal. Call `openSettings()` from anywhere under
 * the SettingsModalProvider (the sidebar gear, the `/settings` command, the
 * Cmd/Ctrl+, shortcut).
 */
export function useSettingsModal(): SettingsModalContextValue {
  const ctx = useContext(SettingsModalContext);
  if (!ctx) {
    throw new Error(
      "useSettingsModal must be used within a SettingsModalProvider",
    );
  }
  return ctx;
}
