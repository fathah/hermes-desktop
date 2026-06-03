// tweaks.ts — appearance/layout/typography settings (the real Tweaks panel writes
// here). Replaces the prototype's host-protocol useTweaks. Persisted separately
// from the workspace document.
import type { StateCreator } from "zustand";
import { TWEAK_DEFAULTS, type Tweaks } from "../../lib/theme";
import type { Store, TweaksSlice } from "../storeTypes";

const TWEAKS_KEY = "sps-agent-tweaks-v1";

export function loadTweaks(): Tweaks {
  try {
    const r = localStorage.getItem(TWEAKS_KEY);
    if (r) return { ...TWEAK_DEFAULTS, ...JSON.parse(r) };
  } catch {
    /* ignore */
  }
  return TWEAK_DEFAULTS;
}

export function saveTweaks(t: Tweaks): void {
  try {
    localStorage.setItem(TWEAKS_KEY, JSON.stringify(t));
  } catch {
    /* ignore */
  }
}

export const createTweaksSlice: StateCreator<Store, [], [], TweaksSlice> = (
  set,
) => ({
  t: loadTweaks(),
  setTweak: (k, v) => set((s) => ({ t: { ...s.t, [k]: v } })),
});
