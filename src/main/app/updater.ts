import { app, ipcMain, type BrowserWindow } from "electron";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import type { AppUpdater } from "electron-updater";
import { dirname, join } from "path";
import { updaterLogger } from "../updater-log";

interface UpdaterDeps {
  getMainWindow: () => BrowserWindow | null;
}

let autoUpdaterInstance: AppUpdater | null = null;

function updatePreferencesPath(): string {
  return join(app.getPath("userData"), "update-preferences.json");
}

function getAutoUpgradeEnabled(): boolean {
  const file = updatePreferencesPath();
  if (!existsSync(file)) {
    return true;
  }

  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as {
      autoUpgrade?: unknown;
    };
    return parsed.autoUpgrade !== false;
  } catch {
    return true;
  }
}

function setAutoUpgradeEnabled(enabled: boolean): void {
  const file = updatePreferencesPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ autoUpgrade: enabled }, null, 2)}\n`);
}

export function setupUpdater({ getMainWindow }: UpdaterDeps): void {
  ipcMain.handle("get-app-version", () => app.getVersion());
  ipcMain.handle("get-auto-upgrade-enabled", () => getAutoUpgradeEnabled());
  ipcMain.handle("set-auto-upgrade-enabled", (_event, enabled: boolean) => {
    setAutoUpgradeEnabled(enabled);
    if (autoUpdaterInstance) {
      autoUpdaterInstance.autoDownload = enabled;
    }
    return true;
  });

  const isPortableBuild = !!process.env.PORTABLE_EXECUTABLE_DIR;
  if (!app.isPackaged || isPortableBuild) {
    autoUpdaterInstance = null;
    ipcMain.handle("check-for-updates", async () => null);
    ipcMain.handle("download-update", () => true);
    ipcMain.handle("install-update", () => {});
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require("electron-updater") as {
    autoUpdater: AppUpdater;
  };

  autoUpdaterInstance = autoUpdater;
  autoUpdater.logger = updaterLogger;
  autoUpdater.autoDownload = getAutoUpgradeEnabled();
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    getMainWindow()?.webContents.send("update-available", {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });
  autoUpdater.on("download-progress", (progress) => {
    getMainWindow()?.webContents.send("update-download-progress", {
      percent: Math.round(progress.percent),
    });
  });
  autoUpdater.on("update-downloaded", () => {
    getMainWindow()?.webContents.send("update-downloaded");
  });
  autoUpdater.on("error", (err) => {
    getMainWindow()?.webContents.send("update-error", err.message);
  });

  ipcMain.handle("check-for-updates", async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return result?.updateInfo?.version || null;
    } catch {
      return null;
    }
  });
  ipcMain.handle("download-update", async () => {
    try {
      await autoUpdater.downloadUpdate();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      getMainWindow()?.webContents.send("update-error", message);
      return false;
    }
  });
  ipcMain.handle("install-update", () => {
    updaterLogger.info(
      "Restart requested by user — calling quitAndInstall(isSilent=false, isForceRunAfter=true)",
    );
    autoUpdater.quitAndInstall(false, true);
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);
}
