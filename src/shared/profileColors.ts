// Shared between main and renderer so the default-colour mapping is identical
// on both sides (main resolves it for stored profiles; the renderer falls back
// to it for SSH/remote profiles and for sessions whose profile meta isn't to
// hand). Flat / clean palette — saturated but readable with white text.
// 22 colours = two full rows of 11 in the picker grid.
export const PROFILE_COLORS = [
  "#3498DB", // blue
  "#1ABC9C", // teal
  "#2ECC71", // green
  "#9B59B6", // purple
  "#E67E22", // orange
  "#E74C3C", // red
  "#16A085", // dark teal
  "#2980B9", // dark blue
  "#8E44AD", // dark purple
  "#27AE60", // dark green
  "#D35400", // pumpkin
  "#C0392B", // dark red
  "#F39C12", // amber
  "#34495E", // slate
  "#E84393", // pink
  "#00B894", // mint
  "#0984E3", // bright blue
  "#6C5CE7", // indigo
  "#FD79A8", // light pink
  "#00CEC9", // cyan
  "#FDCB6E", // light amber
  "#636E72", // gray
] as const;

/**
 * Deterministic default colour for a profile that hasn't picked one. Hashing
 * the name keeps the colour stable across reloads while spreading profiles
 * across the palette.
 */
export function defaultColorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return PROFILE_COLORS[Math.abs(hash) % PROFILE_COLORS.length];
}
