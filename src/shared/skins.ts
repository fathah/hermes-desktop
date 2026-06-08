/**
 * Desktop-wide skin engine (idea A6) — pure core.
 *
 * A skin is a small data file (JSON or YAML) under ~/.hermes/skins/ that maps
 * semantic tokens to values; the renderer applies them as CSS variables at the
 * app root. Generalizes the SPS "tweaks" idea (accent/fonts/density) to the
 * whole desktop. This module holds validation + CSS-var mapping (pure +
 * testable); file IO lives in `src/main/skins.ts`.
 */

export interface CorkboardSkin {
  bgColor?: string;
  gridColor?: string;
  scanlineColor?: string;
  phosphorGlow?: string;
  phosphorDim?: string;
  phosphorText?: string;
  phosphorBorder?: string;
  cableStyle?: "straight" | "curved" | "diagonal";
}

export interface Skin {
  name: string;
  /** Semantic color tokens (CSS color strings). */
  colors?: Record<string, string>;
  fonts?: { body?: string; mono?: string };
  /** UI density preset. */
  density?: "compact" | "comfortable" | "spacious";
  /** Corkboard/BBS customization tokens */
  corkboard?: CorkboardSkin;
}

export interface SkinValidation {
  valid: boolean;
  skin?: Skin;
  errors: string[];
}

/** A loaded skin with its CSS-variable map (returned over IPC). */
export interface LoadedSkin {
  /** File stem (used as the activation key). */
  id: string;
  skin: Skin;
  cssVars: Record<string, string>;
}

/** Semantic color token → CSS custom property. Unknown keys are ignored. */
const COLOR_VAR_MAP: Record<string, string> = {
  accent: "--accent",
  background: "--app-bg",
  surface: "--surface",
  text: "--text-primary",
  textSecondary: "--text-secondary",
  textMuted: "--text-muted",
  border: "--border",
};

const DENSITIES = new Set(["compact", "comfortable", "spacious"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate a parsed skin object. Lenient: unknown keys are dropped, wrong-typed
 * values are reported as errors and skipped, but a usable skin with a valid
 * name still returns valid=true with whatever well-formed tokens it had.
 */
export function validateSkin(input: unknown): SkinValidation {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { valid: false, errors: ["Skin must be an object"] };
  }

  const name = input.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    return { valid: false, errors: ['Skin "name" is required'] };
  }

  const skin: Skin = { name: name.trim() };

  if (input.colors !== undefined) {
    if (!isPlainObject(input.colors)) {
      errors.push('"colors" must be an object');
    } else {
      const colors: Record<string, string> = {};
      for (const [key, value] of Object.entries(input.colors)) {
        if (typeof value === "string") colors[key] = value;
        else errors.push(`color "${key}" must be a string`);
      }
      if (Object.keys(colors).length > 0) skin.colors = colors;
    }
  }

  if (input.fonts !== undefined) {
    if (!isPlainObject(input.fonts)) {
      errors.push('"fonts" must be an object');
    } else {
      const fonts: { body?: string; mono?: string } = {};
      if (typeof input.fonts.body === "string") fonts.body = input.fonts.body;
      if (typeof input.fonts.mono === "string") fonts.mono = input.fonts.mono;
      if (fonts.body || fonts.mono) skin.fonts = fonts;
    }
  }

  if (input.density !== undefined) {
    if (typeof input.density === "string" && DENSITIES.has(input.density)) {
      skin.density = input.density as Skin["density"];
    } else {
      errors.push('"density" must be compact | comfortable | spacious');
    }
  }

  if (input.corkboard !== undefined) {
    if (!isPlainObject(input.corkboard)) {
      errors.push('"corkboard" must be an object');
    } else {
      const cb: CorkboardSkin = {};
      const cbKeys: Exclude<keyof CorkboardSkin, "cableStyle">[] = [
        "bgColor",
        "gridColor",
        "scanlineColor",
        "phosphorGlow",
        "phosphorDim",
        "phosphorText",
        "phosphorBorder",
      ];
      for (const k of cbKeys) {
        if (input.corkboard[k] !== undefined) {
          if (typeof input.corkboard[k] === "string") {
            cb[k] = input.corkboard[k] as string;
          } else {
            errors.push(`corkboard "${k}" must be a string`);
          }
        }
      }
      if (input.corkboard.cableStyle !== undefined) {
        const style = input.corkboard.cableStyle;
        if (
          style === "straight" ||
          style === "curved" ||
          style === "diagonal"
        ) {
          cb.cableStyle = style;
        } else {
          errors.push('"cableStyle" must be straight | curved | diagonal');
        }
      }
      if (Object.keys(cb).length > 0) {
        skin.corkboard = cb;
      }
    }
  }

  return { valid: true, skin, errors };
}

/**
 * Map a skin to the CSS custom properties to set on the app root. Only known
 * color tokens map to variables; fonts map to --font-body / --font-mono.
 */
export function skinToCssVars(skin: Skin): Record<string, string> {
  const vars: Record<string, string> = {};
  if (skin.colors) {
    for (const [key, value] of Object.entries(skin.colors)) {
      const cssVar = COLOR_VAR_MAP[key];
      if (cssVar) vars[cssVar] = value;
    }
  }
  if (skin.fonts?.body) vars["--font-body"] = skin.fonts.body;
  if (skin.fonts?.mono) vars["--font-mono"] = skin.fonts.mono;
  if (skin.corkboard) {
    if (skin.corkboard.bgColor)
      vars["--skin-phosphor-bg"] = skin.corkboard.bgColor;
    if (skin.corkboard.phosphorGlow)
      vars["--skin-phosphor-glow"] = skin.corkboard.phosphorGlow;
    if (skin.corkboard.phosphorBorder)
      vars["--skin-phosphor-border"] = skin.corkboard.phosphorBorder;
    if (skin.corkboard.phosphorDim)
      vars["--skin-phosphor-dim"] = skin.corkboard.phosphorDim;
    if (skin.corkboard.phosphorText)
      vars["--skin-phosphor-text"] = skin.corkboard.phosphorText;
  }
  return vars;
}
