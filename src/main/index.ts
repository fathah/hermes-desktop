import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  dialog,
  clipboard,
  protocol,
  net,
} from "electron";
import { join, extname } from "path";
import { pathToFileURL } from "url";
import { readdir, readFile } from "fs/promises";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import type { AppUpdater } from "electron-updater";
import icon from "../../resources/icon.png?asset";
import type { Attachment } from "../shared/attachments";
import { stageAttachment, clearStagedAttachments } from "./attachment-staging";
import {
  spsUnfurl,
  spsAssistant,
  spsIngestInbox,
  spsLoad,
  spsSave,
  spsBackupWorkspace,
  type PageContext as SpsPageContext,
} from "./sps-agent";
import { spsGetWorkSession, spsSetWorkSession } from "./sps-work-sessions";
import { listBaskets, saveBasket, deleteBasket } from "./equity-baskets";
import {
  listAlerts,
  markAlertRead,
  startEquityAlertWatcher,
} from "./equity-alerts";
import {
  oaSearchWorks,
  oaGetWork,
  getResearchConfig,
  getPublicResearchConfig,
  setResearchConfig,
} from "./openalex";
import type { SearchOpts } from "../shared/openalex/core";

/**
 * Register the bundled OpenAlex MCP server in the active profile's config.yaml
 * so the Hermes agent can call it from chat ("find me papers on X"). Idempotent
 * and non-clobbering: if an `openalex` entry already exists (even one the user
 * disabled) it is left alone. No-op when the bundle is missing (build:mcp hasn't
 * run yet). The gateway picks the entry up on its next restart.
 */
function ensureResearchMcpRegistered(profile?: string): {
  registered: boolean;
  alreadyPresent: boolean;
} {
  const name = "openalex";
  if (hasMcpServer(name, profile)) {
    return { registered: true, alreadyPresent: true };
  }
  const serverPath = openAlexMcpServerPath();
  if (!existsSync(serverPath)) {
    return { registered: false, alreadyPresent: false };
  }
  const { mailto, apiKey } = getResearchConfig();
  const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: "1" };
  if (mailto) env.HERMES_OPENALEX_MAILTO = mailto;
  if (apiKey) env.HERMES_OPENALEX_API_KEY = apiKey;
  writeMcpServerEntry(
    name,
    { command: process.execPath, args: [serverPath], env, enabled: true },
    profile,
  );
  return { registered: true, alreadyPresent: false };
}
import {
  exportPageMarkdownTo,
  exportRowMarkdownTo,
  readRowMarkdownFrom,
  deletePageIn,
  deleteRowIn,
  deleteDbFolderIn,
  readVaultPages,
  readVaultManifest,
  writeVaultManifest,
  writeAssetTo,
  readAssetFrom,
} from "./sps-vault";
import {
  writeAsset,
  assetExists,
  resolveAssetPath,
  gcAssets,
} from "./sps-assets";
import { discoverProviderModels } from "./model-discovery";
import { readMediaAsDataUrl, saveMedia, mediaFileExists } from "./media";
import { getVoiceStatus, transcribeAudio, speakText } from "./voice";
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
  checkHermesUpdate,
  checkOpenClawExists,
  runClawMigrate,
  runHermesBackup,
  runHermesImport,
  runHermesDump,
  listMcpServers,
  hasMcpServer,
  writeMcpServerEntry,
  openAlexMcpServerPath,
  discoverMemoryProviders,
  readLogs,
  InstallProgress,
  HERMES_HOME,
} from "./installer";
import { updaterLogger } from "./updater-log";
import {
  runHermesAuthLogin,
  cancelHermesAuthLogin,
  accumulateOAuthPromptAction,
} from "./hermes-auth";
import {
  isRemoteMode,
  isRemoteOnlyMode,
  sendMessage,
  startGateway,
  stopGateway,
  isGatewayRunning,
  testRemoteConnection,
  stopHealthPolling,
  restartGateway,
  notifyProfileSwitched,
  ensureSshTunnelIfNeeded,
  setSshRemoteApiKey,
  getRemoteAuthHeader,
  respondRunApproval,
} from "./hermes";
import {
  startSshTunnel,
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
  resolveConnectionApiKeyUpdate,
  setConnectionConfig,
  getPlatformEnabled,
  setPlatformEnabled,
  getApiServerKey,
  getAutoApprove,
  setAutoApprove,
  getCompletionSound,
  setCompletionSound,
  readDesktopConfig,
  writeDesktopConfig,
  type SshConnectionConfig,
} from "./config";
import { canAutoApprove } from "./autonomy";
import {
  listSessions,
  getSessionMessages,
  searchSessions,
  deleteSession,
} from "./sessions";
import {
  getSpsNoteIndex,
  closeAllNoteIndexes,
  type NoteQuery,
} from "./note-index";
import {
  resolveSpsVaultDir,
  getVaultLocation,
  setVaultLocation,
  resetVaultLocation,
} from "./sps-storage";
import { extractPdfToMarkdown } from "./pdf-extract";
import {
  appendObsidianFile,
  buildObsidianOpenUri,
  callObsidianFunction,
  getObsidianConfig,
  getObsidianTree,
  isAllowedObsidianExternalUrl,
  readObsidianFile,
  searchObsidian,
  setObsidianConfig,
  watchObsidian,
  writeObsidianFile,
  type ObsidianConfigInput,
  type ObsidianFunctionName,
} from "./obsidian";
import {
  syncSessionCache,
  listCachedSessions,
  updateSessionTitle,
} from "./session-cache";
import {
  recordUsage,
  getUsageStats,
  readUsageRecords,
  sessionLedger,
} from "./usage-store";
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
  readMemory,
  addMemoryEntry,
  updateMemoryEntry,
  removeMemoryEntry,
  writeUserProfile,
  writeMemory,
} from "./memory";
import {
  readFocus,
  writeFocus,
  getDailyContextHookStatus,
  setDailyContextHookEnabled,
} from "./personalization";
import { getMemoryTimeline } from "./memory-timeline";
import { summarizeSearch } from "./session-summary";
import { listSkins } from "./skins";
import { readSoul, writeSoul, resetSoul } from "./soul";
import { getToolsets, setToolsetEnabled } from "./tools";
import {
  listInstalledSkills,
  listBundledSkills,
  getSkillContent,
  installSkill,
  uninstallSkill,
  searchSkills,
  createSkill,
  writeSkillContent,
  listDisabledSkills,
  setSkillEnabled,
  discoverLocalSkills,
  importLocalSkill,
  generateSkillFromRepo,
  type CreateSkillInput,
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
  sshSetToolsetEnabled,
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

process.on("uncaughtException", (err) => {
  console.error("[MAIN UNCAUGHT]", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[MAIN UNHANDLED REJECTION]", reason);
});

let mainWindow: BrowserWindow | null = null;
const activeChatAborts = new Map<string, () => void>();
let obsidianWatcher: Awaited<ReturnType<typeof watchObsidian>> | null = null;
let obsidianWatcherProfile = "";

function openExternalUrl(rawUrl: unknown): void {
  if (!isAllowedExternalUrl(rawUrl) && !isAllowedObsidianExternalUrl(rawUrl)) {
    console.warn("[SECURITY] Blocked unsafe external URL");
    return;
  }

  shell.openExternal(rawUrl).catch((err) => {
    console.error("[SECURITY] Failed to open external URL:", err);
  });
}

// The SPS asset store streams journal/editor media (photos, voice, video,
// files) from the vault over a custom scheme instead of inlining base64. It
// must be registered as privileged BEFORE app `ready`, and listed in the
// renderer CSP (img-src/media-src) — see src/renderer/index.html.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "sps-asset",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true, // range requests → video/audio seeking
    },
  },
]);

/** Absolute path to the active (or named) profile's SPS vault directory.
 *  Honors a shared-directory override (e.g. an Obsidian vault) via sps-storage. */
function spsVaultDirFor(profile?: string): string {
  return resolveSpsVaultDir(profile);
}

function createWindow(): void {
  const rendererHtmlPath = join(__dirname, "../renderer/index.html");

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 850,
    minWidth: 900,
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
    // Watch the equity alert log → OS notification + renderer event per new line.
    void startEquityAlertWatcher(() => mainWindow);
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

  // Mic access for in-app voice notes. Grant `media` ONLY to the app renderer
  // (file:// or the dev server); attached webviews must never gain mic/camera.
  // All other permissions keep their prior (handler-less) allow behavior.
  mainWindow.webContents.session.setPermissionRequestHandler(
    (wc, permission, callback) => {
      const url = wc?.getURL?.() ?? "";
      const devUrl = is.dev ? process.env["ELECTRON_RENDERER_URL"] : undefined;
      const isAppRenderer =
        url.startsWith("file://") || (!!devUrl && url.startsWith(devUrl));
      if (permission === "media") return callback(isAppRenderer);
      return callback(true);
    },
  );

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

  // Microphone access for push-to-talk voice input (WS4). Grant audio-only
  // `media`; deny camera and every other permission. getUserMedia still shows
  // the OS-level mic prompt, so the user explicitly consents at capture time.
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_wc, permission, callback, details) => {
      if (permission === "media") {
        const mediaTypes =
          (details as { mediaTypes?: string[] }).mediaTypes ?? [];
        callback(!mediaTypes.includes("video"));
        return;
      }
      callback(false);
    },
  );

  mainWindow.webContents.on(
    "will-attach-webview",
    (event, webPreferences, params) => {
      if (!isAllowedWebviewUrl(params.src)) {
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
  function requireLocalWorkspace(): void {
    const conn = getConnectionConfig();
    if (conn.mode !== "local") {
      throw new Error(
        "Workspace files are only available in local mode in this version.",
      );
    }
  }

  async function ensureObsidianWatcher(profile?: string): Promise<void> {
    const profileKey = profile || "";
    if (obsidianWatcher && obsidianWatcherProfile === profileKey) return;
    if (obsidianWatcher) {
      await obsidianWatcher.close();
      obsidianWatcher = null;
    }
    obsidianWatcherProfile = profileKey;
    obsidianWatcher = await watchObsidian(profile, (payload) => {
      mainWindow?.webContents.send("obsidian-file-changed", payload);
    });
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
        event.sender.send("install-progress", {
          step: 1,
          totalSteps: 1,
          title: "Updating remote Hermes Agent",
          detail: "Running hermes update over SSH...",
          log: "Running hermes update over SSH...\n",
        });
        await sshRunUpdate(conn.ssh);
        await sshStartGateway(conn.ssh);
        await startSshTunnel(conn.ssh);
        const key = await sshReadRemoteApiKey(conn.ssh);
        setSshRemoteApiKey(key);
        return { success: true };
      }
      await runHermesUpdate((progress: InstallProgress) => {
        event.sender.send("install-progress", progress);
      });
      // The local gateway is a long-lived subprocess running the now-stale
      // code; restart it so the freshly-pulled runtime takes effect. Only
      // when one is actually running (restartGateway self-gates on remote
      // mode) — don't spawn a gateway the user had stopped.
      if (isGatewayRunning()) {
        restartGateway();
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Detect whether the locally-checked-out Hermes runtime is behind upstream
  // (WS3). Skipped in remote/SSH mode — there the local repo isn't the one
  // serving the gateway, so a local git compare would be misleading.
  ipcMain.handle("check-hermes-update", async () => {
    if (isRemoteMode()) return { available: false, reason: "remote-mode" };
    try {
      return await checkHermesUpdate();
    } catch (err) {
      return { available: false, reason: (err as Error).message };
    }
  });

  // Voice I/O (WS4) — speech-to-text and text-to-speech via OpenAI, keyed by
  // the profile's VOICE_TOOLS_OPENAI_KEY (read in main; never sent to renderer).
  ipcMain.handle("get-voice-status", (_event, profile?: string) =>
    getVoiceStatus(profile),
  );
  ipcMain.handle(
    "transcribe-audio",
    (_event, audio: ArrayBuffer, mime: string, profile?: string) =>
      transcribeAudio(audio, mime, profile),
  );
  ipcMain.handle(
    "speak-text",
    (_event, text: string, voice: string | undefined, profile?: string) =>
      speakText(text, voice, profile),
  );

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
    // Some providers print the authorization URL instead of opening it.
    // Watch the accumulated stream once, then open the first safe prompt.
    const promptState = { buffer: "", handled: false };
    return runHermesAuthLogin(
      provider,
      (chunk) => {
        // The user can close the modal mid-flow before cancelHermesAuthLogin
        // tears down the subprocess; any send on a destroyed sender throws.
        if (event.sender.isDestroyed()) return;
        event.sender.send("oauth-login-progress", chunk);
        const action = accumulateOAuthPromptAction(promptState, chunk);
        if (action?.kind === "device-code") {
          openExternalUrl(action.url);
          clipboard.writeText(action.code);
          event.sender.send(
            "oauth-login-progress",
            `\n→ Code ${action.code} copied to clipboard — opening browser...\n`,
          );
        } else if (action?.kind === "auth-url") {
          openExternalUrl(action.url);
          event.sender.send(
            "oauth-login-progress",
            "\n→ Opening browser for sign-in...\n",
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

  registerDualHandler("get-config", getConfigValue, sshGetConfigValue);

  registerDualHandler(
    "set-config",
    async (key: string, value: string, profile?: string) => {
      setConfigValue(key, value, profile);
      return true;
    },
    async (ssh, key: string, value: string, profile?: string) => {
      await sshSetConfigValue(ssh, key, value, profile);
      return true;
    },
  );

  registerDualHandler("get-hermes-home", getHermesHome, sshGetHermesHome);

  registerDualHandler("get-model-config", getModelConfig, sshGetModelConfig);

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
      if (conn.mode === "ssh" && conn.ssh) {
        const prev = await sshGetModelConfig(conn.ssh, profile);
        await sshSetModelConfig(conn.ssh, provider, model, baseUrl, profile);
        if (
          (await sshGatewayStatus(conn.ssh)) &&
          (prev.provider !== provider ||
            prev.model !== model ||
            prev.baseUrl !== baseUrl)
        ) {
          await sshStopGateway(conn.ssh);
          await sshStartGateway(conn.ssh);
        }
        return true;
      }
      const prev = getModelConfig(profile);
      setModelConfig(provider, model, baseUrl, profile);

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

  // API_SERVER_KEY management — lets the renderer detect a missing key and
  // generate one with a button click (local mode) or show instructions (remote/SSH).
  ipcMain.handle("get-api-server-key-status", (_event, profile?: string) => {
    const key = getApiServerKey(profile);
    return { hasKey: key.length > 0 };
  });

  ipcMain.handle(
    "generate-api-server-key",
    async (_event, profile?: string) => {
      const { randomUUID } = await import("crypto");
      const key = `desk-${randomUUID()}`;
      
      // Store in desktop.json (encrypted using OS-level secure storage)
      const data = readDesktopConfig();
      data.apiServerKey = key;
      writeDesktopConfig(data);

      // Remove any plaintext key from .env to prevent leaks and ensure the desktop.json key takes precedence
      setEnvValue("API_SERVER_KEY", "", profile);
      if (profile && profile !== "default") {
        setEnvValue("API_SERVER_KEY", "");
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

  // Usage / cost analytics (idea A2). Aggregates the desktop-owned usage store
  // for the active (or given) profile. Read-only — never touches the gateway.
  ipcMain.handle("get-usage-stats", (_event, profile?: string) =>
    getUsageStats({ profile }),
  );

  // Run ledger (per-session cost rollup) — a read view over the same desktop
  // usage JSONL, joined to session titles from the gateway's session store.
  // Titles degrade to null when the session db isn't reachable (e.g. remote).
  ipcMain.handle("get-run-ledger", (_event, profile?: string) => {
    const rows = sessionLedger(readUsageRecords({ profile }));
    const titles = new Map<string, string | null>();
    try {
      for (const s of listSessions(1000, 0)) titles.set(s.id, s.title);
    } catch {
      // no session db (remote/ssh, or not yet created) — leave titles empty
    }
    return rows.map((r) => ({ ...r, title: titles.get(r.sessionId) ?? null }));
  });

  // Session-search summarization (idea A5): synthesize a cited summary of the
  // FTS hits for a query via one non-streaming gateway completion.
  ipcMain.handle(
    "summarize-search",
    (_event, query: string, profile?: string) =>
      summarizeSearch(query, profile),
  );

  // Skin engine (idea A6): list validated skins (+ their CSS-var maps) for a
  // profile so the renderer can apply one at the app root.
  ipcMain.handle("list-skins", (_event, profile?: string) =>
    listSkins(profile),
  );

  // Command-approval reply (idea B1): resolve a pending run approval via the
  // gateway's /v1/runs/{id}/approval endpoint.
  ipcMain.handle(
    "respond-approval",
    (
      _event,
      runId: string,
      choice: "once" | "session" | "always" | "deny",
      profile?: string,
    ) => respondRunApproval(runId, choice, profile),
  );

  // Desktop automation prefs (M2): scoped auto-approve (per-profile) + chime.
  ipcMain.handle("get-auto-approve", (_event, profile?: string) =>
    getAutoApprove(profile),
  );
  ipcMain.handle(
    "set-auto-approve",
    (_event, enabled: boolean, profile?: string) =>
      setAutoApprove(enabled, profile),
  );
  ipcMain.handle("get-completion-sound", () => getCompletionSound());
  ipcMain.handle("set-completion-sound", (_event, enabled: boolean) =>
    setCompletionSound(enabled),
  );

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
    await startSshTunnel(conn.ssh);
    // Cache the remote API key so chat auth works through the tunnel
    if (conn.ssh) {
      const key = await sshReadRemoteApiKey(conn.ssh);
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
    "send-message",
    async (
      event,
      message: string,
      profile?: string,
      resumeSessionId?: string,
      history?: Array<{ role: string; content: string }>,
      attachments?: Attachment[],
      contextFolder?: string,
      groundInWorkspace?: boolean,
      clientRunId?: string,
    ) => {
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
          await startSshTunnel(conn.ssh);
        }
        // Always ensure the API key is cached — the key may not have been
        // read yet if the app-launch auto-start failed silently (#212).
        if (!getRemoteAuthHeader().Authorization) {
          const key = await sshReadRemoteApiKey(conn.ssh);
          setSshRemoteApiKey(key);
        }
      }

      // `clientRunId` is a desktop-side correlation token (never sent to the
      // gateway): it isolates concurrent runs from the SAME window — two fresh
      // runs would otherwise share `sender-<id>` and abort/cross-talk each other.
      // It is also echoed on every streaming event so a consumer can route only
      // its own run's tokens (the foundation for parallel session tabs). A run
      // with no clientRunId is the legacy/global stream owned by the main Chat.
      const sessionKey =
        resumeSessionId || clientRunId || `sender-${event.sender.id}`;

      const existing = activeChatAborts.get(sessionKey);
      if (existing) {
        existing();
      }

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
      // Streaming events carry `clientRunId` as a trailing arg so each renderer
      // consumer can filter to its own run (undefined === the legacy stream).
      const safeSend = (channel: string, payload: unknown): boolean => {
        if (event.sender.isDestroyed()) return false;
        try {
          event.sender.send(channel, payload, clientRunId);
          return true;
        } catch {
          return false;
        }
      };

      const handle = await sendMessage(
        message,
        {
          onChunk: (chunk) => {
            fullResponse += chunk;
            if (!safeSend("chat-chunk", chunk)) {
              // Renderer is gone — stop generating and resolve with what we
              // have so the awaiting promise doesn't leak.
              const abort = activeChatAborts.get(sessionKey);
              if (abort) abort();
            }
          },
          onReasoningChunk: (chunk) => {
            // Forward reasoning/thinking tokens on a dedicated channel so
            // the renderer can render the thinking bubble live during the
            // stream rather than waiting for a focus-change refresh (#352).
            // Same renderer-gone abort guard as the content channel.
            if (!safeSend("chat-reasoning-chunk", chunk)) {
              const abort = activeChatAborts.get(sessionKey);
              if (abort) abort();
            }
          },
          onDone: (sessionId) => {
            activeChatAborts.delete(sessionKey);
            safeSend("chat-done", sessionId || "");
            // Completion chime (M2C): a system beep when a run finishes — the
            // signal that tells you which of several parallel runs just landed.
            if (getCompletionSound()) shell.beep();
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
                title: "Hermes Agent",
                body: preview || "Response ready",
              }).show();
            }
          },
          onError: (error) => {
            activeChatAborts.delete(sessionKey);
            safeSend("chat-error", error);
            rejectChat(new Error(error));
            // Notify on error too if window not focused
            if (mainWindow && !mainWindow.isFocused()) {
              new Notification({
                title: "Hermes Agent — Error",
                body: error.slice(0, 100),
              }).show();
            }
          },
          onToolProgress: (tool) => {
            safeSend("chat-tool-progress", tool);
          },
          onUsage: (usage) => {
            safeSend("chat-usage", usage);
            // Persist to the desktop-owned usage store (A2). Best-effort:
            // recordUsage swallows its own errors so a write failure never
            // affects the live chat. sessionId falls back to the resume id.
            recordUsage(
              {
                sessionId: usage.sessionId ?? resumeSessionId,
                model: usage.model,
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
                totalTokens: usage.totalTokens,
                cost: usage.cost,
                cacheRead: usage.cacheRead,
                cacheWrite: usage.cacheWrite,
              },
              { profile },
            );
          },
          // Gateway-emitted custom events (ideas B1–B3). Forwarded to the
          // renderer with `sessionKey` so it can route the approval reply /
          // checkpoint panel / delegation tree to the right conversation.
          onApprovalRequest: (req) => {
            // Scoped autonomy (M2B): when the user has opted in, auto-resolve
            // provably-safe read-only commands so parallel/headless runs aren't
            // blocked on a click. Everything else still prompts. Enforced here
            // in main so the policy holds even for inbound (Telegram) sessions
            // that have no renderer to click approve.
            if (getAutoApprove(profile) && canAutoApprove(req)) {
              void respondRunApproval(req.id, "once", profile);
              // Audit log (Zero Trust compliance): persistently log the auto-approval
              appendAuditLog({
                ts: Date.now(),
                action: "auto-approve",
                command: req.command,
                runId: req.id,
                profile: profile || "default",
              });
              // Transparency (M2B): surface the auto-approval to the renderer so
              // it can show an audit notice; the run also still emits tool-progress.
              console.log(`[autonomy] auto-approved: ${req.command ?? req.id}`);
              safeSend("chat-approval-auto", { ...req, sessionKey });
              return;
            }
            safeSend("chat-approval-request", { ...req, sessionKey });
          },
          onCheckpoint: (cp) => {
            safeSend("chat-checkpoint", { ...cp, sessionKey });
          },
          onDelegateProgress: (p) => {
            safeSend("chat-delegate-progress", { ...p, sessionKey });
          },
        },
        profile,
        resumeSessionId,
        history,
        attachments,
        contextFolder,
        groundInWorkspace,
      );

      activeChatAborts.set(sessionKey, handle.abort);
      return promise;
    },
  );

  ipcMain.handle("abort-chat", (event, sessionId?: string) => {
    const sessionKey = sessionId || `sender-${event.sender.id}`;
    const abort = activeChatAborts.get(sessionKey);
    if (abort) {
      abort();
      activeChatAborts.delete(sessionKey);
    }
  });

  // Renderer-driven clipboard write (issue #298 — "Copy entire chat").
  // Routed through the main process so it doesn't depend on the renderer's
  // document being focused, which the navigator.clipboard API requires.
  ipcMain.handle("copy-to-clipboard", (_event, text: string) => {
    clipboard.writeText(typeof text === "string" ? text : "");
  });

  // Media — render agent-generated images and save them to disk (#299).
  ipcMain.handle("read-media-file", (_event, filePath: string) =>
    readMediaAsDataUrl(filePath),
  );
  ipcMain.handle("save-media-file", (event, src: string, name: string) =>
    saveMedia(src, name, BrowserWindow.fromWebContents(event.sender)),
  );
  ipcMain.handle("media-file-exists", (_event, filePath: string) =>
    mediaFileExists(filePath),
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
      // "Open" needs a real target — a local file or a web URL. A data:
      // URL is inline bytes with nothing to hand to the OS, so it is
      // save-only.
      if (!isData) {
        template.push({
          label: labels.open,
          click: () => {
            if (isUrl) {
              openExternalUrl(src);
            } else {
              shell.openPath(src).then((err) => {
                if (err) console.error("[media] open failed:", err);
              });
            }
          },
        });
      }
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

  // Gateway
  ipcMain.handle("start-gateway", async () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) {
      await sshStartGateway(conn.ssh);
      return true;
    }
    if (conn.mode === "remote") {
      // The remote server runs its own gateway; nothing to start locally.
      // Without this guard we'd fall through to `startGateway()` and
      // spawn a non-existent local hermes-agent (issue #266).
      return false;
    }
    return startGateway();
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
  ipcMain.handle("gateway-status", () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshGatewayStatus(conn.ssh);
    return isGatewayRunning();
  });

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

  // Sessions
  registerDualHandler("list-sessions", listSessions, sshListSessions);

  registerDualHandler(
    "get-session-messages",
    getSessionMessages,
    sshGetSessionMessages,
  );

  ipcMain.handle("delete-session", (_event, sessionId: string) => {
    return deleteSession(sessionId);
  });

  // Profiles
  registerDualHandler("list-profiles", listProfiles, sshListProfiles);
  registerDualHandler("create-profile", createProfile, sshCreateProfile);
  registerDualHandler("delete-profile", deleteProfile, sshDeleteProfile);
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

  // Memory
  registerDualHandler("read-memory", readMemory, sshReadMemory);
  // Memory timeline (idea A4): entries enriched with originating-session
  // provenance via FTS. Read-only; provenance is best-effort.
  ipcMain.handle("get-memory-timeline", (_event, profile?: string) =>
    getMemoryTimeline(profile),
  );
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

  // Personalization: whole-file MEMORY.md edit + focus.md + daily-context hook.
  // Local-only for now — SSH/remote variants are a follow-up, so over SSH these
  // return a no-op/notice rather than editing the wrong host's files.
  ipcMain.handle(
    "write-memory",
    (_event, content: string, profile?: string) => {
      if (getConnectionConfig().mode === "ssh")
        return {
          success: false,
          error: "Editing memory isn't available over SSH yet.",
        };
      return writeMemory(content, profile);
    },
  );
  ipcMain.handle("read-focus", () => {
    if (getConnectionConfig().mode === "ssh") return "";
    return readFocus();
  });
  ipcMain.handle("write-focus", (_event, content: string) => {
    if (getConnectionConfig().mode === "ssh")
      return {
        success: false,
        error: "Editing focus isn't available over SSH yet.",
      };
    return writeFocus(content);
  });
  ipcMain.handle(
    "get-daily-context-hook-status",
    (_event, profile?: string) => {
      if (getConnectionConfig().mode === "ssh")
        return {
          configured: false,
          allowlisted: false,
          scriptExists: false,
          enabled: false,
        };
      return getDailyContextHookStatus(profile);
    },
  );
  ipcMain.handle(
    "set-daily-context-hook-enabled",
    (_event, enabled: boolean, profile?: string) => {
      if (getConnectionConfig().mode === "ssh")
        return {
          success: false,
          error: "The daily-context hook isn't available over SSH yet.",
        };
      return setDailyContextHookEnabled(enabled, profile);
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
  // Live registry browse — expose the existing CLI search (local-mode only).
  ipcMain.handle("search-skills", (_event, query: string) => {
    requireLocalWorkspace();
    return searchSkills(query);
  });
  // Authoring / management — operate on the local profile's skills dirs only.
  ipcMain.handle("create-skill", (_event, input: CreateSkillInput) => {
    requireLocalWorkspace();
    return createSkill(input);
  });
  ipcMain.handle(
    "write-skill-content",
    (_event, skillPath: string, content: string, profile?: string) => {
      requireLocalWorkspace();
      return writeSkillContent(skillPath, content, profile);
    },
  );
  ipcMain.handle("list-disabled-skills", (_event, profile?: string) => {
    requireLocalWorkspace();
    return listDisabledSkills(profile);
  });
  ipcMain.handle(
    "set-skill-enabled",
    (_event, skillPath: string, enabled: boolean, profile?: string) => {
      requireLocalWorkspace();
      return setSkillEnabled(skillPath, enabled, profile);
    },
  );
  ipcMain.handle("discover-local-skills", (_event, profile?: string) => {
    requireLocalWorkspace();
    return discoverLocalSkills(profile);
  });
  ipcMain.handle(
    "import-local-skill",
    (_event, sourcePath: string, category?: string, profile?: string) => {
      requireLocalWorkspace();
      return importLocalSkill(sourcePath, category, profile);
    },
  );
  // Draft a SKILL.md from a local repo (one gateway completion; local-only).
  ipcMain.handle(
    "generate-skill-from-repo",
    (_event, repoPath: string, profile?: string) => {
      requireLocalWorkspace();
      return generateSkillFromRepo(repoPath, profile);
    },
  );

  // Session cache (fast local cache with generated titles)
  ipcMain.handle(
    "list-cached-sessions",
    (_event, limit?: number, offset?: number) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshListCachedSessions(conn.ssh, limit, offset);
      return listCachedSessions(limit, offset);
    },
  );
  ipcMain.handle("sync-session-cache", () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshListCachedSessions(conn.ssh, 50);
    try {
      return syncSessionCache();
    } catch (error) {
      console.error("sync-session-cache failed; using local cache", error);
      return listCachedSessions(50);
    }
  });
  ipcMain.handle(
    "update-session-title",
    (_event, sessionId: string, title: string) =>
      updateSessionTitle(sessionId, title),
  );

  // Session search
  ipcMain.handle("search-sessions", (_event, query: string, limit?: number) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshSearchSessions(conn.ssh, query, limit);
    return searchSessions(query, limit);
  });

  // ── SPS-vault index (S3): the same engine pointed at sps-agent/vault/, so the
  //    mirrored SPS pages become queryable (search, property views, backlinks).
  ipcMain.handle(
    "sps-index-query",
    async (_event, query: NoteQuery, profile?: string) => {
      requireLocalWorkspace();
      return (await getSpsNoteIndex(profile)).query(query ?? {});
    },
  );

  ipcMain.handle(
    "sps-index-search",
    async (_event, text: string, limit?: number, profile?: string) => {
      requireLocalWorkspace();
      return (await getSpsNoteIndex(profile)).search(text, limit ?? 20);
    },
  );

  ipcMain.handle(
    "sps-index-backlinks",
    async (_event, path: string, profile?: string) => {
      requireLocalWorkspace();
      return (await getSpsNoteIndex(profile)).backlinks(path);
    },
  );

  // F4: the full [[wikilink]] edge list, for the local graph view.
  ipcMain.handle("sps-index-links", async (_event, profile?: string) => {
    requireLocalWorkspace();
    return (await getSpsNoteIndex(profile)).links();
  });

  // Obsidian-native tags (frontmatter + inline #tag) for tag clouds/filters.
  ipcMain.handle("sps-index-tags", async (_event, profile?: string) => {
    requireLocalWorkspace();
    return (await getSpsNoteIndex(profile)).allTags();
  });

  // Vault lint (second-brain "Lint"): orphans, broken [[wikilinks]], stale notes.
  ipcMain.handle(
    "sps-lint-vault",
    async (_event, staleDays?: number, profile?: string) => {
      requireLocalWorkspace();
      const staleBeforeMs =
        staleDays && staleDays > 0
          ? Date.now() - staleDays * 24 * 60 * 60 * 1000
          : undefined;
      return (await getSpsNoteIndex(profile)).lint(staleBeforeMs);
    },
  );

  ipcMain.handle(
    "sps-index-by-tag",
    async (_event, tag: string, profile?: string) => {
      requireLocalWorkspace();
      return (await getSpsNoteIndex(profile)).notesByTag(tag);
    },
  );

  ipcMain.handle("sps-index-status", async (_event, profile?: string) => {
    requireLocalWorkspace();
    return (await getSpsNoteIndex(profile)).status();
  });

  ipcMain.handle("sps-index-rebuild", async (_event, profile?: string) => {
    requireLocalWorkspace();
    return (await getSpsNoteIndex(profile)).rebuild();
  });

  // Shared-directory Obsidian mode: where the SPS vault lives on disk. Pointing
  // it at an Obsidian vault (ideally a dedicated subfolder) makes the same
  // markdown a first-class Obsidian vault. Non-destructive — never moves files.
  ipcMain.handle("sps-get-vault-location", (_event, profile?: string) => {
    requireLocalWorkspace();
    return getVaultLocation(profile);
  });

  ipcMain.handle(
    "sps-set-vault-location",
    async (_event, dir: string, profile?: string) => {
      requireLocalWorkspace();
      const result = setVaultLocation(dir, profile);
      // Drop cached indexes so the next access opens at the new root.
      if (result.ok) await closeAllNoteIndexes();
      return result;
    },
  );

  ipcMain.handle(
    "sps-reset-vault-location",
    async (_event, profile?: string) => {
      requireLocalWorkspace();
      const location = resetVaultLocation(profile);
      await closeAllNoteIndexes();
      return location;
    },
  );

  // Folder picker for the vault-location setting (createDirectory allowed).
  ipcMain.handle("sps-pick-vault-dir", async () => {
    requireLocalWorkspace();
    const res = await dialog.showOpenDialog({
      title: "Choose a folder for the SPS vault",
      properties: ["openDirectory", "createDirectory"],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  // KB Phase 0: open a file dialog scoped to PDFs; returns the absolute path or
  // null if cancelled. Local workspace only (the agent reads these files later).
  ipcMain.handle("sps-pick-pdf", async (event) => {
    requireLocalWorkspace();
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts: Electron.OpenDialogOptions = {
      properties: ["openFile"],
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    };
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // KB Phase 0: extract a text-layer PDF into markdown for ingestion. Stateless
  // — the renderer turns the result into a real page via pageFromMarkdown +
  // makePage so markdown-on-disk stays authoritative.
  ipcMain.handle("sps-extract-pdf", async (_event, filePath: string) => {
    requireLocalWorkspace();
    return extractPdfToMarkdown(filePath);
  });

  // Raw PDF bytes for renderer-side OCR of a scanned doc (item 2). Same trust
  // boundary as sps-extract-pdf — a user-picked file path read locally.
  ipcMain.handle("sps-read-file-bytes", async (_event, filePath: string) => {
    requireLocalWorkspace();
    const buffer = await readFile(filePath);
    return new Uint8Array(buffer);
  });

  ipcMain.handle("get-obsidian-config", async (_event, profile?: string) => {
    requireLocalWorkspace();
    return getObsidianConfig(profile);
  });

  ipcMain.handle(
    "set-obsidian-config",
    async (_event, input: ObsidianConfigInput, profile?: string) => {
      requireLocalWorkspace();
      const config = await setObsidianConfig(input, profile);
      if (obsidianWatcherProfile === (profile || "")) {
        if (obsidianWatcher) {
          await obsidianWatcher.close();
          obsidianWatcher = null;
        }
        if (config.enabled) await ensureObsidianWatcher(profile);
      }
      return config;
    },
  );

  ipcMain.handle("get-obsidian-tree", async (_event, profile?: string) => {
    requireLocalWorkspace();
    await ensureObsidianWatcher(profile);
    return getObsidianTree(profile);
  });

  ipcMain.handle(
    "read-obsidian-file",
    async (_event, path: string, profile?: string) => {
      requireLocalWorkspace();
      await ensureObsidianWatcher(profile);
      return readObsidianFile(path, profile);
    },
  );

  ipcMain.handle(
    "write-obsidian-file",
    async (_event, path: string, content: string, profile?: string) => {
      requireLocalWorkspace();
      await ensureObsidianWatcher(profile);
      return writeObsidianFile(path, content, profile);
    },
  );

  ipcMain.handle(
    "append-obsidian-file",
    async (_event, path: string, content: string, profile?: string) => {
      requireLocalWorkspace();
      await ensureObsidianWatcher(profile);
      return appendObsidianFile(path, content, profile);
    },
  );

  ipcMain.handle(
    "search-obsidian",
    async (_event, query: string, limit?: number, profile?: string) => {
      requireLocalWorkspace();
      return searchObsidian(query, limit ?? 20, profile);
    },
  );

  ipcMain.handle(
    "open-obsidian-note",
    async (_event, path: string, profile?: string) => {
      requireLocalWorkspace();
      const config = await getObsidianConfig(profile);
      if (!config.enabled) throw new Error("Obsidian vault is not configured");
      openExternalUrl(
        buildObsidianOpenUri({
          vaultName: config.vaultName || config.vaultId,
          vaultPath: config.vaultPath,
          path,
        }),
      );
      return true;
    },
  );

  ipcMain.handle(
    "call-obsidian-function",
    async (
      _event,
      name: ObsidianFunctionName,
      payload?: Record<string, unknown>,
      profile?: string,
    ) => {
      requireLocalWorkspace();
      return callObsidianFunction(name, payload ?? {}, profile);
    },
  );

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
    if (conn.mode === "ssh" && conn.ssh) return sshListModels(conn.ssh);
    return listModels();
  });
  ipcMain.handle(
    "add-model",
    (
      _event,
      name: string,
      provider: string,
      model: string,
      baseUrl: string,
    ) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        return sshAddModel(conn.ssh, name, provider, model, baseUrl);
      }
      return addModel(name, provider, model, baseUrl);
    },
  );
  ipcMain.handle("remove-model", (_event, id: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshRemoveModel(conn.ssh, id);
    return removeModel(id);
  });
  ipcMain.handle(
    "update-model",
    (_event, id: string, fields: Record<string, string>) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshUpdateModel(conn.ssh, id, fields);
      return updateModel(id, fields);
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
      sshReadRemoteApiKey,
      setSshRemoteApiKey,
      startClaw3dAll,
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
      opts?: {
        freshnessWindowMinutes?: number;
        failureBehavior?: "retry" | "notify" | "ignore";
        firstRunManual?: boolean;
      },
    ) => createCronJob(schedule, prompt, name, deliver, profile, opts),
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

  // SPS Agent workspace (unfurl / assistant / persistence)
  ipcMain.handle("sps-unfurl", (_event, url: string) => spsUnfurl(url));
  ipcMain.handle(
    "sps-assistant",
    (
      _event,
      prompt: string,
      ctx: SpsPageContext,
      profile?: string,
      groundInWorkspace?: boolean,
    ) => spsAssistant(prompt, ctx, profile, groundInWorkspace),
  );
  // Second-brain ingest: propose a wiki changeset from unprocessed inbox
  // captures (read-only; the renderer reviews + commits).
  ipcMain.handle("sps-ingest-inbox", (_event, profile?: string) =>
    spsIngestInbox(profile),
  );
  ipcMain.handle("sps-load", (_event, profile?: string) => spsLoad(profile));
  ipcMain.handle("sps-save", (_event, ws: unknown, profile?: string) =>
    spsSave(ws, profile),
  );

  // Resumable /work session map (M1C) — survives reload in both storage modes.
  ipcMain.handle(
    "sps-get-work-session",
    (_event, pageId: string, profile?: string) =>
      spsGetWorkSession(pageId, profile),
  );
  ipcMain.handle(
    "sps-set-work-session",
    (_event, pageId: string, sessionId: string, profile?: string) =>
      spsSetWorkSession(pageId, sessionId, profile),
  );

  // Research (OpenAlex): scholarly search/fetch demystified into clean DTOs.
  // The dense JSON is normalized in the main process (src/main/openalex.ts);
  // the renderer only ever sees small WorkSummary/WorkDetail objects.
  ipcMain.handle(
    "sps-research-search-works",
    (_event, q: string, opts?: SearchOpts, profile?: string) =>
      oaSearchWorks(q, opts ?? {}, profile),
  );
  ipcMain.handle(
    "sps-research-get-work",
    (_event, id: string, profile?: string) => oaGetWork(id, profile),
  );
  ipcMain.handle("sps-research-get-config", () => getPublicResearchConfig());
  ipcMain.handle(
    "sps-research-set-config",
    (_event, mailto: string, apiKey?: string) => {
      setResearchConfig(mailto, apiKey);
      return getPublicResearchConfig();
    },
  );
  // Make OpenAlex callable by the Hermes agent in chat (bundled MCP server).
  ipcMain.handle("sps-research-ensure-agent-tool", (_event, profile?: string) =>
    ensureResearchMcpRegistered(profile),
  );

  // Additive markdown mirror (S2b): write a page's markdown into the SPS vault
  // so the substrate + note-index materialize. The JSON blob stays authoritative.
  ipcMain.handle(
    "sps-export-page",
    (_event, pageId: string, markdown: string, profile?: string) => {
      const dir = spsVaultDirFor(profile);
      return exportPageMarkdownTo(dir, pageId, markdown);
    },
  );

  // S4: folder-backed database rows live under the SPS vault as markdown files.
  ipcMain.handle(
    "sps-export-row",
    (
      _event,
      dbFolder: string,
      rowId: string,
      markdown: string,
      profile?: string,
    ) => {
      const dir = spsVaultDirFor(profile);
      return exportRowMarkdownTo(dir, dbFolder, rowId, markdown);
    },
  );
  ipcMain.handle(
    "sps-read-row",
    (_event, dbFolder: string, rowId: string, profile?: string) => {
      const dir = spsVaultDirFor(profile);
      return readRowMarkdownFrom(dir, dbFolder, rowId);
    },
  );
  ipcMain.handle(
    "sps-delete-row",
    (_event, dbFolder: string, rowId: string, profile?: string) => {
      const dir = spsVaultDirFor(profile);
      return deleteRowIn(dir, dbFolder, rowId);
    },
  );

  // F3: remove an orphaned page file from the vault (vault mode). Best-effort.
  ipcMain.handle(
    "sps-delete-page",
    (_event, pageId: string, profile?: string) => {
      const dir = spsVaultDirFor(profile);
      return deletePageIn(dir, pageId);
    },
  );

  // F3: remove a folder-backed database's row folder when its block is removed
  // (vault mode). Best-effort.
  ipcMain.handle(
    "sps-delete-db-folder",
    (_event, dbFolder: string, profile?: string) => {
      const dir = spsVaultDirFor(profile);
      return deleteDbFolderIn(dir, dbFolder);
    },
  );

  // Equity baskets: persisted holdings shared with the Python skill pack
  // (basket_store.py reads/writes the SAME equity-baskets.json). Thin fs
  // wrappers — no gateway involved.
  ipcMain.handle("equity-list-baskets", (_event, profile?: string) =>
    listBaskets(profile),
  );
  ipcMain.handle(
    "equity-save-basket",
    (_event, basket: unknown, profile?: string) => saveBasket(basket, profile),
  );
  ipcMain.handle(
    "equity-delete-basket",
    (_event, basketId: string, profile?: string) =>
      deleteBasket(basketId, profile),
  );

  // Equity alerts: the in-app Alert Center reads the jsonl the headless
  // evaluator (india-equity-alerts) appends; markRead flips read in place.
  ipcMain.handle(
    "equity-list-alerts",
    (_event, limit?: number, profile?: string) => listAlerts(limit, profile),
  );
  ipcMain.handle(
    "equity-mark-alert-read",
    (_event, alertId: string, profile?: string) =>
      markAlertRead(alertId, profile),
  );

  // S6: vault-as-authoritative-store I/O (page files + structure manifest) and
  // a pre-migration backup of the JSON blob.
  const spsVaultDir = (profile?: string): string => spsVaultDirFor(profile);
  ipcMain.handle("sps-vault-read", async (_event, profile?: string) => {
    const dir = spsVaultDir(profile);
    const [pages, manifest] = await Promise.all([
      readVaultPages(dir),
      readVaultManifest(dir),
    ]);
    return { pages, manifest };
  });
  ipcMain.handle(
    "sps-vault-write-manifest",
    (_event, json: string, profile?: string) =>
      writeVaultManifest(spsVaultDir(profile), json),
  );
  ipcMain.handle("sps-backup-workspace", (_event, profile?: string) =>
    spsBackupWorkspace(profile),
  );

  // Excalidraw sidecar assets: the scene JSON (.excalidraw) + its rendered
  // preview (.excalidraw.svg) live under the vault's assets/<pageId>/ folder,
  // keeping the page markdown clean. assetId is a stable, path-embedded handle.
  ipcMain.handle(
    "sps-write-excalidraw",
    async (
      _event,
      pageId: string,
      assetId: string,
      sceneJson: string,
      svg: string,
      profile?: string,
    ) => {
      const dir = spsVaultDir(profile);
      const okScene = await writeAssetTo(
        dir,
        pageId,
        `${assetId}.excalidraw`,
        sceneJson,
      );
      const okSvg = await writeAssetTo(
        dir,
        pageId,
        `${assetId}.excalidraw.svg`,
        svg,
      );
      return okScene && okSvg;
    },
  );
  ipcMain.handle(
    "sps-read-excalidraw",
    async (_event, pageId: string, assetId: string, profile?: string) => {
      const dir = spsVaultDir(profile);
      const [scene, svg] = await Promise.all([
        readAssetFrom(dir, pageId, `${assetId}.excalidraw`),
        readAssetFrom(dir, pageId, `${assetId}.excalidraw.svg`),
      ]);
      return { scene, svg };
    },
  );
  // Asset store: write media bytes to vault/_assets/<sha256>.<ext> and return
  // the bare filename. Reads happen via the sps-asset:// protocol, not IPC.
  ipcMain.handle(
    "sps-asset-write",
    (_event, bytes: Uint8Array, ext: string, profile?: string) =>
      writeAsset(spsVaultDirFor(profile), Buffer.from(bytes), ext),
  );
  ipcMain.handle("sps-asset-exists", (_event, name: string, profile?: string) =>
    assetExists(spsVaultDirFor(profile), name),
  );
  // GC: delete any asset not referenced by a live block. `referenced` is the
  // set of asset filenames the renderer still points at.
  ipcMain.handle(
    "sps-asset-gc",
    (_event, referenced: string[], profile?: string) =>
      gcAssets(spsVaultDirFor(profile), referenced),
  );
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
  autoUpdater.autoDownload = false;
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

// Single instance: a second launch must not spin up a parallel app. Acquire the
// lock; if another instance already holds it, focus its window and quit this one.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  // A second instance is already quitting (above) — do nothing here.
  if (!gotSingleInstanceLock) return;
  app.name = "Hermes";
  electronApp.setAppUserModelId("com.nousresearch.hermes");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() === "webview") {
      hardenAttachedWebContents(contents);
    }
  });

  // Stream SPS vault assets to the renderer. URL shape: sps-asset://asset/<name>
  // where <name> is a content-addressed `<sha256>.<ext>`. The strict name check
  // in resolveAssetPath makes this traversal-proof; net.fetch on a file URL
  // gives us range requests (video/audio seeking) for free.
  protocol.handle("sps-asset", async (request) => {
    try {
      const name = decodeURIComponent(new URL(request.url).pathname).replace(
        /^\/+/,
        "",
      );
      const abs = resolveAssetPath(spsVaultDirFor(), name);
      if (!abs) return new Response("Bad asset name", { status: 400 });
      return net.fetch(pathToFileURL(abs).toString());
    } catch {
      return new Response("Not found", { status: 404 });
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
      await startSshTunnel(conn.ssh);
      const key = await sshReadRemoteApiKey(conn.ssh);
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
    stopSshTunnel();
    stopClaw3d();
    app.quit();
  }
});

app.on("before-quit", () => {
  stopHealthPolling();
  for (const abort of activeChatAborts.values()) {
    abort();
  }
  activeChatAborts.clear();
  // Leave profile gateways running on quit (see window-all-closed) so bots
  // and other platforms stay online headless.
  stopSshTunnel();
  stopClaw3d();
  void closeAllNoteIndexes();
});

interface AuditLogEntry {
  ts: number;
  action: string;
  command?: string;
  runId?: string;
  profile?: string;
}

const AUDIT_LOG_MAX_LINES = 1000;

export function appendAuditLog(entry: AuditLogEntry): void {
  try {
    const logDir = join(HERMES_HOME, "logs");
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    const logFile = join(logDir, "audit.log");
    let existing = "";
    if (existsSync(logFile)) {
      existing = readFileSync(logFile, "utf-8");
      const lines = existing.split("\n").filter((l) => l.trim() !== "");
      if (lines.length >= AUDIT_LOG_MAX_LINES) {
        existing =
          lines.slice(lines.length - AUDIT_LOG_MAX_LINES + 1).join("\n") +
          "\n";
      } else if (existing && !existing.endsWith("\n")) {
        existing += "\n";
      }
    }
    const line = JSON.stringify(entry) + "\n";
    writeFileSync(logFile, existing + line, "utf-8");
  } catch {
    // intentionally silent
  }
}
