// theme.ts — the single place that maps Tweak values onto <html>.
// Mirrors the prototype's app.jsx effect (lines 60-68) EXACTLY. Dark mode and
// layout/typography switches are pure attribute/CSS-var swaps; the small colour
// calculation here only keeps text readable on user-selected accent fills.

export type Tweaks = {
  dark: boolean;
  // Dark-mode palette variant: "black" (near-black + off-white, the default),
  // "warm" (the original gold-tinted dark), "terminal" (green doc text on black).
  // Only takes visual effect when dark is true.
  darkSkin: "black" | "warm" | "terminal";
  accent: string;
  sidebar: "full" | "icons" | "hidden";
  width: "narrow" | "comfortable" | "wide" | "full";
  density: "comfortable" | "compact";
  bodyfont: "sans" | "serif" | "mono";
  homeSurface: "doc" | "cockpit" | "chats" | "inbox";
};

export const TWEAK_DEFAULTS: Tweaks = {
  dark: true, // dark is the default app mode
  darkSkin: "black", // near-black + off-white is the default dark palette
  accent: "#C79400", // sukhi gold-deep
  sidebar: "full",
  width: "comfortable",
  density: "comfortable",
  bodyfont: "sans",
  homeSurface: "doc",
};

export const ACCENTS = ["#C79400", "#1B4F8A", "#A1202C", "#1F6B3A", "#5A3A8A"];

export const WIDTHS: Record<Tweaks["width"], string> = {
  comfortable: "740px",
  narrow: "640px",
  wide: "880px",
  full: "none",
};

function parseHexColor(hex: string): [number, number, number] | null {
  const raw = hex.trim().replace(/^#/, "");
  const value = /^[0-9a-f]{3}$/i.test(raw)
    ? raw
        .split("")
        .map((c) => c + c)
        .join("")
    : raw;
  if (!/^[0-9a-f]{6}$/i.test(value)) return null;
  const n = parseInt(value, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const l1 = relativeLuminance(a) + 0.05;
  const l2 = relativeLuminance(b) + 0.05;
  return Math.max(l1, l2) / Math.min(l1, l2);
}

function accentForeground(accent: string): string {
  const accentRgb = parseHexColor(accent);
  if (!accentRgb) return "#ffffff";
  const darkInk = "#1b1d21";
  const darkRgb = parseHexColor(darkInk);
  if (darkRgb && contrastRatio(darkRgb, accentRgb) >= 4.5) return darkInk;
  return "#ffffff";
}

function applyAccentVars(target: HTMLElement, accent: string): void {
  target.style.setProperty("--accent", accent);
  target.style.setProperty("--accent-on", accentForeground(accent));
}

// The SPS Agent design system is scoped to a `.sps-scope` container inside the
// Hermes renderer (so its --accent/fonts/global rules don't leak). Tweak attributes
// + inline vars are applied to that element, not <html>.
let scopeEl: HTMLElement | null = null;
export function setThemeScope(el: HTMLElement | null): void {
  scopeEl = el;
}

/** True while the SPS workspace is mounted and owns document-root theming.
 *  ThemeProvider yields to this so there is a single writer of <html>'s
 *  data-theme/--accent (no dual-writer race between the two systems). */
export function isScopeActive(): boolean {
  return scopeEl !== null;
}

/** The targets a theme change writes to: the SPS scope, plus the document root
 *  so the Hermes admin overlay (Settings/Providers/… rendered OUTSIDE
 *  .sps-scope) tracks the SPS workspace. When no scope is set yet we only have
 *  the root. */
function themeTargets(): HTMLElement[] {
  if (scopeEl && scopeEl !== document.documentElement) {
    return [scopeEl, document.documentElement];
  }
  return [scopeEl ?? document.documentElement];
}

// Active skin variables (idea A6). A skin layers ON TOP of tweaks — re-applied
// at the end of applyTweaks so a tweak change never clobbers the skin (e.g. the
// skin's accent wins over the tweaks accent picker when a skin sets one).
let skinVars: Record<string, string> = {};

/** Set (or clear) the active skin's CSS variables on the SPS scope AND the
 *  document root, so a skin picked in the SPS Tweaks panel themes the admin
 *  overlay too (root reads the skin's SPS-named vars through the main.css
 *  aliases, e.g. --bg-primary: var(--canvas)). */
export function setSkinVars(vars: Record<string, string>): void {
  const targets = themeTargets();
  for (const r of targets) {
    for (const k of Object.keys(skinVars)) {
      if (!(k in vars)) r.style.removeProperty(k);
      if (k === "--accent" && !("--accent" in vars)) {
        r.style.removeProperty("--accent-on");
      }
    }
  }
  skinVars = { ...vars };
  for (const r of targets) {
    for (const [k, v] of Object.entries(skinVars)) {
      if (k === "--accent") applyAccentVars(r, v);
      else r.style.setProperty(k, v);
    }
  }
}

export function applyTweaks(t: Tweaks): void {
  const r = scopeEl ?? document.documentElement;
  r.setAttribute("data-theme", t.dark ? "dark" : "light");
  r.setAttribute("data-skin", t.darkSkin);
  r.setAttribute(
    "data-density",
    t.density === "compact" ? "compact" : "comfortable",
  );
  r.setAttribute("data-bodyfont", t.bodyfont);
  r.setAttribute("data-width", t.width === "full" ? "full" : "fixed");
  applyAccentVars(r, t.accent);
  r.style.setProperty("--content-w", WIDTHS[t.width] || "740px");
  // Re-apply skin vars last so they layer over the tweak vars above.
  for (const [k, v] of Object.entries(skinVars)) {
    if (k === "--accent") applyAccentVars(r, v);
    else r.style.setProperty(k, v);
  }
  // Mirror ONLY theme + accent to the document root (density/width/bodyfont are
  // SPS-layout-specific). This is what keeps the admin overlay in lockstep with
  // the workspace; ThemeProvider yields while the scope is active.
  if (scopeEl && scopeEl !== document.documentElement) {
    const root = document.documentElement;
    root.setAttribute("data-theme", t.dark ? "dark" : "light");
    root.setAttribute("data-skin", t.darkSkin);
    applyAccentVars(root, t.accent);
  }
}
