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
}
