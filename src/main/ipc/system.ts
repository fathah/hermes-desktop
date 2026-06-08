import { app, ipcMain, BrowserWindow } from "electron";
import {
  checkInstallStatus,
  verifyInstall,
  runInstall,
  inspectInstallTarget,
  validateHermesHome,
  setHermesHomeOverride,
  getComputerUseStatus,
  installComputerUseDriver,
  getHermesVersion,
  clearVersionCache,
  runHermesDoctor,
  runHermesUpdate,
  checkHermesUpdate,
  getChangelog,
  listMcpServers,
  discoverMemoryProviders,
  readLogs,
  runHermesDump,
  runHermesBackup,
  runHermesImport,
  type InstallProgress,
} from "../installer";
import {
  getConnectionConfig,
  type SshConnectionConfig,
} from "../config";
import {
  sshGetHermesVersion,
  sshRunDoctor,
  sshRunUpdate,
  sshStartGateway,
  sshReadRemoteApiKey,
  sshRunDump,
  sshDiscoverMemoryProviders,
  sshReadLogs,
} from "../ssh-remote";
import {
  isGatewayRunning,
  restartGateway,
  isRemoteMode,
  setSshRemoteApiKey,
} from "../hermes";
import {
  startSshTunnel,
} from "../ssh-tunnel";
import { getAppLocale, setAppLocale } from "../locale";
import type { AppLocale } from "../../shared/i18n/types";

// Dynamic import or check for updates depending on packaging
let autoUpdater: any = null;
try {
  if (app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    autoUpdater = require("electron-updater").autoUpdater;
  }
} catch (err) {
  console.error("[updater] Failed to load autoUpdater:", err);
}

function registerDualHandler<Args extends unknown[], RetLocal, RetSsh>(
  channel: string,
  localFn: (...args: Args) => Promise<RetLocal> | RetLocal,
  sshFn: (
    ssh: SshConnectionConfig,
    ...args: Args
  ) => Promise<RetSsh> | RetSsh,
): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) {
      return sshFn(conn.ssh, ...(args as Args));
    }
    return localFn(...(args as Args));
  });
}

export function registerSystemIpc(mainWindowGetter: () => BrowserWindow | null): void {
  // Installation
  ipcMain.handle("check-install", () => {
    return checkInstallStatus();
  });

  ipcMain.handle("verify-install", () => verifyInstall());

  ipcMain.handle("start-install", async (event) => {
    try {
      await runInstall((progress: InstallProgress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send("install-progress", progress);
        }
      }, mainWindowGetter());
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Pre-install inspection + "use an existing installation" (issue #272).
  ipcMain.handle("inspect-install-target", () => inspectInstallTarget());
  ipcMain.handle("validate-hermes-home", (_event, dir: string) =>
    validateHermesHome(dir),
  );
  ipcMain.handle("adopt-hermes-home", (_event, dir: string) => {
    if (!validateHermesHome(dir)) return false;
    setHermesHomeOverride(dir);
    return true;
  });
  ipcMain.handle("quit-app", () => app.quit());

  // Hermes engine info
  registerDualHandler(
    "get-hermes-version",
    getHermesVersion,
    sshGetHermesVersion,
  );
  registerDualHandler(
    "refresh-hermes-version",
    () => {
      clearVersionCache();
      return getHermesVersion();
    },
    sshGetHermesVersion,
  );
  registerDualHandler("run-hermes-doctor", runHermesDoctor, sshRunDoctor);

  ipcMain.handle("run-hermes-update", async (event) => {
    try {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        if (!event.sender.isDestroyed()) {
          event.sender.send("install-progress", {
            step: 1,
            totalSteps: 1,
            title: "Updating remote Hermes Agent",
            detail: "Running hermes update over SSH...",
            log: "Running hermes update over SSH...\n",
          });
        }
        await sshRunUpdate(conn.ssh);
        await sshStartGateway(conn.ssh);
        await startSshTunnel(conn.ssh);
        const key = await sshReadRemoteApiKey(conn.ssh);
        setSshRemoteApiKey(key);
        return { success: true };
      }
      await runHermesUpdate((progress: InstallProgress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send("install-progress", progress);
        }
      });
      if (isGatewayRunning()) {
        restartGateway();
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle("check-hermes-update", async () => {
    if (isRemoteMode()) return { available: false, reason: "remote-mode" };
    try {
      return await checkHermesUpdate();
    } catch (err) {
      return { available: false, reason: (err as Error).message };
    }
  });

  // Computer Use
  ipcMain.handle("get-computer-use-status", (_event, profile?: string) =>
    getComputerUseStatus(profile),
  );
  ipcMain.handle(
    "install-computer-use-driver",
    async (event, profile?: string) => {
      return installComputerUseDriver((progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send("install-progress", progress);
        }
      }, profile);
    },
  );

  // App version
  ipcMain.handle("get-app-version", () => app.getVersion());

  // Locale
  ipcMain.handle("get-locale", () => getAppLocale());
  ipcMain.handle("set-locale", (_event, locale: AppLocale) =>
    setAppLocale(locale),
  );

  // Git Changelog
  ipcMain.handle("get-git-changelog", (_event) => getChangelog());

  // Backup / Import
  ipcMain.handle("run-hermes-backup", (_event, profile?: string) =>
    runHermesBackup(profile),
  );
  ipcMain.handle(
    "run-hermes-import",
    (_event, archivePath: string, profile?: string) =>
      runHermesImport(archivePath, profile),
  );

  // Debug dump
  ipcMain.handle("run-hermes-dump", () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshRunDump(conn.ssh);
    return runHermesDump();
  });

  // MCP servers
  ipcMain.handle("list-mcp-servers", (_event, profile?: string) =>
    listMcpServers(profile),
  );

  // Memory providers
  ipcMain.handle("discover-memory-providers", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshDiscoverMemoryProviders(conn.ssh, profile);
    return discoverMemoryProviders(profile);
  });

  // Log viewer
  ipcMain.handle("read-logs", (_event, logFile?: string, lines?: number) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshReadLogs(conn.ssh, logFile, lines);
    return readLogs(logFile, lines);
  });

  // Auto-updater handlers
  const isPortableBuild = !!process.env.PORTABLE_EXECUTABLE_DIR;
  if (!app.isPackaged || isPortableBuild || !autoUpdater) {
    ipcMain.handle("check-for-updates", async () => null);
    ipcMain.handle("download-update", () => true);
    ipcMain.handle("install-update", () => {});
    return;
  }

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
      mainWindowGetter()?.webContents.send("update-error", message);
      return false;
    }
  });

  ipcMain.handle("install-update", () => {
    autoUpdater.logger?.info(
      "Restart requested by user — calling quitAndInstall(isSilent=false, isForceRunAfter=true)",
    );
    autoUpdater.quitAndInstall(false, true);
  });
}
