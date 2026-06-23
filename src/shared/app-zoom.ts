export const APP_ZOOM_DEFAULT = 1;
export const APP_ZOOM_MIN = 0.8;
export const APP_ZOOM_MAX = 1.6;
export const APP_ZOOM_STEP = 0.1;

export interface AppZoomSettings {
  factor: number;
  percent: number;
  min: number;
  max: number;
  step: number;
}

export function normalizeAppZoomFactor(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return APP_ZOOM_DEFAULT;
  }

  const stepped = Math.round(value / APP_ZOOM_STEP) * APP_ZOOM_STEP;
  const clamped = Math.min(APP_ZOOM_MAX, Math.max(APP_ZOOM_MIN, stepped));
  return Number(clamped.toFixed(2));
}

export function appZoomSettingsFor(value: unknown): AppZoomSettings {
  const factor = normalizeAppZoomFactor(value);
  return {
    factor,
    percent: Math.round(factor * 100),
    min: APP_ZOOM_MIN,
    max: APP_ZOOM_MAX,
    step: APP_ZOOM_STEP,
  };
}
