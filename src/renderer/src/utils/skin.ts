/**
 * Renderer-side skin application (idea A6). Sets a skin's CSS custom properties
 * on the document root and remembers the active skin per profile in
 * localStorage. The skin definitions + validation come from the main process
 * (`list-skins`); this module only applies them.
 */

import type { LoadedSkin } from "../../../shared/skins";

let appliedVars: string[] = [];

/** Apply a CSS-var map at the app root, clearing any previously applied skin. */
export function applySkinVars(cssVars: Record<string, string>): void {
  const root = document.documentElement;
  for (const v of appliedVars) root.style.removeProperty(v);
  appliedVars = Object.keys(cssVars);
  for (const [k, value] of Object.entries(cssVars)) {
    root.style.setProperty(k, value);
  }
}

function storageKey(profile?: string): string {
  return `hermes.skin.${profile || "default"}`;
}

export function getActiveSkinId(profile?: string): string | null {
  try {
    return localStorage.getItem(storageKey(profile));
  } catch {
    return null;
  }
}

export function setActiveSkinId(
  profile: string | undefined,
  id: string | null,
): void {
  try {
    if (id) localStorage.setItem(storageKey(profile), id);
    else localStorage.removeItem(storageKey(profile));
  } catch {
    /* ignore */
  }
}

/**
 * Load the profile's skins, apply the persisted active one (or clear if none),
 * and return the full list for a picker.
 */
export async function loadAndApplyActiveSkin(
  profile?: string,
): Promise<LoadedSkin[]> {
  let skins: LoadedSkin[] = [];
  try {
    skins = await window.hermesAPI.listSkins(profile);
  } catch {
    skins = [];
  }
  const activeId = getActiveSkinId(profile);
  const active = skins.find((s) => s.id === activeId);
  applySkinVars(active ? active.cssVars : {});
  return skins;
}
