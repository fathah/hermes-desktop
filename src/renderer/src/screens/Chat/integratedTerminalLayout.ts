export const MIN_TERMINAL_HEIGHT = 240;
export const DEFAULT_TERMINAL_HEIGHT = 240;
const CHAT_MIN_HEIGHT = 280;

export function clampIntegratedTerminalHeight(
  height: number,
  viewportHeight: number,
): number {
  const maximum = Math.max(
    MIN_TERMINAL_HEIGHT,
    viewportHeight - CHAT_MIN_HEIGHT,
  );
  return Math.min(maximum, Math.max(MIN_TERMINAL_HEIGHT, height));
}
