// skin.ts — bridges the desktop-wide skin engine (shared/skins) into SPS's own
// CSS-variable theme. A skin's semantic color tokens are mapped onto SPS's
// variable names so a selected skin themes the .sps-scope alongside the tweaks
// system. Fixes the earlier regression where skins applied to document root
// (Hermes var names) and never reached SPS.

import type { Skin } from "../../../../../shared/skins";

// Semantic skin token -> SPS CSS variable(s) it should drive.
const SPS_COLOR_VARS: Record<string, string[]> = {
  accent: ["--accent"],
  background: ["--app-bg", "--canvas"],
  surface: ["--surface"],
  text: ["--tx-1"],
  textSecondary: ["--tx-2"],
  textMuted: ["--tx-3"],
  border: ["--hairline", "--hair", "--hair-soft", "--hair-strong"],
};

/** Map a skin's semantic tokens to the SPS CSS variables they should set. */
export function skinToSpsVars(
  skin: Skin | null | undefined,
): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!skin) return vars;
  if (skin.colors) {
    for (const [token, value] of Object.entries(skin.colors)) {
      const targets = SPS_COLOR_VARS[token];
      if (targets) for (const v of targets) vars[v] = value;
    }
  }
  if (skin.fonts?.body) vars["--font-sans"] = skin.fonts.body;
  if (skin.fonts?.mono) vars["--font-mono"] = skin.fonts.mono;
  return vars;
}
