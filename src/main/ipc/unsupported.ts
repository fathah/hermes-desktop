export interface UnsupportedModeResult {
  success: false;
  unsupportedMode: true;
  error: string;
}

export function unsupportedInRemoteMode(feature: string): UnsupportedModeResult {
  return {
    success: false,
    unsupportedMode: true,
    error: `${feature} is unavailable in remote-only mode. Connect locally or use SSH tunnel mode.`,
  };
}
