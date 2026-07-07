import { app, BrowserWindow, shell } from "electron";
import { safeHandle } from "./safe-handle";
import {
  checkInstallStatus,
  verifyInstall,
  runInstall,
  inspectInstallTarget,
  validateHermesHome,
  setHermesHomeOverride,
  getHermesVersion,
  clearVersionCache,
  runHermesDoctor,
  runHermesUpdate,
  rollbackEngineTo,
  checkHermesUpdate,
  getChangelog,
  discoverMemoryProviders,
  readLogs,
  runHermesDump,
  runHermesBackup,
  runHermesImport,
  type InstallProgress,
} from "../installer";
import {
  getConnectionConfig,
  getDesktopUpdateRoutine,
  setDesktopUpdateRoutine,
} from "../config";
import {
  acknowledgeHermesAgentUpdateContractBreak,
  getEngineCapabilityState,
  getHermesAgentUpdateRoutine,
  setHermesAgentUpdateRoutine,
} from "../engine-update-state";
import {
  clearErrorLog,
  formatLogError,
  hermesLogDir,
  log,
  readErrorLogTail,
} from "../log";
import { runHermesAgentUpdateCheck } from "../hermes-agent-updates";
import { runDesktopUpdateCheck } from "../desktop-update-routine";
import {
  getHermesUpstreamWatchState,
  runHermesUpstreamWatch,
} from "../hermes-upstream-watch";
import {
  getEngineCapabilities,
  refreshEngineCapabilities,
} from "../engine-capabilities";
import { verifyAndRecordEngineContract } from "../engine-contract-verify";
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
import { startSshTunnel } from "../ssh-tunnel";
import { getAppLocale, setAppLocale } from "../locale";
import type { AppLocale } from "../../shared/i18n/types";
import type { AppUpdater } from "electron-updater";
import { registerCapabilityRiskIpc } from "./capability-risk";
import { registerResearchReachIpc } from "./research-reach";
import {
  addMcpServer,
  installMcpCatalogEntry,
  listMcpCatalog,
  listMcpServers,
  removeMcpServer,
  setMcpServerEnabled,
  testMcpServer,
  type McpServerInput,
} from "../mcp-servers";

// Dynamic import or check for updates depending on packaging
import { registerDualHandler } from "./utility";

let autoUpdater: AppUpdater | null = null;
try {
  if (app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    autoUpdater = require("electron-updater").autoUpdater;
  }
} catch (err) {
  log.error("updater", {
    msg: "failed to load autoUpdater",
    error: formatLogError(err),
  });
}

function isWindowsUnsignedAutoUpdateBlocked(): boolean {
  return process.platform === "win32";
}

export function registerSystemIpc(
  mainWindowGetter: () => BrowserWindow | null,
): void {
  // Installation
  safeHandle("check-install", () => {
    return checkInstallStatus();
  });

  safeHandle("verify-install", () => verifyInstall());

  safeHandle("start-install", async (event) => {
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
  safeHandle("inspect-install-target", () => inspectInstallTarget());
  safeHandle("validate-hermes-home", (_event, dir: string) =>
    validateHermesHome(dir),
  );
  safeHandle("adopt-hermes-home", (_event, dir: string) => {
    if (!validateHermesHome(dir)) return false;
    setHermesHomeOverride(dir);
    return true;
  });
  safeHandle("quit-app", () => app.quit());

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

  safeHandle("run-hermes-update", async (event) => {
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
        void restartGateway();
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  safeHandle("check-hermes-update", async () => {
    if (isRemoteMode()) return { available: false, reason: "remote-mode" };
    try {
      return await checkHermesUpdate();
    } catch (err) {
      return { available: false, reason: (err as Error).message };
    }
  });

  safeHandle("get-hermes-agent-update-routine", (_event, profile?: string) =>
    getHermesAgentUpdateRoutine(profile),
  );
  safeHandle(
    "set-hermes-agent-update-routine",
    (
      _event,
      settings: Partial<{
        enabled: boolean;
        autoApply: boolean;
        engineUpdateChannel: "release" | "main";
      }>,
      profile?: string,
    ) => setHermesAgentUpdateRoutine(settings, profile),
  );
  safeHandle(
    "run-hermes-agent-update-check",
    async (
      event,
      profile?: string,
      options?: Partial<{ autoApply: boolean }>,
    ) =>
      runHermesAgentUpdateCheck(profile, {
        autoApply: options?.autoApply,
        onProgress: (progress: InstallProgress) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send("install-progress", progress);
          }
        },
      }),
  );
  safeHandle(
    "acknowledge-hermes-agent-update-contract-break",
    (_event, profile?: string) =>
      acknowledgeHermesAgentUpdateContractBreak(profile),
  );
  safeHandle("rollback-engine", async (event, profile?: string) => {
    if (isRemoteMode()) {
      return {
        success: false,
        error: "Rollback is only available for a local Hermes Agent engine.",
      };
    }

    const sha = getEngineCapabilityState(profile).lastVerifiedSha;
    if (!sha) {
      return {
        success: false,
        error:
          "No contract-verified Hermes Agent SHA is recorded for rollback.",
      };
    }

    try {
      await rollbackEngineTo(
        sha,
        (progress: InstallProgress) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send("install-progress", progress);
          }
        },
        mainWindowGetter(),
      );
      if (isGatewayRunning(profile)) {
        await restartGateway(profile);
      }
      await refreshEngineCapabilities(profile);
      const verification = await verifyAndRecordEngineContract(profile);
      if (verification.status === "broken") {
        return {
          success: false,
          sha,
          error:
            "Rolled back, but engine contract verification still reports breaking findings.",
        };
      }
      return { success: true, sha };
    } catch (err) {
      return { success: false, sha, error: (err as Error).message };
    }
  });
  safeHandle("get-hermes-upstream-watch-state", (_event, profile?: string) =>
    getHermesUpstreamWatchState(profile),
  );
  safeHandle("run-hermes-upstream-watch", (_event, profile?: string) =>
    runHermesUpstreamWatch(profile),
  );
  safeHandle("get-engine-capabilities", (_event, profile?: string) =>
    getEngineCapabilities(profile),
  );
  safeHandle("refresh-engine-capabilities", (_event, profile?: string) =>
    refreshEngineCapabilities(profile),
  );
  safeHandle("verify-engine-contract", (_event, profile?: string) =>
    verifyAndRecordEngineContract(profile),
  );

  // App version
  safeHandle("get-app-version", () => app.getVersion());
  safeHandle("get-desktop-update-routine", () => getDesktopUpdateRoutine());
  safeHandle(
    "set-desktop-update-routine",
    (_event, settings: Partial<{ enabled: boolean; autoDownload: boolean }>) =>
      setDesktopUpdateRoutine(settings),
  );
  safeHandle(
    "run-desktop-update-check",
    (_event, options?: Partial<{ autoDownload: boolean }>) =>
      runDesktopUpdateCheck({ autoDownload: options?.autoDownload }),
  );

  // Locale
  safeHandle("get-locale", () => getAppLocale());
  safeHandle("set-locale", (_event, locale: AppLocale) => setAppLocale(locale));

  // Git Changelog
  safeHandle("get-git-changelog", (_event) => getChangelog());

  // Backup / Import
  safeHandle("run-hermes-backup", (_event, profile?: string) =>
    runHermesBackup(profile),
  );
  safeHandle(
    "run-hermes-import",
    (_event, archivePath: string, profile?: string) =>
      runHermesImport(archivePath, profile),
  );

  // Debug dump
  registerDualHandler("run-hermes-dump", runHermesDump, sshRunDump);

  // MCP servers
  safeHandle("list-mcp-servers", (_event, profile?: string) =>
    listMcpServers(profile),
  );
  safeHandle(
    "add-mcp-server",
    (_event, input: McpServerInput, profile?: string) =>
      addMcpServer(input, profile),
  );
  safeHandle("remove-mcp-server", (_event, name: string, profile?: string) =>
    removeMcpServer(name, profile),
  );
  safeHandle(
    "set-mcp-server-enabled",
    (_event, name: string, enabled: boolean, profile?: string) =>
      setMcpServerEnabled(name, enabled, profile),
  );
  safeHandle("test-mcp-server", (_event, name: string, profile?: string) =>
    testMcpServer(name, profile),
  );
  safeHandle("list-mcp-catalog", (_event, profile?: string) =>
    listMcpCatalog(profile),
  );
  safeHandle(
    "install-mcp-catalog-entry",
    (_event, name: string, env?: Record<string, string>, profile?: string) =>
      installMcpCatalogEntry(name, env || {}, profile),
  );
  registerCapabilityRiskIpc();
  registerResearchReachIpc();

  // Memory providers
  registerDualHandler(
    "discover-memory-providers",
    discoverMemoryProviders,
    sshDiscoverMemoryProviders,
  );

  // Log viewer
  registerDualHandler("read-logs", readLogs, sshReadLogs);

  // MED-10 — Diagnostics over the local errors-only sink. Read-only + local:
  // nothing here sends data anywhere.
  safeHandle("system-open-logs", () => shell.openPath(hermesLogDir()));
  safeHandle("system-read-error-log", (_event, lines?: unknown) => {
    const limit =
      typeof lines === "number" && Number.isFinite(lines) && lines > 0
        ? Math.min(Math.floor(lines), 2000)
        : 300;
    return readErrorLogTail(limit);
  });
  safeHandle("system-clear-error-log", () => {
    clearErrorLog();
    return true;
  });

  // Auto-updater handlers
  const isPortableBuild = !!process.env.PORTABLE_EXECUTABLE_DIR;
  if (!app.isPackaged || isPortableBuild || !autoUpdater) {
    safeHandle("check-for-updates", async () => null);
    safeHandle("download-update", () => true);
    safeHandle("install-update", () => {});
    return;
  }
  if (isWindowsUnsignedAutoUpdateBlocked()) {
    safeHandle("check-for-updates", async () => null);
    safeHandle("download-update", () => false);
    safeHandle("install-update", () => {});
    return;
  }

  safeHandle("check-for-updates", async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return result?.updateInfo?.version || null;
    } catch {
      return null;
    }
  });

  safeHandle("download-update", async () => {
    try {
      await autoUpdater.downloadUpdate();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      mainWindowGetter()?.webContents.send("update-error", message);
      return false;
    }
  });

  safeHandle("install-update", () => {
    autoUpdater.logger?.info(
      "Restart requested by user — calling quitAndInstall(isSilent=false, isForceRunAfter=true)",
    );
    autoUpdater.quitAndInstall(false, true);
  });
}
