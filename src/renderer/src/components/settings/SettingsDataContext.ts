import { createContext, useContext } from "react";
import type { SettingsData } from "./useSettingsData";

/**
 * Carries the shared settings state/handlers (from `useSettingsData`) down to
 * each pane so they don't have to prop-drill ~50 values. Provided once by
 * `SettingsModal`.
 */
export const SettingsDataContext = createContext<SettingsData | null>(null);

/** Read the shared settings state from inside a pane. */
export function useSettings(): SettingsData {
  const ctx = useContext(SettingsDataContext);
  if (!ctx) {
    throw new Error("useSettings must be used within the settings modal");
  }
  return ctx;
}
