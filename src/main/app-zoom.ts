import type { BrowserWindow, WebContents } from "electron";
import {
  APP_ZOOM_DEFAULT,
  APP_ZOOM_STEP,
  appZoomSettingsFor,
  type AppZoomSettings,
} from "../shared/app-zoom";
import { readDesktopConfig, writeDesktopConfig } from "./config";

const APP_ZOOM_CONFIG_KEY = "appZoomFactor";

export function getAppZoomSettings(): AppZoomSettings {
  return appZoomSettingsFor(readDesktopConfig()[APP_ZOOM_CONFIG_KEY]);
}

export function setAppZoomFactor(factor: number): AppZoomSettings {
  const data = readDesktopConfig();
  const settings = appZoomSettingsFor(factor);
  data[APP_ZOOM_CONFIG_KEY] = settings.factor;
  writeDesktopConfig(data);
  return settings;
}

export function resetAppZoomFactor(): AppZoomSettings {
  return setAppZoomFactor(APP_ZOOM_DEFAULT);
}

export function stepAppZoomFactor(deltaSteps: number): AppZoomSettings {
  const steps = Number.isFinite(deltaSteps) ? deltaSteps : 0;
  const current = getAppZoomSettings().factor;
  return setAppZoomFactor(current + steps * APP_ZOOM_STEP);
}

export function applyAppZoomToWebContents(
  webContents: WebContents | null | undefined,
  settings: AppZoomSettings = getAppZoomSettings(),
): AppZoomSettings {
  if (webContents && !webContents.isDestroyed()) {
    webContents.setZoomFactor(settings.factor);
  }
  return settings;
}

export function applyAppZoomToWindow(
  window: BrowserWindow | null | undefined,
  settings: AppZoomSettings = getAppZoomSettings(),
): AppZoomSettings {
  if (window && !window.isDestroyed()) {
    applyAppZoomToWebContents(window.webContents, settings);
  }
  return settings;
}
