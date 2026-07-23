import { ThinkingOrb, type ThinkingOrbProps, type OrbSize } from "thinking-orbs";
import type { CSSProperties } from "react";
import { THEMES } from "../constants";
import { useTheme } from "./ThemeProvider";

const THEME_APPEARANCE = new Map(THEMES.map((t) => [t.id, t.appearance]));

/** Boundary between the two shipped design presets (20 inline, 64 avatar). */
const PRESET_MIDPOINT = 42;

type OrbLoaderProps = Omit<ThinkingOrbProps, "theme" | "size"> & {
  /**
   * Visual size in CSS px. Any number is accepted — the *design* (dot count /
   * tuning) snaps to the nearest shipped preset (20 or 64), while this exact
   * number drives the rendered footprint. Defaults to 64.
   */
  size?: number;
  /**
   * Flip the ink relative to the app theme: light-theme ink (dark dots) while
   * the app is dark, dark-theme ink (light dots) while the app is light. Use
   * when the orb sits on an *inverted* surface (e.g. a white circle on a dark
   * page) so the ink contrasts the circle, not the page. Defaults to false.
   */
  invert?: boolean;
};

/**
 * Theme-aware wrapper around `thinking-orbs`' ThinkingOrb.
 *
 * Two jobs the raw component can't do for us:
 * 1. **Theme.** Hermes theme ids ("dracula", "nord", …) don't match the
 *    library's auto-detection (it only recognises `data-theme="dark|light"`),
 *    so the orb theme is pinned from the active theme's declared appearance.
 * 2. **Off-preset sizes.** ThinkingOrb ships exactly two designs (20, 64) and
 *    `resolvePreset` throws on any other size. Callers still want arbitrary
 *    pixel footprints (e.g. a 30px chat avatar), so we snap the *design* to the
 *    nearest preset and set the *visual* size from the requested number — any
 *    number is safe, never a runtime throw. An explicit `style` still wins.
 */
export function OrbLoader({
  size,
  style,
  invert,
  ...rest
}: OrbLoaderProps): React.JSX.Element {
  const { resolved } = useTheme();
  const appearance = THEME_APPEARANCE.get(resolved) ?? "dark";
  const orbTheme = invert
    ? appearance === "dark"
      ? "light"
      : "dark"
    : appearance;
  const designSize: OrbSize = size != null && size < PRESET_MIDPOINT ? 20 : 64;
  const sizedStyle: CSSProperties | undefined =
    size != null ? { width: size, height: size, ...style } : style;
  return (
    <ThinkingOrb
      theme={orbTheme}
      size={designSize}
      style={sizedStyle}
      {...rest}
    />
  );
}
