// Dark-theme text legibility for SPS on-surface text.
//
// Bug (dogfood 2026-06-27): the Review Queue's enrich-contact preview — and 14
// sibling .inbox-*/.health-* page-text rules — used `var(--ink-1)` for text that
// sits on a dark surface. `--ink-1` (#14161A) is the "dark text for light chips"
// token: it has NO `[data-theme="dark"]` override, so on a dark surface it renders
// ~1.1:1 contrast (invisible). The theme-aware `--tx-1` is the correct token.
//
// These tests are deterministic (pure CSS-source reads) and run in the vitest lane.
import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";

const SPS = join(
  __dirname,
  "..",
  "src",
  "renderer",
  "src",
  "screens",
  "SpsAgent",
);
const screenCss = readFileSync(join(SPS, "screen.css"), "utf-8");
const tokensCss = readFileSync(join(SPS, "styles", "sps-tokens.css"), "utf-8");
const homeCss = readFileSync(join(SPS, "styles", "home.css"), "utf-8");
const equityCss = readFileSync(join(SPS, "styles", "equity.css"), "utf-8");

/** WCAG relative-luminance contrast ratio between two #rrggbb colors. */
function contrast(hexA: string, hexB: string): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lum = (hex: string): number => {
    const n = parseInt(hex.replace("#", ""), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const l1 = lum(hexA) + 0.05;
  const l2 = lum(hexB) + 0.05;
  return Math.max(l1, l2) / Math.min(l1, l2);
}

describe("SPS dark-theme text legibility", () => {
  it("documents why --ink-1 is unsafe for on-surface text (no dark override, ~1:1)", () => {
    // --ink-1 is defined once and never re-mapped for a dark theme/skin.
    expect(tokensCss).toMatch(/--ink-1:\s*#14161a/i);
    const darkOverridesInk1 =
      /\[data-theme="dark"\][^{]*\{[^}]*--ink-1\s*:/s.test(homeCss) ||
      /\[data-theme="dark"\][^{]*\{[^}]*--ink-1\s*:/s.test(tokensCss);
    expect(darkOverridesInk1).toBe(false);

    // The warm dark surface (#232118) and the black-skin surface (#161616) both
    // crush --ink-1 below the WCAG AA threshold for normal text (4.5:1).
    expect(contrast("#14161a", "#232118")).toBeLessThan(3);
    expect(contrast("#14161a", "#161616")).toBeLessThan(3);
  });

  it("uses the theme-aware --tx-1 (legible in dark mode) — and never --ink-1 — in screen.css", () => {
    // --tx-1 IS re-mapped per dark theme/skin, so it flips to a light value.
    expect(homeCss).toMatch(/\[data-theme="dark"\][\s\S]*?--tx-1:\s*#ece7d8/i);
    // Dark --tx-1 (#ece7d8) clears AA on both dark surfaces.
    expect(contrast("#ece7d8", "#232118")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ece7d8", "#161616")).toBeGreaterThanOrEqual(4.5);

    // Regression guard: no on-surface text in screen.css may use the
    // non-theme-aware --ink-1 token (it is invisible in dark mode).
    const inkUsages = screenCss.match(/var\(--ink-1/g) ?? [];
    expect(inkUsages.length).toBe(0);
  });

  it("uses theme-aware --tx-* (never the non-theme-aware --ink-N family) for text in equity.css", () => {
    // Same root cause as the screen.css bug, wider blast radius. The numbered
    // --ink-1..--ink-4 family is defined once in sps-tokens.css with NO
    // [data-theme="dark"] override, so any --ink-N used as a text colour is stuck
    // at its near-black light value on a dark surface. equity.css's basket / alert /
    // calibration sections used --ink-1 (×6), --ink-2 (×4) and --ink-3 (×7) for
    // on-surface text → invisible-to-poor contrast in the default dark theme. The
    // theme-aware twin is --tx-1..--tx-4 (same light values, dark overrides in
    // home.css), which the rest of equity.css already uses. (--ink-inverse and
    // --ink-primary are not text-on-surface and remain allowed.)
    const inkText = equityCss.match(/var\(--ink-[1-4]\)/g) ?? [];
    expect(inkText).toEqual([]);

    // Primary (--tx-1) and secondary (--tx-2) text clear WCAG AA (4.5:1) on both
    // dark surfaces after the swap; the --ink-1/-2 they replace were ~1.0–1.8:1.
    expect(contrast("#ece7d8", "#232118")).toBeGreaterThanOrEqual(4.5); // tx-1 warm
    expect(contrast("#e8e8e8", "#161616")).toBeGreaterThanOrEqual(4.5); // tx-1 black
    expect(contrast("#b6b1a2", "#232118")).toBeGreaterThanOrEqual(4.5); // tx-2 warm
    expect(contrast("#a6a6a6", "#161616")).toBeGreaterThanOrEqual(4.5); // tx-2 black

    // Tertiary/meta (--tx-3) is intentionally dimmer by design: it clears the 3:1
    // large/secondary bar and must strictly beat the broken --ink-3 it replaces.
    expect(contrast("#888373", "#232118")).toBeGreaterThanOrEqual(3); // tx-3 warm
    expect(contrast("#777777", "#161616")).toBeGreaterThanOrEqual(3); // tx-3 black
    expect(contrast("#888373", "#232118")).toBeGreaterThan(
      contrast("#6b7079", "#232118"),
    );
    expect(contrast("#777777", "#161616")).toBeGreaterThan(
      contrast("#6b7079", "#161616"),
    );
  });
});
