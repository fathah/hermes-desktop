import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  dialog,
  clipboard,
  session,
} from "electron";
import { join, extname } from "path";
import { randomUUID } from "crypto";
import { readdir, readFile, stat } from "fs/promises";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import type { AppUpdater } from "electron-updater";
import icon from "../../resources/icon.png?asset";
import type { Attachment } from "../shared/attachments";
import { stageAttachment, clearStagedAttachments } from "./attachment-staging";
import { persistPromptImageAttachments } from "./session-attachment-store";
import {
  discoverProviderModels,
  getModelContextWindow,
} from "./model-discovery";
import {
  persistSessionContinuation,
  persistSessionLocalError,
} from "./session-continuation-store";
import type {
  DesktopSessionContinuationItem,
  DesktopSessionLocalError,
} from "../shared/session-continuation";
import {
  cleanupTempMediaFiles,
  materializeDataUrlToTemp,
  readMediaAsDataUrl,
  saveMedia,
  mediaFileExists,
} from "./media";
import { openTerminalInDirectory } from "./terminal-launcher";
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
  checkOpenClawExists,
  runClawMigrate,
  runHermesBackup,
  runHermesImport,
  runHermesDump,
  discoverMemoryProviders,
  readLogs,
  InstallProgress,
} from "./installer";
import {
  ensureLocalDashboardCompatibility,
  ensureSshDashboardCompatibility,
} from "./hermes-agent-compat";
import {
  addMcpServer,
  installMcpCatalogEntry,
  listMcpCatalog,
  listMcpServers,
  removeMcpServer,
  setMcpServerEnabled,
  testMcpServer,
  type McpServerInput,
} from "./mcp-servers";
import { updaterLogger } from "./updater-log";
import {
  runHermesAuthLogin,
  cancelHermesAuthLogin,
  detectDeviceCode,
} from "./hermes-auth";
import {
  isRemoteMode,
  isRemoteOnlyMode,
  sendMessage,
  transcribeAudio,
  startGateway,
  startGatewayDetailed,
  stopGateway,
  isGatewayRunning,
  testRemoteConnection,
  stopHealthPolling,
  restartGateway,
  notifyProfileSwitched,
  ensureSshTunnelIfNeeded,
  setSshRemoteApiKey,
  getRemoteAuthHeader,
  resolvePendingClarify,
} from "./hermes";
import {
  getDashboardStatus,
  startDashboard,
  stopAllDashboards,
  stopDashboard,
} from "./dashboard";
import {
  startSshTunnel,
  ensureSshTunnel,
  getSshTunnelUrl,
  stopSshTunnel,
  testSshConnection,
  isSshTunnelActive,
  isSshTunnelHealthy,
} from "./ssh-tunnel";
import {
  getClaw3dStatus,
  setupClaw3d,
  startDevServer,
  stopDevServer,
  startAdapter,
  stopAdapter,
  startAll as startClaw3dAll,
  stopAll as stopClaw3d,
  getClaw3dLogs,
  setClaw3dPort,
  getClaw3dPort,
  setClaw3dWsUrl,
  getClaw3dWsUrl,
  waitForClaw3dReady,
  Claw3dSetupProgress,
} from "./claw3d";
import { startOfficeStack } from "./office-start";
import {
  readEnv,
  setEnvValue,
  getConfigValue,
  setConfigValue,
  getHermesHome,
  getModelConfig,
  setModelConfig,
  getCredentialPool,
  setCredentialPool,
  addCredentialPoolEntry,
  getConnectionConfig,
  getPublicConnectionConfig,
  normalizeRemoteChatTransport,
  resolveConnectionApiKeyUpdate,
  setConnectionConfig,
  getPlatformEnabled,
  setPlatformEnabled,
  getApiServerKeyStatus,
  invalidateSecretsCache,
  type ConnectionConfig,
  secretsProviderStatus,
  secretsProviderCanWrite,
} from "./config";
import {
  getAuxiliaryConfig,
  setAuxiliaryTask,
  resetAuxiliaryToAuto,
} from "./auxiliary-config";
import {
  applySessionLocalOverlays,
  listSessions,
  getSessionMessages,
  searchSessions,
  deleteSession,
  deleteSessions,
} from "./sessions";
import { closeDbConnection } from "./db";
import {
  syncSessionCache,
  listCachedSessions,
  updateSessionTitle,
} from "./session-cache";
import {
  remoteDeleteSession,
  remoteDeleteSessions,
  remoteGetSessionMessages,
  remoteListCachedSessions,
  remoteListSessions,
  remoteReadMediaAsDataUrl,
  remoteSearchSessions,
  remoteUpdateSessionTitle,
  type RemoteSessionConfig,
} from "./remote-sessions";
import { remoteGetHermesHome, remoteGetHermesVersion } from "./remote-metadata";
import {
  remoteAddModel,
  remoteGetModelConfig,
  remoteListModels,
  remoteRemoveModel,
  remoteSetModelConfig,
  remoteUpdateModel,
} from "./remote-models";
import { listModels, addModel, removeModel, updateModel } from "./models";
import { validateChatReadiness } from "./validation";
import {
  runConfigHealthCheck,
  autoFixIssue,
  readConfigFixLog,
  type IssueCode,
} from "./config-health";
import {
  listProfiles,
  createProfile,
  deleteProfile,
  setActiveProfile,
} from "./profiles";
import {
  setProfileColor,
  setProfileAvatar,
  removeProfileAvatar,
} from "./profile-meta";
import {
  readMemory,
  addMemoryEntry,
  updateMemoryEntry,
  removeMemoryEntry,
  writeUserProfile,
} from "./memory";
import { readSoul, writeSoul, resetSoul } from "./soul";
import {
  getPlatformToolsets,
  getToolsets,
  setMessagingPlatformToolsetEnabled,
  setToolsetEnabled,
} from "./tools";
import {
  fetchRegistry,
  fetchModelRegistry,
  fetchRegistryDetail,
  listInstalledRegistry,
  installRegistryItem,
  type RegistryKind,
  type RegistryItem,
} from "./registry";
import {
  listInstalledSkills,
  listBundledSkills,
  getSkillContent,
  installSkill,
  uninstallSkill,
} from "./skills";
import {
  listCronJobs,
  createCronJob,
  removeCronJob,
  pauseCronJob,
  resumeCronJob,
  triggerCronJob,
} from "./cronjobs";
import {
  applyMessagingPlatformUpdate,
  buildDesktopMessagingPlatforms,
  fetchRemoteMessagingPlatforms,
  readLocalGatewayPlatformStates,
  testDesktopMessagingPlatform,
  testRemoteMessagingPlatform,
  updateRemoteMessagingPlatform,
} from "./messaging-platforms";
import {
  listBoards as kanbanListBoards,
  currentBoard as kanbanCurrentBoard,
  switchBoard as kanbanSwitchBoard,
  createBoard as kanbanCreateBoard,
  removeBoard as kanbanRemoveBoard,
  listTasks as kanbanListTasks,
  getTask as kanbanGetTask,
  createTask as kanbanCreateTask,
  assignTask as kanbanAssignTask,
  completeTask as kanbanCompleteTask,
  blockTask as kanbanBlockTask,
  unblockTask as kanbanUnblockTask,
  archiveTask as kanbanArchiveTask,
  specifyTask as kanbanSpecifyTask,
  reclaimTask as kanbanReclaimTask,
  commentTask as kanbanCommentTask,
  dispatchOnce as kanbanDispatchOnce,
  listClaw3dHqTasks as kanbanListClaw3dHqTasks,
  CreateTaskInput,
} from "./kanban";
import { getAppLocale, setAppLocale } from "./locale";
import {
  hardenAttachedWebContents,
  hardenWebviewPreferences,
  isAllowedAppNavigationUrl,
  isAllowedExternalUrl,
  isAllowedWebviewUrl,
} from "./security";
import type { AppLocale } from "../shared/i18n/types";
import {
  sshListInstalledSkills,
  sshGetSkillContent,
  sshInstallSkill,
  sshUninstallSkill,
  sshListBundledSkills,
  sshReadMemory,
  sshAddMemoryEntry,
  sshUpdateMemoryEntry,
  sshRemoveMemoryEntry,
  sshWriteUserProfile,
  sshReadSoul,
  sshWriteSoul,
  sshResetSoul,
  sshGetToolsets,
  sshGetPlatformToolsets,
  sshSetToolsetEnabled,
  sshSetMessagingPlatformToolsetEnabled,
  sshReadEnv,
  sshSetEnvValue,
  sshGetConfigValue,
  sshSetConfigValue,
  sshGetHermesHome,
  sshGetModelConfig,
  sshSetModelConfig,
  sshListSessions,
  sshGetSessionMessages,
  sshSearchSessions,
  sshListProfiles,
  sshCreateProfile,
  sshDeleteProfile,
  sshGatewayStatus,
  sshStartGateway,
  sshStopGateway,
  sshReadRemoteApiKey,
  sshGetHermesVersion,
  sshReadLogs,
  sshGetPlatformEnabled,
  sshSetPlatformEnabled,
  sshListCachedSessions,
  sshRunDoctor,
  sshListModels,
  sshAddModel,
  sshRemoveModel,
  sshUpdateModel,
  sshRunUpdate,
  sshRunDump,
  sshDiscoverMemoryProviders,
} from "./ssh-remote";
import { applyGpuPreferences, installGpuCrashGuard } from "./gpu-fallback";

// Disable hardware acceleration up front if a prior launch detected a fatal
// GPU crash (or the user forced it). MUST run before app is ready. See
// gpu-fallback.ts / issue #592.
applyGpuPreferences();
installGpuCrashGuard();

process.on("uncaughtException", (err) => {
  console.error("[MAIN UNCAUGHT]", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[MAIN UNHANDLED REJECTION]", reason);
});

const APP_NAME = process.env.HERMES_DESKTOP_APP_NAME?.trim() || "Hermes One";

let mainWindow: BrowserWindow | null = null;
// Per-run abort handles, keyed by the renderer-minted runId. Multiple chats
// run concurrently (background sessions / multi-agent), so starting a new run
// must not abort siblings — only a re-send under the same runId does.
const activeRuns = new Map<string, () => void>();

function notifyConnectionConfigChanged(): void {
  mainWindow?.webContents.send(
    "connection-config-changed",
    getPublicConnectionConfig(),
  );
}

function notifyModelLibraryChanged(): void {
  mainWindow?.webContents.send("model-library-changed");
}

type RemoteSessionBridgeConfig = RemoteSessionConfig;

async function getSshDashboardSessionConfig(
  conn: ConnectionConfig,
): Promise<RemoteSessionBridgeConfig> {
  if (conn.mode !== "ssh" || !conn.ssh) {
    throw new Error("SSH connection is not configured.");
  }
  if (!(await sshGatewayStatus(conn.ssh))) {
    await sshStartGateway(conn.ssh);
  }
  await ensureSshTunnel(conn.ssh);
  const remoteUrl = getSshTunnelUrl();
  const apiKey = conn.apiKey.trim() || (await sshReadRemoteApiKey(conn.ssh));
  if (!remoteUrl) throw new Error("SSH tunnel is not active.");
  if (!apiKey.trim()) {
    throw new Error(
      "SSH dashboard sessions need a configured dashboard token or API_SERVER_KEY on the remote Hermes host.",
    );
  }
  setSshRemoteApiKey(apiKey);
  return { remoteUrl, apiKey };
}

async function withSshDashboardSessions<T>(
  conn: ConnectionConfig,
  dashboardOperation: (config: RemoteSessionBridgeConfig) => Promise<T>,
  legacyOperation?: () => Promise<T> | T,
): Promise<T> {
  if (conn.sshChatTransport === "legacy") {
    if (legacyOperation) return legacyOperation();
    throw new Error("This SSH session operation requires dashboard transport.");
  }

  try {
    return await dashboardOperation(await getSshDashboardSessionConfig(conn));
  } catch (err) {
    if (conn.sshChatTransport === "auto" && legacyOperation) {
      return legacyOperation();
    }
    throw err;
  }
}

async function withSshDashboardModelLibrary<T>(
  conn: ConnectionConfig,
  dashboardOperation: (config: RemoteSessionBridgeConfig) => Promise<T>,
  legacyOperation: () => Promise<T> | T,
): Promise<T> {
  if (conn.mode !== "ssh" || !conn.ssh) {
    throw new Error("SSH connection is not configured.");
  }
  if (conn.sshChatTransport === "legacy") {
    return legacyOperation();
  }

  const compat = await ensureSshDashboardCompatibility(conn.ssh);
  if (!compat.ok) {
    console.warn(
      "[ssh-model-library] Dashboard model-library compatibility check failed",
      compat.error ? `${compat.detail}: ${compat.error}` : compat.detail,
    );
  } else if (compat.applied) {
    try {
      await sshStopGateway(conn.ssh);
    } catch (err) {
      console.warn("[ssh-model-library] Failed to stop patched gateway", err);
    }
    stopSshTunnel();
    await sshStartGateway(conn.ssh);
  }

  return dashboardOperation(await getSshDashboardSessionConfig(conn));
}

async function withRemoteDashboard<T>(
  conn: ConnectionConfig,
  dashboardOperation: () => Promise<T>,
  legacyOperation: () => Promise<T> | T,
): Promise<T> {
  if (conn.remoteChatTransport === "legacy") return legacyOperation();
  try {
    return await dashboardOperation();
  } catch (err) {
    if (conn.remoteChatTransport === "auto") return legacyOperation();
    throw err;
  }
}

async function getActiveDashboardMediaConfig(): Promise<RemoteSessionBridgeConfig | null> {
  const conn = getConnectionConfig();
  if (conn.mode === "remote") {
    if (conn.remoteChatTransport === "legacy") return null;
    if (!conn.remoteUrl.trim() || !conn.apiKey.trim()) return null;
    return { remoteUrl: conn.remoteUrl, apiKey: conn.apiKey };
  }
  if (conn.mode === "ssh") {
    if (conn.sshChatTransport === "legacy") return null;
    try {
      return await getSshDashboardSessionConfig(conn);
    } catch {
      return null;
    }
  }
  return null;
}

async function readMediaForCurrentConnection(
  filePath: string,
): Promise<string | null> {
  const local = readMediaAsDataUrl(filePath);
  if (local) return local;

  const remote = await getActiveDashboardMediaConfig();
  return remote ? remoteReadMediaAsDataUrl(remote, filePath) : null;
}

async function mediaFileExistsForCurrentConnection(
  filePath: string,
): Promise<boolean> {
  if (mediaFileExists(filePath)) return true;

  const remote = await getActiveDashboardMediaConfig();
  if (!remote) return false;
  return (await remoteReadMediaAsDataUrl(remote, filePath)) !== null;
}

async function resolveMediaForSave(src: string): Promise<string> {
  if (src.startsWith("data:") || /^https?:\/\//i.test(src)) return src;
  return (await readMediaForCurrentConnection(src)) ?? src;
}

function openExternalUrl(rawUrl: unknown): void {
  if (!isAllowedExternalUrl(rawUrl)) {
    console.warn("[SECURITY] Blocked unsafe external URL");
    return;
  }

  shell.openExternal(rawUrl).catch((err) => {
    console.error("[SECURITY] Failed to open external URL:", err);
  });
}

function createWindow(): void {
  const rendererHtmlPath = join(__dirname, "../renderer/index.html");

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 850,
    minWidth: 900,
    title: APP_NAME,
    // Lowered from 820 to fit on 768p / 720p displays — Linux WMs
    // enforce minHeight strictly, clipping content (chat input, bottom
    // nav items) below the screen edge on 1366×768 laptops. Issue #393.
    // Companion CSS change makes .sidebar-nav scrollable when content
    // exceeds available vertical space.
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : undefined,
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 16, y: 16 } }
      : {}),
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: true,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow!.show();
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(
      "[CRASH] Renderer process gone:",
      details.reason,
      details.exitCode,
    );
  });

  mainWindow.webContents.on(
    "console-message",
    (_event, level, message, line, sourceId) => {
      if (level >= 2) {
        console.error(`[RENDERER ERROR] ${message} (${sourceId}:${line})`);
      }
    },
  );

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription) => {
      console.error("[LOAD FAIL]", errorCode, errorDescription);
    },
  );

  mainWindow.webContents.setWindowOpenHandler((details) => {
    openExternalUrl(details.url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (
      isAllowedAppNavigationUrl(
        url,
        rendererHtmlPath,
        is.dev ? process.env["ELECTRON_RENDERER_URL"] : undefined,
      )
    ) {
      return;
    }

    event.preventDefault();
    openExternalUrl(url);
  });

  mainWindow.webContents.on(
    "will-attach-webview",
    (event, webPreferences, params) => {
      const isWebPreview = params.partition === "web-preview";
      if (!isAllowedWebviewUrl(params.src, isWebPreview)) {
        event.preventDefault();
        console.warn("[SECURITY] Blocked webview attachment for untrusted URL");
        return;
      }

      hardenWebviewPreferences(webPreferences);
    },
  );

  // Right-click context menu (issue #298): native Cut/Copy/Paste/Select All
  // via Electron roles — they act on the focused field / selection and work
  // across the whole app — plus two items to copy the whole conversation.
  mainWindow.webContents.on("context-menu", (_event, params) => {
    const { editFlags, isEditable } = params;
    const template: Electron.MenuItemConstructorOptions[] = [];
    if (isEditable) {
      template.push(
        { role: "cut", enabled: editFlags.canCut },
        { role: "copy", enabled: editFlags.canCopy },
        { role: "paste", enabled: editFlags.canPaste },
        { type: "separator" },
        // The selectAll role scopes correctly to the focused input field.
        { role: "selectAll" },
      );
    } else {
      template.push(
        { role: "copy", enabled: editFlags.canCopy },
        { type: "separator" },
        // The selectAll role would select the entire window for non-editable
        // content — scope it to the message bubble under the cursor instead.
        {
          label: "Select All",
          click: () =>
            mainWindow?.webContents.send("context-menu-select-bubble", {
              x: params.x,
              y: params.y,
            }),
        },
      );
    }
    template.push(
      { type: "separator" },
      {
        label: "Copy entire chat (text)",
        click: () =>
          mainWindow?.webContents.send("context-menu-copy-chat", "text"),
      },
      {
        label: "Copy entire chat (Markdown)",
        click: () =>
          mainWindow?.webContents.send("context-menu-copy-chat", "markdown"),
      },
    );
    Menu.buildFromTemplate(template).popup();
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(rendererHtmlPath);
  }
}

function setupIPC(): void {
  // Installation
  ipcMain.handle("check-install", () => {
    return checkInstallStatus();
  });

  ipcMain.handle("verify-install", () => verifyInstall());

  ipcMain.handle("start-install", async (event) => {
    try {
      await runInstall((progress: InstallProgress) => {
        event.sender.send("install-progress", progress);
      }, mainWindow);
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
    // Persist the choice only. HERMES_HOME is resolved once at module
    // load, so the override takes effect on the next launch — the renderer
    // asks the user to restart. (An app-driven relaunch is unreliable
    // under the dev server, which is torn down with the process.)
    setHermesHomeOverride(dir);
    return true;
  });
  ipcMain.handle("quit-app", () => app.quit());

  // Hermes engine info
  ipcMain.handle("get-hermes-version", async () => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote") return remoteGetHermesVersion(conn);
    if (conn.mode === "ssh" && conn.ssh)
      return withSshDashboardSessions(
        conn,
        (config) => remoteGetHermesVersion(config),
        () => sshGetHermesVersion(conn.ssh),
      );
    return getHermesVersion();
  });
  ipcMain.handle("refresh-hermes-version", async () => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote") return remoteGetHermesVersion(conn);
    if (conn.mode === "ssh" && conn.ssh)
      return withSshDashboardSessions(
        conn,
        (config) => remoteGetHermesVersion(config),
        () => sshGetHermesVersion(conn.ssh),
      );
    clearVersionCache();
    return getHermesVersion();
  });
  ipcMain.handle("run-hermes-doctor", () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshRunDoctor(conn.ssh);
    return runHermesDoctor();
  });
  ipcMain.handle("run-hermes-update", async (event) => {
    try {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        event.sender.send("install-progress", {
          step: 1,
          totalSteps: 1,
          title: "Updating remote Hermes Agent",
          detail: "Running hermes update over SSH...",
          log: "Running hermes update over SSH...\n",
        });
        await sshRunUpdate(conn.ssh);
        const compat = await ensureSshDashboardCompatibility(conn.ssh);
        if (!compat.ok) {
          event.sender.send("install-progress", {
            step: 1,
            totalSteps: 1,
            title: "Updating remote Hermes Agent",
            detail: "Dashboard compatibility check needs attention.",
            log: `Dashboard compatibility warning: ${
              compat.error ? `${compat.detail}: ${compat.error}` : compat.detail
            }\n`,
          });
        }
        await sshStartGateway(conn.ssh);
        await startSshTunnel(conn.ssh);
        const key = conn.apiKey.trim() || (await sshReadRemoteApiKey(conn.ssh));
        setSshRemoteApiKey(key);
        return { success: true };
      }
      await runHermesUpdate((progress: InstallProgress) => {
        event.sender.send("install-progress", progress);
      });
      const compat = ensureLocalDashboardCompatibility();
      if (!compat.ok) {
        event.sender.send("install-progress", {
          step: 1,
          totalSteps: 1,
          title: "Updating Hermes Agent",
          detail: "Dashboard compatibility check needs attention.",
          log: `Dashboard compatibility warning: ${
            compat.error ? `${compat.detail}: ${compat.error}` : compat.detail
          }\n`,
        });
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // OpenClaw migration
  ipcMain.handle("check-openclaw", () => checkOpenClawExists());
  ipcMain.handle("run-claw-migrate", async (event) => {
    try {
      await runClawMigrate((progress: InstallProgress) => {
        event.sender.send("install-progress", progress);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // OAuth provider sign-in — spawns `hermes auth add <provider> --type
  // oauth`, streaming the CLI's output to the renderer's sign-in modal.
  ipcMain.handle("oauth-login", (event, provider: string, profile?: string) => {
    // Codex uses a device-code flow: it prints a URL + code instead
    // of opening a browser. Watch the stream for that prompt, then
    // open the page and pre-copy the code so the user just pastes.
    let buffer = "";
    let deviceHandled = false;
    return runHermesAuthLogin(
      provider,
      (chunk) => {
        // The user can close the modal mid-flow before cancelHermesAuthLogin
        // tears down the subprocess; any send on a destroyed sender throws.
        if (event.sender.isDestroyed()) return;
        event.sender.send("oauth-login-progress", chunk);
        if (deviceHandled) return;
        buffer += chunk;
        const device = detectDeviceCode(buffer);
        if (device) {
          deviceHandled = true;
          openExternalUrl(device.url);
          clipboard.writeText(device.code);
          event.sender.send(
            "oauth-login-progress",
            `\n→ Code ${device.code} copied to clipboard — opening browser...\n`,
          );
        }
      },
      profile,
    );
  });
  ipcMain.handle("oauth-login-cancel", () => cancelHermesAuthLogin());

  // Configuration (profile-aware)
  ipcMain.handle("get-locale", () => getAppLocale());
  ipcMain.handle("set-locale", (_event, locale: AppLocale) =>
    setAppLocale(locale),
  );

  ipcMain.handle("get-env", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshReadEnv(conn.ssh, profile);
    return readEnv(profile);
  });

  // Pre-send chat readiness — answers "if Send is clicked right now,
  // will it work?". Fail-open semantics: any uncertain state returns
  // `ok: true`, so the renderer never false-blocks a Send.
  ipcMain.handle("validate-chat-readiness", (_event, profile?: string) => {
    return validateChatReadiness(profile);
  });

  // Config-health audit + per-issue auto-fix. The renderer renders a
  // dismissible banner above the chat input and a full report in the
  // Settings → Diagnose section. Auto-fixes are additive only — never
  // delete; always log to ~/.hermes/logs/config-fixes.log.
  ipcMain.handle("get-config-health", (_event, profile?: string) => {
    return runConfigHealthCheck(profile);
  });

  ipcMain.handle("rerun-config-health", (_event, profile?: string) => {
    return runConfigHealthCheck(profile);
  });

  ipcMain.handle(
    "autofix-config-issue",
    (
      _event,
      code: IssueCode,
      profile?: string,
      context?: Record<string, string>,
    ) => {
      return autoFixIssue(code, profile, context);
    },
  );

  ipcMain.handle("get-config-fix-log", (_event, maxEntries?: number) => {
    return readConfigFixLog(maxEntries);
  });

  ipcMain.handle(
    "set-env",
    async (_event, key: string, value: string, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        await sshSetEnvValue(conn.ssh, key, value, profile);
        return true;
      }
      setEnvValue(key, value, profile);
      // Restart gateway so it picks up the new API key.
      // The earlier condition had a precedence bug —
      //   `(isGatewayRunning() && _API_KEY) || _TOKEN || HF_TOKEN`
      // — that triggered a restart for `_TOKEN`/`HF_TOKEN` writes even
      // when no local gateway was running, which in remote mode hit the
      // `startGateway` path with no local install (issue #266).
      // restartGateway() now also self-gates on isRemoteMode(), so this
      // is belt-and-braces, but the condition is fixed too for clarity.
      const looksLikeCredential =
        key.endsWith("_API_KEY") ||
        key.endsWith("_TOKEN") ||
        key === "HF_TOKEN";
      if (isGatewayRunning(profile) && looksLikeCredential) {
        restartGateway(profile);
      }
      return true;
    },
  );

  ipcMain.handle("get-config", (_event, key: string, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshGetConfigValue(conn.ssh, key, profile);
    return getConfigValue(key, profile);
  });

  ipcMain.handle(
    "set-config",
    async (_event, key: string, value: string, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        await sshSetConfigValue(conn.ssh, key, value, profile);
        return true;
      }
      setConfigValue(key, value, profile);
      return true;
    },
  );

  ipcMain.handle("get-hermes-home", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote") return remoteGetHermesHome(conn);
    if (conn.mode === "ssh" && conn.ssh)
      return withSshDashboardSessions(
        conn,
        (config) => remoteGetHermesHome(config),
        () => sshGetHermesHome(conn.ssh, profile),
      );
    return getHermesHome(profile);
  });

  ipcMain.handle("get-model-config", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote")
      return withRemoteDashboard(
        conn,
        () => remoteGetModelConfig(conn),
        () => getModelConfig(profile),
      );
    if (conn.mode === "ssh" && conn.ssh)
      return withSshDashboardSessions(
        conn,
        (config) => remoteGetModelConfig(config),
        () => sshGetModelConfig(conn.ssh!, profile),
      );
    return getModelConfig(profile);
  });

  ipcMain.handle(
    "set-model-config",
    async (
      _event,
      provider: string,
      model: string,
      baseUrl: string,
      profile?: string,
    ) => {
      const conn = getConnectionConfig();
      if (conn.mode === "remote") {
        return withRemoteDashboard(
          conn,
          () => remoteSetModelConfig(conn, provider, model, baseUrl),
          () => {
            const prev = getModelConfig(profile);
            setModelConfig(provider, model, baseUrl, profile);
            if (
              isGatewayRunning(profile) &&
              (prev.provider !== provider ||
                prev.model !== model ||
                prev.baseUrl !== baseUrl)
            ) {
              restartGateway(profile);
            }
            return true;
          },
        );
      }
      if (conn.mode === "ssh" && conn.ssh) {
        return withSshDashboardSessions(
          conn,
          (config) => remoteSetModelConfig(config, provider, model, baseUrl),
          async () => {
            const prev = await sshGetModelConfig(conn.ssh!, profile);
            await sshSetModelConfig(
              conn.ssh!,
              provider,
              model,
              baseUrl,
              profile,
            );
            if (
              (await sshGatewayStatus(conn.ssh!)) &&
              (prev.provider !== provider ||
                prev.model !== model ||
                prev.baseUrl !== baseUrl)
            ) {
              await sshStopGateway(conn.ssh!);
              await sshStartGateway(conn.ssh!);
            }
            return true;
          },
        );
      }
      const prev = getModelConfig(profile);
      // Mirror the activated model's context-window override (if any) into
      // config.yaml so the gauge and the agent's auto-compaction threshold use
      // it. Passing `null` when the library entry has none clears any stale
      // value left by a previously-active model.
      const libContextLength = listModels().find(
        (m) => m.provider === provider && m.model === model,
      )?.contextLength;
      setModelConfig(
        provider,
        model,
        baseUrl,
        profile,
        libContextLength ?? null,
      );

      // Restart gateway when provider, model, or endpoint changes so it picks up new config
      if (
        isGatewayRunning(profile) &&
        (prev.provider !== provider ||
          prev.model !== model ||
          prev.baseUrl !== baseUrl)
      ) {
        restartGateway(profile);
      }

      return true;
    },
  );

  // Auxiliary (side-task) model routing
  ipcMain.handle("get-auxiliary-config", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) {
      // TODO: SSH path for auxiliary config (requires sshGetAuxiliaryConfig)
      return [];
    }
    return getAuxiliaryConfig(profile);
  });

  ipcMain.handle(
    "set-auxiliary-task",
    async (
      _event,
      task: string,
      cfg: { provider: string; model: string; baseUrl: string },
      profile?: string,
    ) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        // TODO: SSH path for auxiliary config (requires sshSetAuxiliaryTask)
        return false;
      }
      setAuxiliaryTask(task, cfg, profile);

      // Restart gateway so it picks up the new auxiliary config
      if (isGatewayRunning(profile)) {
        restartGateway(profile);
      }

      return true;
    },
  );

  ipcMain.handle("reset-auxiliary-config", async (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) {
      // TODO: SSH path for auxiliary config (requires sshResetAuxiliaryConfig)
      return false;
    }
    resetAuxiliaryToAuto(profile);

    // Restart gateway so it picks up the reset
    if (isGatewayRunning(profile)) {
      restartGateway(profile);
    }

    return true;
  });

  // API_SERVER_KEY management — lets the renderer detect a missing key and
  // generate one with a button click (local mode) or show instructions (remote/SSH).
  // Additive shape: `hasKey` stays the required primary field; `providerId` /
  // `checkedAt` are optional extras for a follow-up Settings/Gateway UI.
  ipcMain.handle("get-api-server-key-status", (_event, profile?: string) =>
    getApiServerKeyStatus(profile),
  );

  // Drops the cached secrets-provider values so the next status check re-reads
  // the vault — lets the renderer's "Refresh from vault" button take effect
  // immediately instead of waiting out the cache TTL.
  ipcMain.handle("invalidate-secrets-cache", () => {
    invalidateSecretsCache();
  });

  // Active secret provider + the NAMES of keys it resolves (never values) —
  // powers the Settings "Security Providers" section's status + Test button.
  ipcMain.handle("secrets-provider-status", (_event, profile?: string) => {
    return secretsProviderStatus(profile);
  });

  // Whether the vault can be edited/deleted from the UI right now (helper
  // configured AND vault currently unlocked-and-resolving). Booleans only.
  ipcMain.handle("secrets-provider-can-write", (_event, profile?: string) => {
    return secretsProviderCanWrite(profile);
  });

  // Write/update one secret in the vault. The value is delivered to the helper
  // on stdin and NEVER logged or echoed back across IPC — only ok/err returns.
  // Guarded by the same can-write gate the UI uses, so a renderer can't bypass
  // the "unlocked + helper configured" requirement.
  ipcMain.handle(
    "secrets-provider-write",
    async (_event, key: string, value: string, profile?: string) => {
      const gate = secretsProviderCanWrite(profile);
      if (!gate.canWrite) return { ok: false, error: "write-not-permitted" };
      const { commandWriteSecret } =
        await import("./secrets/commandProviderWrite");
      const result = commandWriteSecret(key, value, profile);
      if (result.ok) invalidateSecretsCache();
      return result;
    },
  );

  // Delete one secret from the vault. Same gate; key NAME only crosses IPC.
  ipcMain.handle(
    "secrets-provider-delete",
    async (_event, key: string, profile?: string) => {
      const gate = secretsProviderCanWrite(profile);
      if (!gate.canDelete) return { ok: false, error: "delete-not-permitted" };
      const { commandDeleteSecret } =
        await import("./secrets/commandProviderWrite");
      const result = commandDeleteSecret(key, profile);
      if (result.ok) invalidateSecretsCache();
      return result;
    },
  );

  // ── Vault bootstrap (first-run onboarding) ────────────────────────────────
  // Detect an existing secrets source (tmpfs dump or a vault on disk) so the
  // setup wizard can auto-fill instead of dead-ending. Returns NAMES/paths
  // only — never a secret value (the tmpfs key enumeration is names-only).
  ipcMain.handle("vault-detect-existing", async () => {
    const { detectExistingVault } = await import("./secrets/vaultBootstrap");
    return detectExistingVault();
  });

  // What tooling is available for the create/seal paths (keepassxc-cli, TPM).
  // Drives whether the UI offers "create new vault" vs an install hint — the
  // dependency-honesty contract: never a silent missing-dependency dead end.
  ipcMain.handle("vault-tool-availability", async () => {
    const { checkToolAvailability } = await import("./secrets/vaultBootstrap");
    return checkToolAvailability();
  });

  // Create a NEW key-file-backed KeePassXC vault at a UID-safe default location
  // (or an explicit path). Returns the ready `secrets.command` and the resolved
  // paths — never the key-file contents. The renderer persists the command and
  // switches the provider; this handler does NOT mutate config itself so the
  // create step stays a pure, reviewable side-effect.
  ipcMain.handle(
    "vault-create",
    async (_event, opts?: { vaultPath?: string; keyPath?: string }) => {
      const { createVault } = await import("./secrets/vaultBootstrap");
      // AIR-016: createVault is async (db-create can block seconds); await it so
      // the main thread stays free while the vault is created.
      return await createVault(opts);
    },
  );

  // OPT-IN: seal a freshly created key-file to the TPM for boot auto-unlock.
  // Conservative — reports sealed:false honestly (and ensures a 0600 fallback)
  // whenever a real TPM seal cannot be confirmed, so the UI never claims
  // hardware protection that didn't happen.
  ipcMain.handle("vault-seal-tpm", async (_event, keyPath: string) => {
    const { sealKeyFileToTpm } = await import("./secrets/vaultBootstrap");
    // AIR-016: sealKeyFileToTpm is async (the TPM seal can block 7–15s); await
    // it so the handler resolves only when done, while the main thread stayed
    // free the whole time (the renderer keeps painting its spinner).
    return await sealKeyFileToTpm(keyPath);
  });

  ipcMain.handle(
    "generate-api-server-key",
    async (_event, profile?: string) => {
      const { randomUUID } = await import("crypto");
      const key = `desk-${randomUUID()}`;
      // Write to both the active profile .env and the default .env so the
      // gateway (which reads the profile .env) and the desktop (which reads
      // the default .env as fallback) both see the same key.
      setEnvValue("API_SERVER_KEY", key, profile);
      if (profile && profile !== "default") {
        setEnvValue("API_SERVER_KEY", key);
      }
      // Restart gateway so it picks up the new key immediately.
      if (isGatewayRunning(profile)) {
        stopGateway(profile, true);
        await new Promise<void>((r) => setTimeout(r, 800));
        startGateway(profile);
      }
      return { key };
    },
  );

  // Connection mode (local / remote / ssh)
  ipcMain.handle("is-remote-mode", () => isRemoteMode());
  ipcMain.handle("is-remote-only-mode", () => isRemoteOnlyMode());
  ipcMain.handle("get-connection-config", () => getPublicConnectionConfig());
  ipcMain.handle("is-ssh-tunnel-active", () => isSshTunnelActive());

  ipcMain.handle(
    "set-connection-config",
    (
      _event,
      mode: "local" | "remote" | "ssh",
      remoteUrl: string,
      apiKey?: string,
    ) => {
      const existing = getConnectionConfig();
      setConnectionConfig({
        ...existing,
        mode,
        remoteUrl,
        apiKey: resolveConnectionApiKeyUpdate(
          existing,
          mode,
          remoteUrl,
          apiKey,
        ),
      });
      notifyConnectionConfigChanged();
      return true;
    },
  );

  ipcMain.handle(
    "set-connection-chat-transports",
    (_event, remoteChatTransport: unknown, sshChatTransport: unknown) => {
      const current = getConnectionConfig();
      setConnectionConfig({
        ...current,
        remoteChatTransport: normalizeRemoteChatTransport(remoteChatTransport),
        sshChatTransport: normalizeRemoteChatTransport(sshChatTransport),
      });
      notifyConnectionConfigChanged();
      return true;
    },
  );

  ipcMain.handle(
    "set-ssh-config",
    (
      _event,
      host: string,
      port: number,
      username: string,
      keyPath: string,
      remotePort: number,
      localPort: number,
    ) => {
      const current = getConnectionConfig();
      setConnectionConfig({
        ...current,
        mode: "ssh",
        ssh: { host, port, username, keyPath, remotePort, localPort },
      });
      notifyConnectionConfigChanged();
      return true;
    },
  );

  ipcMain.handle(
    "test-remote-connection",
    (_event, url: string, apiKey?: string) => testRemoteConnection(url, apiKey),
  );

  ipcMain.handle(
    "test-ssh-connection",
    (
      _event,
      host: string,
      port: number,
      username: string,
      keyPath: string,
      remotePort: number,
    ) =>
      testSshConnection({
        host,
        port,
        username,
        keyPath,
        remotePort,
        localPort: 19642,
      }),
  );

  ipcMain.handle("start-ssh-tunnel", async () => {
    const conn = getConnectionConfig();
    if (conn.mode !== "ssh") return false;
    if (conn.ssh && !(await sshGatewayStatus(conn.ssh))) {
      await sshStartGateway(conn.ssh);
    }
    await ensureSshTunnel(conn.ssh);
    // Cache the remote API key so chat auth works through the tunnel
    if (conn.ssh) {
      const key = conn.apiKey.trim() || (await sshReadRemoteApiKey(conn.ssh));
      setSshRemoteApiKey(key);
    }
    return true;
  });

  ipcMain.handle("stop-ssh-tunnel", () => {
    stopSshTunnel();
    return true;
  });

  // Chat — lazy-start gateway on first message
  ipcMain.handle(
    "transcribe-audio",
    async (
      _event,
      audio: Uint8Array,
      mimeType: string,
      profile?: string,
    ): Promise<string> => transcribeAudio(audio, mimeType, profile),
  );

  ipcMain.handle(
    "send-message",
    async (
      event,
      message: string,
      profile?: string,
      resumeSessionId?: string,
      history?: Array<{ role: string; content: string }>,
      attachments?: Attachment[],
      contextFolder?: string,
      runId?: string,
      modelOverride?: string,
    ) => {
      // Each conversation has a stable runId minted by the renderer. Fall back
      // to a generated id for legacy callers so the run is still tracked.
      const chatRunId = runId || `run-${randomUUID()}`;
      if (!isRemoteMode() && !isGatewayRunning(profile)) {
        startGateway(profile);
      }

      await ensureSshTunnelIfNeeded();
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        const gatewayRunning = await sshGatewayStatus(conn.ssh);
        const tunnelHealthy = await isSshTunnelHealthy();
        if (!gatewayRunning || !tunnelHealthy) {
          await sshStartGateway(conn.ssh);
          await ensureSshTunnel(conn.ssh);
        }
        // Always ensure the API key is cached — the key may not have been
        // read yet if the app-launch auto-start failed silently (#212).
        if (!getRemoteAuthHeader().Authorization) {
          const key =
            conn.apiKey.trim() || (await sshReadRemoteApiKey(conn.ssh));
          setSshRemoteApiKey(key);
        }
      }

      // Abort only a prior run under the SAME runId (a re-send in the same
      // conversation). Sibling runs — other background sessions / agents —
      // keep streaming untouched.
      const existing = activeRuns.get(chatRunId);
      if (existing) existing();

      let fullResponse = "";
      const chatStartTime = Date.now();
      let resolveChat: (v: { response: string; sessionId?: string }) => void;
      let rejectChat: (reason?: unknown) => void;
      const promise = new Promise<{ response: string; sessionId?: string }>(
        (res, rej) => {
          resolveChat = res;
          rejectChat = rej;
        },
      );

      // Streaming sends to `event.sender` will throw "Object has been
      // destroyed" if the renderer WebContents goes away mid-response
      // (window closed, reloaded, navigated away). Guard every send so a
      // dead sender doesn't crash the IPC handler, and abort the in-flight
      // chat the first time we see one — there's nobody listening anymore.
      // Every event carries the runId as its first arg so the renderer can
      // route it to the right conversation among several running at once.
      const safeSend = (channel: string, payload: unknown): boolean => {
        if (event.sender.isDestroyed()) return false;
        try {
          event.sender.send(channel, chatRunId, payload);
          return true;
        } catch {
          return false;
        }
      };
      const abortThisRun = (): void => {
        activeRuns.get(chatRunId)?.();
      };

      const handle = await sendMessage(
        message,
        {
          onChunk: (chunk) => {
            fullResponse += chunk;
            if (!safeSend("chat-chunk", chunk)) {
              // Renderer is gone — stop generating and resolve with what we
              // have so the awaiting promise doesn't leak.
              abortThisRun();
            }
          },
          onReasoningChunk: (chunk) => {
            // Forward reasoning/thinking tokens on a dedicated channel so
            // the renderer can render the thinking bubble live during the
            // stream rather than waiting for a focus-change refresh (#352).
            // Same renderer-gone abort guard as the content channel.
            if (!safeSend("chat-reasoning-chunk", chunk)) {
              abortThisRun();
            }
          },
          onDone: (sessionId) => {
            activeRuns.delete(chatRunId);
            try {
              persistPromptImageAttachments(sessionId, message, attachments);
            } catch (err) {
              console.warn(
                "[sessions] Failed to persist prompt image attachments:",
                err,
              );
            }
            safeSend("chat-done", sessionId || "");
            resolveChat({ response: fullResponse, sessionId });
            // Desktop notification when window is not focused and response took >10s
            if (
              mainWindow &&
              !mainWindow.isFocused() &&
              Date.now() - chatStartTime > 10000
            ) {
              const preview = fullResponse
                .replace(/[#*_`~\n]+/g, " ")
                .trim()
                .slice(0, 80);
              new Notification({
                title: APP_NAME,
                body: preview || "Response ready",
              }).show();
            }
          },
          onSessionStarted: (sessionId) => {
            safeSend("chat-session-started", sessionId);
          },
          onError: (error) => {
            activeRuns.delete(chatRunId);
            safeSend("chat-error", error);
            rejectChat(new Error(error));
            // Notify on error too if window not focused
            if (mainWindow && !mainWindow.isFocused()) {
              new Notification({
                title: `${APP_NAME} — Error`,
                body: error.slice(0, 100),
              }).show();
            }
          },
          onToolProgress: (tool) => {
            safeSend("chat-tool-progress", tool);
          },
          onToolEvent: (toolEvent) => {
            safeSend("chat-tool-event", toolEvent);
          },
          onUsage: (usage) => {
            safeSend("chat-usage", usage);
          },
          onClarify: (req) => {
            safeSend("chat-clarify-request", req);
          },
        },
        profile,
        resumeSessionId,
        history,
        attachments,
        contextFolder,
        modelOverride,
      );

      activeRuns.set(chatRunId, handle.abort);
      return promise;
    },
  );

  ipcMain.handle("abort-chat", (_event, runId?: string) => {
    // Abort one run when given its id; with no id (legacy callers) abort all.
    if (runId) {
      activeRuns.get(runId)?.();
      activeRuns.delete(runId);
      return;
    }
    for (const abort of activeRuns.values()) abort();
    activeRuns.clear();
  });

  // Renderer's answer to an inline clarify card. Resolves the pending gateway
  // request for this request_id, which forwards the answer to `clarify.respond`.
  ipcMain.handle(
    "clarify-respond",
    (_event, payload: { requestId: string; answer: string }) => {
      return resolvePendingClarify(
        payload?.requestId ?? "",
        payload?.answer ?? "",
      );
    },
  );

  // Renderer-driven clipboard write (issue #298 — "Copy entire chat").
  // Routed through the main process so it doesn't depend on the renderer's
  // document being focused, which the navigator.clipboard API requires.
  ipcMain.handle("copy-to-clipboard", (_event, text: string) => {
    clipboard.writeText(typeof text === "string" ? text : "");
  });

  // Media — render agent-generated images and save them to disk (#299).
  ipcMain.handle("read-media-file", (_event, filePath: string) =>
    readMediaForCurrentConnection(filePath),
  );
  ipcMain.handle("save-media-file", async (event, src: string, name: string) =>
    saveMedia(
      await resolveMediaForSave(src),
      name,
      BrowserWindow.fromWebContents(event.sender),
    ),
  );
  ipcMain.handle("media-file-exists", (_event, filePath: string) =>
    mediaFileExistsForCurrentConnection(filePath),
  );

  // Native right-click menu for a rendered media element (#299): "Open"
  // hands the file to the OS default handler (or a web URL to the browser),
  // "Save as…" writes a copy elsewhere. Labels are passed in from the
  // renderer so the menu honours the active UI locale.
  ipcMain.on(
    "show-media-menu",
    (
      event,
      src: string,
      name: string,
      labels: { open: string; saveAs: string },
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || !src) return;
      const isUrl = /^https?:\/\//i.test(src);
      const isData = src.startsWith("data:");
      const template: Electron.MenuItemConstructorOptions[] = [];
      template.push({
        label: labels.open,
        click: () => {
          if (isUrl) {
            openExternalUrl(src);
            return;
          }

          const target = isData ? materializeDataUrlToTemp(src, name) : src;
          if (!target) return;
          shell.openPath(target).then((err) => {
            if (err) console.error("[media] open failed:", err);
          });
        },
      });
      template.push({
        label: labels.saveAs,
        click: () => {
          void saveMedia(src, name, win);
        },
      });
      Menu.buildFromTemplate(template).popup({ window: win });
    },
  );

  // Attachment staging — for pasted blobs that have no filesystem origin.
  ipcMain.handle(
    "stage-attachment",
    (_event, sessionId: string, filename: string, base64Bytes: string) => {
      return stageAttachment(sessionId, filename, base64Bytes);
    },
  );
  ipcMain.handle("clear-staged-attachments", (_event, sessionId: string) => {
    clearStagedAttachments(sessionId);
  });

  // Model discovery — fetch the provider's /v1/models for autocomplete.
  ipcMain.handle(
    "discover-provider-models",
    (
      _event,
      provider: string,
      baseUrl: string | undefined,
      apiKey: string | undefined,
      profile?: string,
    ) => {
      return discoverProviderModels(provider, baseUrl, apiKey, profile);
    },
  );

  // Authoritative context-window size for the active model (issue #597).
  // Resolves the real `context_length` from the provider's /models catalogue;
  // returns null when unavailable so the renderer falls back to its heuristic.
  ipcMain.handle(
    "get-model-context-window",
    (
      _event,
      provider: string,
      model: string,
      baseUrl: string | undefined,
      profile?: string,
    ) => {
      return getModelContextWindow(
        provider,
        model,
        baseUrl,
        undefined,
        profile,
      );
    },
  );

  // Gateway
  ipcMain.handle("start-gateway", async () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) {
      await sshStartGateway(conn.ssh);
      return { success: true, running: true };
    }
    if (conn.mode === "remote") {
      // The remote server runs its own gateway; nothing to start locally.
      // Without this guard we'd fall through to `startGateway()` and
      // spawn a non-existent local hermes-agent (issue #266).
      return {
        success: false,
        running: false,
        error:
          "Remote mode points at an already-running Hermes server. Start or restart the gateway on that remote host.",
      };
    }
    return startGatewayDetailed();
  });
  ipcMain.handle("stop-gateway", async () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) {
      await sshStopGateway(conn.ssh);
      return true;
    }
    if (conn.mode === "remote") {
      // No local gateway to stop in pure remote mode.
      return true;
    }
    // No profile argument → stops the active profile's gateway, leaving any
    // other profiles' gateways running.
    stopGateway(undefined, true);
    return true;
  });
  ipcMain.handle("restart-gateway", async (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) {
      await sshStopGateway(conn.ssh);
      await sshStartGateway(conn.ssh);
      return sshGatewayStatus(conn.ssh);
    }
    if (conn.mode === "remote") {
      return false;
    }
    return restartGateway(profile);
  });
  ipcMain.handle("gateway-status", () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshGatewayStatus(conn.ssh);
    return isGatewayRunning();
  });

  // Dashboard/WebSocket transport probe. This is intentionally separate from
  // the current chat path while we validate the ordered event stream.
  ipcMain.handle("dashboard-status", (_event, profile?: string) =>
    getDashboardStatus(profile),
  );
  ipcMain.handle("start-dashboard", (_event, profile?: string) =>
    startDashboard(profile),
  );
  ipcMain.handle("stop-dashboard", (_event, profile?: string) =>
    stopDashboard(profile),
  );

  // Platform toggles (config.yaml platforms section)
  ipcMain.handle("get-platform-enabled", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshGetPlatformEnabled(conn.ssh, profile);
    return getPlatformEnabled(profile);
  });
  ipcMain.handle(
    "set-platform-enabled",
    async (_event, platform: string, enabled: boolean, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        await sshSetPlatformEnabled(conn.ssh, platform, enabled, profile);
        return true;
      }
      setPlatformEnabled(platform, enabled, profile);
      // Restart gateway so it picks up the new platform config
      if (isGatewayRunning(profile)) {
        restartGateway(profile);
      }
      return true;
    },
  );

  ipcMain.handle(
    "get-messaging-platforms",
    async (_event, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "remote") {
        return fetchRemoteMessagingPlatforms();
      }
      if (conn.mode === "ssh" && conn.ssh) {
        const [envData, enabled, running, platformToolsets] = await Promise.all(
          [
            sshReadEnv(conn.ssh, profile),
            sshGetPlatformEnabled(conn.ssh, profile),
            sshGatewayStatus(conn.ssh),
            sshGetPlatformToolsets(conn.ssh, profile),
          ],
        );
        return buildDesktopMessagingPlatforms(
          envData,
          enabled,
          running,
          platformToolsets,
        );
      }
      const running = isGatewayRunning(profile);
      return buildDesktopMessagingPlatforms(
        readEnv(profile),
        getPlatformEnabled(profile),
        running,
        getPlatformToolsets(profile),
        readLocalGatewayPlatformStates(profile, running),
      );
    },
  );

  ipcMain.handle(
    "update-messaging-platform",
    async (_event, platform: string, update, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "remote") {
        return updateRemoteMessagingPlatform(platform, update);
      }
      if (conn.mode === "ssh" && conn.ssh) {
        await applyMessagingPlatformUpdate(
          platform,
          update,
          (key, value) => sshSetEnvValue(conn.ssh!, key, value, profile),
          (key, enabled) =>
            sshSetPlatformEnabled(conn.ssh!, key, enabled, profile),
          (platformKey, toolsetKey, enabled) =>
            sshSetMessagingPlatformToolsetEnabled(
              conn.ssh!,
              platformKey,
              toolsetKey,
              enabled,
              profile,
            ),
        );
        return { ok: true, platform };
      }
      await applyMessagingPlatformUpdate(
        platform,
        update,
        (key, value) => setEnvValue(key, value, profile),
        (key, enabled) => setPlatformEnabled(key, enabled, profile),
        (platformKey, toolsetKey, enabled) =>
          setMessagingPlatformToolsetEnabled(
            platformKey,
            toolsetKey,
            enabled,
            profile,
          ),
      );
      if (isGatewayRunning(profile)) {
        restartGateway(profile);
      }
      return { ok: true, platform };
    },
  );

  ipcMain.handle(
    "test-messaging-platform",
    async (_event, platform: string, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "remote") {
        return testRemoteMessagingPlatform(platform);
      }
      if (conn.mode === "ssh" && conn.ssh) {
        const [envData, enabled, running, platformToolsets] = await Promise.all(
          [
            sshReadEnv(conn.ssh, profile),
            sshGetPlatformEnabled(conn.ssh, profile),
            sshGatewayStatus(conn.ssh),
            sshGetPlatformToolsets(conn.ssh, profile),
          ],
        );
        return testDesktopMessagingPlatform(
          platform,
          buildDesktopMessagingPlatforms(
            envData,
            enabled,
            running,
            platformToolsets,
          ),
        );
      }
      const running = isGatewayRunning(profile);
      return testDesktopMessagingPlatform(
        platform,
        buildDesktopMessagingPlatforms(
          readEnv(profile),
          getPlatformEnabled(profile),
          running,
          getPlatformToolsets(profile),
          readLocalGatewayPlatformStates(profile, running),
        ),
      );
    },
  );

  // Sessions
  ipcMain.handle("list-sessions", (_event, limit?: number, offset?: number) => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote") return remoteListSessions(conn, limit, offset);
    if (conn.mode === "ssh" && conn.ssh)
      return withSshDashboardSessions(
        conn,
        (config) => remoteListSessions(config, limit, offset),
        () => sshListSessions(conn.ssh, limit, offset),
      );
    return listSessions(limit, offset);
  });

  ipcMain.handle("get-session-messages", (_event, sessionId: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote")
      return remoteGetSessionMessages(conn, sessionId).then((items) =>
        applySessionLocalOverlays(sessionId, items),
      );
    if (conn.mode === "ssh" && conn.ssh)
      return withSshDashboardSessions(
        conn,
        (config) =>
          remoteGetSessionMessages(config, sessionId).then((items) =>
            applySessionLocalOverlays(sessionId, items),
          ),
        () =>
          sshGetSessionMessages(conn.ssh, sessionId).then((items) =>
            applySessionLocalOverlays(sessionId, items),
          ),
      );
    return getSessionMessages(sessionId);
  });

  ipcMain.handle(
    "record-session-continuation",
    (_event, sessionId: string, items: DesktopSessionContinuationItem[]) => {
      persistSessionContinuation(sessionId, items);
      return true;
    },
  );

  ipcMain.handle(
    "record-session-local-error",
    (_event, sessionId: string, error: DesktopSessionLocalError) => {
      persistSessionLocalError(sessionId, error?.error, error?.userContent);
      return true;
    },
  );

  ipcMain.handle("delete-session", (_event, sessionId: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote") return remoteDeleteSession(conn, sessionId);
    if (conn.mode === "ssh" && conn.ssh)
      return withSshDashboardSessions(conn, (config) =>
        remoteDeleteSession(config, sessionId),
      );
    return deleteSession(sessionId);
  });

  ipcMain.handle("delete-sessions", (_event, sessionIds: string[]) => {
    const ids = Array.isArray(sessionIds) ? sessionIds : [];
    const conn = getConnectionConfig();
    if (conn.mode === "remote") return remoteDeleteSessions(conn, ids);
    if (conn.mode === "ssh" && conn.ssh)
      return withSshDashboardSessions(conn, (config) =>
        remoteDeleteSessions(config, ids),
      );
    return deleteSessions(ids);
  });

  // Profiles
  ipcMain.handle("list-profiles", async () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshListProfiles(conn.ssh);
    return listProfiles();
  });
  ipcMain.handle("create-profile", (_event, name: string, clone: boolean) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshCreateProfile(conn.ssh, name, clone);
    return createProfile(name, clone);
  });
  ipcMain.handle("delete-profile", (_event, name: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshDeleteProfile(conn.ssh, name);
    return deleteProfile(name);
  });
  ipcMain.handle("set-active-profile", (_event, name: string) => {
    if (getConnectionConfig().mode !== "ssh") {
      setActiveProfile(name);
      // The desktop now follows this profile: chat/health resolve their URL
      // from the active profile's own port. Drop the cached health flag so the
      // next check probes the new gateway rather than the previous profile's.
      notifyProfileSwitched();
      // Bring the activated profile's own gateway up if it isn't already —
      // without stopping any other profile's gateway (their bots stay online).
      if (!isRemoteMode() && !isGatewayRunning(name)) {
        startGateway(name);
      }
    }
    return true;
  });

  // Profile appearance (desktop-only avatar + accent colour). Local-only —
  // these write to the local ~/.hermes profile dirs, not the SSH remote.
  ipcMain.handle("set-profile-color", (_event, name: string, color: string) =>
    setProfileColor(name, color),
  );
  ipcMain.handle(
    "set-profile-avatar",
    (_event, name: string, dataUrl: string) => setProfileAvatar(name, dataUrl),
  );
  ipcMain.handle("remove-profile-avatar", (_event, name: string) =>
    removeProfileAvatar(name),
  );

  // Memory
  ipcMain.handle("read-memory", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshReadMemory(conn.ssh, profile);
    return readMemory(profile);
  });
  ipcMain.handle(
    "add-memory-entry",
    (_event, content: string, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshAddMemoryEntry(conn.ssh, content, profile);
      return addMemoryEntry(content, profile);
    },
  );
  ipcMain.handle(
    "update-memory-entry",
    (_event, index: number, content: string, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshUpdateMemoryEntry(conn.ssh, index, content, profile);
      return updateMemoryEntry(index, content, profile);
    },
  );
  ipcMain.handle(
    "remove-memory-entry",
    (_event, index: number, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshRemoveMemoryEntry(conn.ssh, index, profile);
      return removeMemoryEntry(index, profile);
    },
  );
  ipcMain.handle(
    "write-user-profile",
    (_event, content: string, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshWriteUserProfile(conn.ssh, content, profile);
      return writeUserProfile(content, profile);
    },
  );

  // Soul
  ipcMain.handle("read-soul", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshReadSoul(conn.ssh, profile);
    return readSoul(profile);
  });
  ipcMain.handle("write-soul", (_event, content: string, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshWriteSoul(conn.ssh, content, profile);
    return writeSoul(content, profile);
  });
  ipcMain.handle("reset-soul", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshResetSoul(conn.ssh, profile);
    return resetSoul(profile);
  });

  // Tools
  ipcMain.handle("get-toolsets", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshGetToolsets(conn.ssh, profile);
    return getToolsets(profile);
  });
  ipcMain.handle(
    "set-toolset-enabled",
    (_event, key: string, enabled: boolean, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshSetToolsetEnabled(conn.ssh, key, enabled, profile);
      return setToolsetEnabled(key, enabled, profile);
    },
  );

  // Skills
  ipcMain.handle("list-installed-skills", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshListInstalledSkills(conn.ssh, profile);
    return listInstalledSkills(profile);
  });
  ipcMain.handle("list-bundled-skills", () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshListBundledSkills(conn.ssh);
    return listBundledSkills();
  });
  ipcMain.handle("get-skill-content", (_event, skillPath: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshGetSkillContent(conn.ssh, skillPath);
    return getSkillContent(skillPath);
  });
  ipcMain.handle(
    "install-skill",
    (_event, identifier: string, _profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshInstallSkill(conn.ssh, identifier);
      return installSkill(identifier, _profile);
    },
  );
  ipcMain.handle(
    "uninstall-skill",
    (_event, name: string, _profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshUninstallSkill(conn.ssh, name);
      return uninstallSkill(name, _profile);
    },
  );

  // Session cache (fast local cache with generated titles)
  ipcMain.handle(
    "list-cached-sessions",
    (_event, limit?: number, offset?: number) => {
      const conn = getConnectionConfig();
      if (conn.mode === "remote")
        return remoteListCachedSessions(conn, limit, offset);
      if (conn.mode === "ssh" && conn.ssh)
        return withSshDashboardSessions(
          conn,
          (config) => remoteListCachedSessions(config, limit, offset),
          () => sshListCachedSessions(conn.ssh, limit, offset),
        );
      return listCachedSessions(limit, offset);
    },
  );
  ipcMain.handle("sync-session-cache", () => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote") return remoteListCachedSessions(conn, 50);
    if (conn.mode === "ssh" && conn.ssh)
      return withSshDashboardSessions(
        conn,
        (config) => remoteListCachedSessions(config, 50),
        () => sshListCachedSessions(conn.ssh, 50),
      );
    try {
      return syncSessionCache();
    } catch (error) {
      console.error("sync-session-cache failed; using local cache", error);
      return listCachedSessions(50);
    }
  });
  ipcMain.handle(
    "update-session-title",
    (_event, sessionId: string, title: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "remote")
        return remoteUpdateSessionTitle(conn, sessionId, title);
      if (conn.mode === "ssh" && conn.ssh)
        return withSshDashboardSessions(conn, (config) =>
          remoteUpdateSessionTitle(config, sessionId, title),
        );
      return updateSessionTitle(sessionId, title);
    },
  );

  // Session search
  ipcMain.handle("search-sessions", (_event, query: string, limit?: number) => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote") return remoteSearchSessions(conn, query, limit);
    if (conn.mode === "ssh" && conn.ssh)
      return withSshDashboardSessions(
        conn,
        (config) => remoteSearchSessions(config, query, limit),
        () => sshSearchSessions(conn.ssh, query, limit),
      );
    return searchSessions(query, limit);
  });

  // Credential Pool — profile-aware. When `profile` is omitted, the
  // credential pool helpers default to the currently active profile's
  // auth.json (see config.ts:authFilePath), so the renderer can pass an
  // explicit profile or rely on the active-profile fallback.
  ipcMain.handle("get-credential-pool", (_event, profile?: string) =>
    getCredentialPool(profile),
  );
  ipcMain.handle(
    "set-credential-pool",
    (
      _event,
      provider: string,
      entries: Array<Record<string, unknown>>,
      profile?: string,
    ) => {
      setCredentialPool(provider, entries, profile);
      return true;
    },
  );

  // Append a user-typed key as a properly-shaped credential pool
  // entry. Constructs the full upstream schema (id, label, auth_type,
  // priority, source, access_token, base_url, request_count) so the
  // engine's resolver can read it — issue #367 Bug 3.
  ipcMain.handle(
    "add-credential-pool-entry",
    (
      _event,
      provider: string,
      apiKey: string,
      label: string,
      profile?: string,
    ) => {
      return addCredentialPoolEntry(provider, apiKey, label, profile);
    },
  );

  // Models
  ipcMain.handle("list-models", () => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote") {
      if (conn.remoteChatTransport === "legacy") {
        throw new Error(
          "Remote model library reads require dashboard transport.",
        );
      }
      return remoteListModels(conn);
    }
    if (conn.mode === "ssh" && conn.ssh) {
      if (conn.sshChatTransport === "legacy") {
        return sshListModels(conn.ssh);
      }
      return withSshDashboardModelLibrary(
        conn,
        (config) => remoteListModels(config),
        () => sshListModels(conn.ssh!),
      );
    }
    return listModels();
  });
  ipcMain.handle(
    "add-model",
    async (
      _event,
      name: string,
      provider: string,
      model: string,
      baseUrl: string,
      contextLength?: number,
    ) => {
      const conn = getConnectionConfig();
      let addedModel: Awaited<ReturnType<typeof addModel>>;
      if (conn.mode === "remote") {
        if (conn.remoteChatTransport === "legacy") {
          throw new Error(
            "Remote model library writes require dashboard transport.",
          );
        }
        // Remote/SSH library writes don't carry the context-length override
        // yet (local-mode feature for now); the local branch persists it.
        addedModel = await remoteAddModel(conn, name, provider, model, baseUrl);
      } else if (conn.mode === "ssh" && conn.ssh) {
        addedModel = await withSshDashboardModelLibrary(
          conn,
          (config) => remoteAddModel(config, name, provider, model, baseUrl),
          () => sshAddModel(conn.ssh!, name, provider, model, baseUrl),
        );
      } else {
        addedModel = addModel(name, provider, model, baseUrl, contextLength);
      }
      notifyModelLibraryChanged();
      return addedModel;
    },
  );
  ipcMain.handle("remove-model", async (_event, id: string) => {
    const conn = getConnectionConfig();
    let removed: boolean;
    if (conn.mode === "remote") {
      if (conn.remoteChatTransport === "legacy") {
        throw new Error(
          "Remote model library writes require dashboard transport.",
        );
      }
      removed = await remoteRemoveModel(conn, id);
    } else if (conn.mode === "ssh" && conn.ssh) {
      removed = await withSshDashboardModelLibrary(
        conn,
        (config) => remoteRemoveModel(config, id),
        () => sshRemoveModel(conn.ssh!, id),
      );
    } else {
      removed = removeModel(id);
    }
    if (removed) notifyModelLibraryChanged();
    return removed;
  });
  ipcMain.handle(
    "update-model",
    async (
      _event,
      id: string,
      fields: Record<string, string>,
      // Context-length override travels as a separate arg (it's numeric, so it
      // can't ride inside the string-only `fields`). Local-mode only for now.
      contextLength?: number | null,
    ) => {
      const conn = getConnectionConfig();
      let updated: boolean;
      if (conn.mode === "remote") {
        if (conn.remoteChatTransport === "legacy") {
          throw new Error(
            "Remote model library writes require dashboard transport.",
          );
        }
        updated = await remoteUpdateModel(conn, id, fields);
      } else if (conn.mode === "ssh" && conn.ssh) {
        updated = await withSshDashboardModelLibrary(
          conn,
          (config) => remoteUpdateModel(config, id, fields),
          () => sshUpdateModel(conn.ssh!, id, fields),
        );
      } else {
        updated = updateModel(
          id,
          contextLength === undefined ? fields : { ...fields, contextLength },
        );
      }
      if (updated) notifyModelLibraryChanged();
      return updated;
    },
  );

  // Claw3D
  ipcMain.handle("claw3d-status", () => getClaw3dStatus());

  ipcMain.handle("claw3d-setup", async (event) => {
    try {
      await setupClaw3d((progress: Claw3dSetupProgress) => {
        event.sender.send("claw3d-setup-progress", progress);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle("claw3d-get-port", () => getClaw3dPort());
  ipcMain.handle("claw3d-set-port", (_event, port: number) => {
    setClaw3dPort(port);
    return true;
  });
  ipcMain.handle("claw3d-get-ws-url", () => getClaw3dWsUrl());
  ipcMain.handle("claw3d-set-ws-url", (_event, url: string) => {
    setClaw3dWsUrl(url);
    return true;
  });

  ipcMain.handle("claw3d-start-all", (_event, profile?: string) =>
    startOfficeStack(profile, {
      getConnectionConfig,
      isGatewayRunning,
      startGateway,
      sshGatewayStatus,
      sshStartGateway,
      startSshTunnel,
      stopSshTunnel,
      sshReadRemoteApiKey,
      setSshRemoteApiKey,
      startClaw3dAll,
      stopClaw3dAll: stopClaw3d,
      waitForClaw3dReady,
    }),
  );
  ipcMain.handle("claw3d-stop-all", () => {
    stopClaw3d();
    return true;
  });
  ipcMain.handle("claw3d-get-logs", () => getClaw3dLogs());

  ipcMain.handle("claw3d-start-dev", () => startDevServer());
  ipcMain.handle("claw3d-stop-dev", () => {
    stopDevServer();
    return true;
  });
  ipcMain.handle("claw3d-start-adapter", () => startAdapter());
  ipcMain.handle("claw3d-stop-adapter", () => {
    stopAdapter();
    return true;
  });

  // Cron Jobs
  ipcMain.handle(
    "list-cron-jobs",
    (_event, includeDisabled?: boolean, profile?: string) =>
      listCronJobs(includeDisabled, profile),
  );
  ipcMain.handle(
    "create-cron-job",
    (
      _event,
      schedule: string,
      prompt?: string,
      name?: string,
      deliver?: string,
      profile?: string,
    ) => createCronJob(schedule, prompt, name, deliver, profile),
  );
  ipcMain.handle("remove-cron-job", (_event, jobId: string, profile?: string) =>
    removeCronJob(jobId, profile),
  );
  ipcMain.handle("pause-cron-job", (_event, jobId: string, profile?: string) =>
    pauseCronJob(jobId, profile),
  );
  ipcMain.handle("resume-cron-job", (_event, jobId: string, profile?: string) =>
    resumeCronJob(jobId, profile),
  );
  ipcMain.handle(
    "trigger-cron-job",
    (_event, jobId: string, profile?: string) => triggerCronJob(jobId, profile),
  );

  // Kanban
  ipcMain.handle(
    "kanban-list-boards",
    (_event, includeArchived?: boolean, profile?: string) =>
      kanbanListBoards(includeArchived, profile),
  );
  ipcMain.handle("kanban-current-board", (_event, profile?: string) =>
    kanbanCurrentBoard(profile),
  );
  ipcMain.handle(
    "kanban-switch-board",
    (_event, slug: string, profile?: string) =>
      kanbanSwitchBoard(slug, profile),
  );
  ipcMain.handle(
    "kanban-create-board",
    (
      _event,
      slug: string,
      name?: string,
      switchAfter?: boolean,
      profile?: string,
    ) => kanbanCreateBoard(slug, name, switchAfter, profile),
  );
  ipcMain.handle(
    "kanban-remove-board",
    (_event, slug: string, hardDelete?: boolean, profile?: string) =>
      kanbanRemoveBoard(slug, hardDelete, profile),
  );
  ipcMain.handle(
    "kanban-list-tasks",
    (
      _event,
      filters?: {
        status?: string;
        assignee?: string;
        tenant?: string;
        includeArchived?: boolean;
        profile?: string;
      },
    ) => kanbanListTasks(filters || {}),
  );
  ipcMain.handle(
    "kanban-get-task",
    (_event, taskId: string, profile?: string) =>
      kanbanGetTask(taskId, profile),
  );
  ipcMain.handle(
    "kanban-create-task",
    (_event, input: CreateTaskInput, profile?: string) =>
      kanbanCreateTask(input, profile),
  );
  ipcMain.handle("select-folder", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ["openDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Read directory contents for worktree panel
  ipcMain.handle(
    "read-directory",
    async (
      _event,
      dirPath: string,
    ): Promise<{ name: string; isDirectory: boolean }[] | null> => {
      try {
        const entries = await readdir(dirPath, { withFileTypes: true });
        return entries.map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
        }));
      } catch {
        return null;
      }
    },
  );

  // Read file contents for file viewer
  ipcMain.handle(
    "read-file",
    async (
      _event,
      filePath: string,
      maxBytes?: number,
    ): Promise<{ content: string; truncated: boolean } | null> => {
      try {
        const limit = maxBytes ?? 102400; // Default 100KB
        const buffer = await readFile(filePath);
        const truncated = buffer.byteLength > limit;
        const content = truncated
          ? buffer.subarray(0, limit).toString("utf-8")
          : buffer.toString("utf-8");
        return { content, truncated };
      } catch {
        return null;
      }
    },
  );

  // Open file in default application
  ipcMain.handle("open-file-in-editor", async (_event, filePath: string) => {
    try {
      await shell.openPath(filePath);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("open-terminal", async (_event, dirPath: string) => {
    if (isRemoteOnlyMode()) return false;
    if (typeof dirPath !== "string" || dirPath.trim().length === 0)
      return false;
    try {
      const info = await stat(dirPath);
      if (!info.isDirectory()) return false;
      return await openTerminalInDirectory(dirPath);
    } catch {
      return false;
    }
  });

  // Read image file as data URL for preview
  ipcMain.handle(
    "read-image-file",
    async (_event, filePath: string): Promise<string | null> => {
      try {
        const buffer = await readFile(filePath);
        const ext = extname(filePath).toLowerCase().slice(1);
        const mimeType =
          ext === "png"
            ? "image/png"
            : ext === "jpg" || ext === "jpeg"
              ? "image/jpeg"
              : ext === "gif"
                ? "image/gif"
                : ext === "webp"
                  ? "image/webp"
                  : ext === "svg"
                    ? "image/svg+xml"
                    : ext === "bmp"
                      ? "image/bmp"
                      : ext === "ico"
                        ? "image/x-icon"
                        : "application/octet-stream";
        const base64 = buffer.toString("base64");
        return `data:${mimeType};base64,${base64}`;
      } catch {
        return null;
      }
    },
  );
  ipcMain.handle(
    "kanban-assign-task",
    (_event, taskId: string, assignee: string | null, profile?: string) =>
      kanbanAssignTask(taskId, assignee, profile),
  );
  ipcMain.handle(
    "kanban-complete-task",
    (_event, taskId: string, result?: string, profile?: string) =>
      kanbanCompleteTask(taskId, result, profile),
  );
  ipcMain.handle(
    "kanban-block-task",
    (_event, taskId: string, reason?: string, profile?: string) =>
      kanbanBlockTask(taskId, reason, profile),
  );
  ipcMain.handle(
    "kanban-unblock-task",
    (_event, taskId: string, profile?: string) =>
      kanbanUnblockTask(taskId, profile),
  );
  ipcMain.handle(
    "kanban-archive-task",
    (_event, taskId: string, profile?: string) =>
      kanbanArchiveTask(taskId, profile),
  );
  ipcMain.handle(
    "kanban-specify-task",
    (_event, taskId: string, profile?: string) =>
      kanbanSpecifyTask(taskId, profile),
  );
  ipcMain.handle(
    "kanban-reclaim-task",
    (_event, taskId: string, reason?: string, profile?: string) =>
      kanbanReclaimTask(taskId, reason, profile),
  );
  ipcMain.handle(
    "kanban-comment-task",
    (_event, taskId: string, body: string, profile?: string) =>
      kanbanCommentTask(taskId, body, profile),
  );
  ipcMain.handle(
    "kanban-dispatch-once",
    (_event, dryRun?: boolean, profile?: string) =>
      kanbanDispatchOnce(dryRun, profile),
  );
  ipcMain.handle("kanban-list-claw3d-hq-tasks", () =>
    kanbanListClaw3dHqTasks(),
  );

  // Shell
  ipcMain.handle("open-external", (_event, url: string) => {
    openExternalUrl(url);
  });

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
  ipcMain.handle(
    "add-mcp-server",
    (_event, input: McpServerInput, profile?: string) =>
      addMcpServer(input, profile),
  );
  ipcMain.handle(
    "remove-mcp-server",
    (_event, name: string, profile?: string) => removeMcpServer(name, profile),
  );
  ipcMain.handle(
    "set-mcp-server-enabled",
    (_event, name: string, enabled: boolean, profile?: string) =>
      setMcpServerEnabled(name, enabled, profile),
  );
  ipcMain.handle("test-mcp-server", (_event, name: string, profile?: string) =>
    testMcpServer(name, profile),
  );
  ipcMain.handle("list-mcp-catalog", (_event, profile?: string) =>
    listMcpCatalog(profile),
  );
  ipcMain.handle(
    "install-mcp-catalog-entry",
    (_event, name: string, env?: Record<string, string>, profile?: string) =>
      installMcpCatalogEntry(name, env, profile),
  );

  // Discover marketplace (community registry)
  ipcMain.handle("registry-fetch", (_event, force?: boolean) =>
    fetchRegistry(!!force),
  );
  ipcMain.handle("registry-fetch-models", (_event, force?: boolean) =>
    fetchModelRegistry(!!force),
  );
  ipcMain.handle("registry-list-installed", (_event, profile?: string) =>
    listInstalledRegistry(profile),
  );
  ipcMain.handle(
    "registry-detail",
    (_event, kind: RegistryKind, item: RegistryItem) =>
      fetchRegistryDetail(kind, item),
  );
  ipcMain.handle(
    "registry-install",
    (_event, kind: RegistryKind, item: RegistryItem, profile?: string) =>
      installRegistryItem(kind, item, profile),
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
}

function buildMenu(): void {
  const isMac = process.platform === "darwin";

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "Chat",
      submenu: [
        {
          label: "New Chat",
          accelerator: "CmdOrCtrl+N",
          click: (): void => {
            mainWindow?.webContents.send("menu-new-chat");
          },
        },
        { type: "separator" },
        {
          label: "Search Sessions",
          accelerator: "CmdOrCtrl+K",
          click: (): void => {
            mainWindow?.webContents.send("menu-search-sessions");
          },
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(is.dev
          ? [
              { type: "separator" as const },
              { role: "reload" as const },
              { role: "toggleDevTools" as const },
            ]
          : []),
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [{ type: "separator" as const }, { role: "front" as const }]
          : [{ role: "close" as const }]),
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Hermes Agent on GitHub",
          click: (): void => {
            openExternalUrl("https://github.com/NousResearch/hermes-agent/");
          },
        },
        {
          label: "Report an Issue",
          click: (): void => {
            openExternalUrl("https://github.com/fathah/hermes-desktop/issues");
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function setupUpdater(): void {
  // IPC handlers must always be registered to avoid invoke errors
  ipcMain.handle("get-app-version", () => app.getVersion());

  // Portable Windows builds set PORTABLE_EXECUTABLE_DIR. They have no
  // install location for electron-updater to replace in place, so an
  // update check just fails and surfaces a spurious "Update failed".
  // Skip the updater for them (users update by downloading a new
  // portable .exe), same as dev mode.
  const isPortableBuild = !!process.env.PORTABLE_EXECUTABLE_DIR;

  if (!app.isPackaged || isPortableBuild) {
    // Skip auto-update in dev mode and portable builds
    ipcMain.handle("check-for-updates", async () => null);
    ipcMain.handle("download-update", () => true);
    ipcMain.handle("install-update", () => {});
    return;
  }

  // Dynamic import to avoid electron-updater issues in dev mode
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require("electron-updater") as {
    autoUpdater: AppUpdater;
  };

  // Log the updater's own lifecycle to <userData>/logs/updater.log so a
  // failed update (e.g. issue #271) leaves something to diagnose.
  autoUpdater.logger = updaterLogger;
  // Auto-download as soon as an update is found, then surface a single
  // "Restart to Update" action once it's ready — no manual download step.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    mainWindow?.webContents.send("update-available", {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    mainWindow?.webContents.send("update-download-progress", {
      percent: Math.round(progress.percent),
    });
  });

  autoUpdater.on("update-downloaded", () => {
    mainWindow?.webContents.send("update-downloaded");
  });

  autoUpdater.on("error", (err) => {
    mainWindow?.webContents.send("update-error", err.message);
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
      mainWindow?.webContents.send("update-error", message);
      return false;
    }
  });

  ipcMain.handle("install-update", () => {
    // Bracket the suspect call: if the log shows this line but the app
    // never relaunches, the failure is in quitAndInstall / the installer.
    updaterLogger.info(
      "Restart requested by user — calling quitAndInstall(isSilent=false, isForceRunAfter=true)",
    );
    autoUpdater.quitAndInstall(false, true);
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);
}

// Opt-in Chrome DevTools Protocol port for E2E testing. Set
// ENABLE_CDP=1 (with optional CDP_PORT, default 9222) before launching
// `npm run dev` to expose the renderer for Playwright (or any CDP
// client) to attach and drive the UI without going through
// screenshots / OCR. Off by default — no effect on normal dev or
// production builds. See `scripts/README.md` for the harness workflow.
if (process.env.ENABLE_CDP === "1") {
  app.commandLine.appendSwitch(
    "remote-debugging-port",
    process.env.CDP_PORT || "9222",
  );
}

app.whenReady().then(() => {
  app.setName(APP_NAME);
  electronApp.setAppUserModelId("com.nousresearch.hermes");
  cleanupTempMediaFiles();

  // Allow microphone access for the app's own renderer (voice input). Without
  // a handler Electron denies getUserMedia by default. Scoped to the `media`
  // permission only; everything else stays denied.
  session.defaultSession.setPermissionRequestHandler(
    (_wc, permission, callback) => {
      callback(permission === "media");
    },
  );
  session.defaultSession.setPermissionCheckHandler(
    (_wc, permission) => permission === "media",
  );

  // In production, inject PostHog domains into the CSP response header.
  // Skipped in dev — Vite manages its own CSP headers with nonces for
  // Fast Refresh inline scripts; overriding them breaks the dev server.
  if (!is.dev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const csp =
        "default-src 'self'; " +
        "script-src 'self' 'wasm-unsafe-eval' https://*.posthog.com https://*.i.posthog.com; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; " +
        "connect-src 'self' blob: https://*.posthog.com https://*.i.posthog.com; " +
        "media-src 'self' blob:";
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [csp],
        },
      });
    });
  }

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() === "webview") {
      // The web preview webview is the only one allowed to load remote HTTPS.
      // Identify it reliably by its session: a <webview partition="web-preview">
      // shares the singleton in-memory session returned by fromPartition().
      const isWebPreview =
        contents.session === session.fromPartition("web-preview");
      hardenAttachedWebContents(contents, isWebPreview);
    }
  });

  buildMenu();
  setupIPC();
  createWindow();
  setupUpdater();

  // Auto-start SSH tunnel if configured
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh.host) {
    (async () => {
      if (!(await sshGatewayStatus(conn.ssh))) {
        await sshStartGateway(conn.ssh);
      }
      await ensureSshTunnel(conn.ssh);
      const key = conn.apiKey.trim() || (await sshReadRemoteApiKey(conn.ssh));
      setSshRemoteApiKey(key);
    })().catch((err) => {
      console.error("[SSH TUNNEL] Failed to start on launch:", err);
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    // Intentionally do NOT stop the gateway on exit: profile gateways are
    // detached and meant to keep running headless (e.g. Telegram/Discord bots
    // stay online after the desktop closes). The user stops a gateway
    // explicitly via the Gateway controls.
    stopAllDashboards();
    stopSshTunnel();
    stopClaw3d();
    closeDbConnection();
    app.quit();
  }
});

app.on("before-quit", () => {
  cleanupTempMediaFiles();
  stopHealthPolling();
  for (const abort of activeRuns.values()) abort();
  activeRuns.clear();
  // Leave profile gateways running on quit (see window-all-closed) so bots
  // and other platforms stay online headless.
  stopAllDashboards();
  stopSshTunnel();
  stopClaw3d();
  closeDbConnection();
});
