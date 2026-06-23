import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadDesktopConfig = vi.fn((): Record<string, unknown> => ({}));
const mockWriteDesktopConfig = vi.fn(
  (_config: Record<string, unknown>): void => {},
);

vi.mock("../src/main/config", () => ({
  readDesktopConfig: () => mockReadDesktopConfig(),
  writeDesktopConfig: (config: Record<string, unknown>) =>
    mockWriteDesktopConfig(config),
}));

import {
  APP_ZOOM_DEFAULT,
  APP_ZOOM_MAX,
  APP_ZOOM_MIN,
  APP_ZOOM_STEP,
  appZoomSettingsFor,
  normalizeAppZoomFactor,
} from "../src/shared/app-zoom";
import {
  getAppZoomSettings,
  resetAppZoomFactor,
  setAppZoomFactor,
  stepAppZoomFactor,
} from "../src/main/app-zoom";

describe("app zoom", () => {
  beforeEach(() => {
    mockReadDesktopConfig.mockReturnValue({});
    mockWriteDesktopConfig.mockClear();
  });

  it("defaults to 100% when desktop.json has no zoom setting", () => {
    expect(getAppZoomSettings()).toEqual({
      factor: APP_ZOOM_DEFAULT,
      percent: 100,
      min: APP_ZOOM_MIN,
      max: APP_ZOOM_MAX,
      step: APP_ZOOM_STEP,
    });
  });

  it.each([undefined, null, "1.2", Number.NaN, Infinity, -Infinity])(
    "normalizes invalid value %s to the default",
    (value) => {
      expect(normalizeAppZoomFactor(value)).toBe(APP_ZOOM_DEFAULT);
    },
  );

  it("clamps low and high values to the supported zoom range", () => {
    expect(normalizeAppZoomFactor(0.4)).toBe(APP_ZOOM_MIN);
    expect(normalizeAppZoomFactor(2.1)).toBe(APP_ZOOM_MAX);
  });

  it("rounds zoom factors to the supported step", () => {
    expect(normalizeAppZoomFactor(1.24)).toBe(1.2);
    expect(normalizeAppZoomFactor(1.26)).toBe(1.3);
    expect(appZoomSettingsFor(1.24)).toEqual({
      factor: 1.2,
      percent: 120,
      min: APP_ZOOM_MIN,
      max: APP_ZOOM_MAX,
      step: APP_ZOOM_STEP,
    });
  });

  it("writes only the normalized app zoom factor to desktop config", () => {
    mockReadDesktopConfig.mockReturnValue({
      onboardingCompleted: true,
      appZoomFactor: 1.6,
    });

    expect(setAppZoomFactor(1.24)).toEqual({
      factor: 1.2,
      percent: 120,
      min: APP_ZOOM_MIN,
      max: APP_ZOOM_MAX,
      step: APP_ZOOM_STEP,
    });
    expect(mockWriteDesktopConfig).toHaveBeenCalledWith({
      onboardingCompleted: true,
      appZoomFactor: 1.2,
    });
  });

  it("steps and resets zoom while clamping to the supported range", () => {
    mockReadDesktopConfig.mockReturnValue({ appZoomFactor: 1.5 });
    expect(stepAppZoomFactor(1).factor).toBe(APP_ZOOM_MAX);
    expect(mockWriteDesktopConfig).toHaveBeenLastCalledWith({
      appZoomFactor: APP_ZOOM_MAX,
    });

    mockReadDesktopConfig.mockReturnValue({ appZoomFactor: 0.8 });
    expect(stepAppZoomFactor(-1).factor).toBe(APP_ZOOM_MIN);
    expect(mockWriteDesktopConfig).toHaveBeenLastCalledWith({
      appZoomFactor: APP_ZOOM_MIN,
    });

    mockReadDesktopConfig.mockReturnValue({ appZoomFactor: 1.4 });
    expect(resetAppZoomFactor().factor).toBe(APP_ZOOM_DEFAULT);
    expect(mockWriteDesktopConfig).toHaveBeenLastCalledWith({
      appZoomFactor: APP_ZOOM_DEFAULT,
    });
  });
});
