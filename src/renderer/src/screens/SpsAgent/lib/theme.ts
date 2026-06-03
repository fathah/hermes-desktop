// theme.ts — the single place that maps Tweak values onto <html>.
// Mirrors the prototype's app.jsx effect (lines 60-68) EXACTLY. Dark mode and
// every layout/typography switch is a pure attribute/CSS-var swap — no JS color math.

export type Tweaks = {
  dark: boolean;
  accent: string;
  sidebar: "full" | "icons" | "hidden";
  width: "narrow" | "comfortable" | "wide" | "full";
  density: "comfortable" | "compact";
  bodyfont: "sans" | "serif" | "mono";
};

export const TWEAK_DEFAULTS: Tweaks = {
  dark: false,
  accent: "#C79400", // sukhi gold-deep
  sidebar: "full",
  width: "comfortable",
  density: "comfortable",
  bodyfont: "sans",
};

export const ACCENTS = ["#C79400", "#1B4F8A", "#A1202C", "#1F6B3A", "#5A3A8A"];

export const WIDTHS: Record<Tweaks["width"], string> = {
  comfortable: "740px",
  narrow: "640px",
  wide: "880px",
  full: "none",
};

// The SPS Agent design system is scoped to a `.sps-scope` container inside the
// Hermes renderer (so its --accent/fonts/global rules don't leak). Tweak attributes
// + inline vars are applied to that element, not <html>.
let scopeEl: HTMLElement | null = null;
export function setThemeScope(el: HTMLElement | null): void {
  scopeEl = el;
}

// Active skin variables (idea A6). A skin layers ON TOP of tweaks — re-applied
// at the end of applyTweaks so a tweak change never clobbers the skin (e.g. the
// skin's accent wins over the tweaks accent picker when a skin sets one).
let skinVars: Record<string, string> = {};

/** Set (or clear) the active skin's CSS variables on the SPS scope. */
export function setSkinVars(vars: Record<string, string>): void {
  const r = scopeEl ?? document.documentElement;
  for (const k of Object.keys(skinVars)) {
    if (!(k in vars)) r.style.removeProperty(k);
  }
  skinVars = { ...vars };
  for (const [k, v] of Object.entries(skinVars)) r.style.setProperty(k, v);
}

export function applyTweaks(t: Tweaks): void {
  const r = scopeEl ?? document.documentElement;
  r.setAttribute("data-theme", t.dark ? "dark" : "light");
  r.setAttribute(
    "data-density",
    t.density === "compact" ? "compact" : "comfortable",
  );
  r.setAttribute("data-bodyfont", t.bodyfont);
  r.setAttribute("data-width", t.width === "full" ? "full" : "fixed");
  r.style.setProperty("--accent", t.accent);
  r.style.setProperty("--content-w", WIDTHS[t.width] || "740px");
  // Re-apply skin vars last so they layer over the tweak vars above.
  for (const [k, v] of Object.entries(skinVars)) r.style.setProperty(k, v);
}
