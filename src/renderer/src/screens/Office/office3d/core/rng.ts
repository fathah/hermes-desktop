/**
 * Deterministic hash-based RNG in [0, 1). The whole city (buildings, trees,
 * traffic, skyline) is generated from fixed seeds so every load produces the
 * exact same world — there is intentionally no Math.random() in world-gen.
 */
export function seededRandom(seed: number): number {
  const v = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
}
