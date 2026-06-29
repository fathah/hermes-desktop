import { afterEach, describe, expect, it } from "vitest";
import { ACCENTS, TWEAK_DEFAULTS, applyTweaks, setThemeScope } from "./theme";

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

describe("SPS theme accent foreground", () => {
  afterEach(() => {
    setThemeScope(null);
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-skin");
    document.documentElement.removeAttribute("data-density");
    document.documentElement.removeAttribute("data-bodyfont");
    document.documentElement.removeAttribute("data-width");
    document.documentElement.removeAttribute("style");
    document.body.innerHTML = "";
  });

  it("sets a readable --accent-on foreground for every built-in accent", () => {
    for (const accent of ACCENTS) {
      applyTweaks({ ...TWEAK_DEFAULTS, accent });

      const foreground = document.documentElement.style
        .getPropertyValue("--accent-on")
        .trim();
      expect(foreground, accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrast(foreground, accent), accent).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("mirrors --accent-on to both SPS scope and document root", () => {
    const scope = document.createElement("div");
    document.body.append(scope);
    setThemeScope(scope);

    applyTweaks({ ...TWEAK_DEFAULTS, accent: "#C79400" });

    expect(scope.style.getPropertyValue("--accent-on").trim()).toBe("#1b1d21");
    expect(
      document.documentElement.style.getPropertyValue("--accent-on").trim(),
    ).toBe("#1b1d21");
  });
});
