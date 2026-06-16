import {
  app,
  BrowserWindow,
  Menu,
  net,
  protocol,
  screen,
  shell,
  globalShortcut,
  Tray,
  ipcMain,
} from "electron";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";
import { exec } from "child_process";
import { promisify } from "util";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
} from "fs";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import type { AppUpdater } from "electron-updater";
import icon from "../../resources/icon.png?asset";

const execAsync = promisify(exec);

import { closeSharedDb } from "./db";
import { closeAllNoteIndexes } from "./note-index";
import { isAllowedObsidianExternalUrl } from "./obsidian";
import {
  stopHealthPolling,
  setSshRemoteApiKey,
  setGatewayHealthBroadcaster,
  setStreamOpenProvider,
} from "./hermes";
import { activeChatAborts } from "./ipc/chat";
import { stopSshTunnel, startSshTunnel } from "./ssh-tunnel";
import { HERMES_HOME, ensureDesktopMcpRegistered } from "./installer";
import {
  isAllowedExternalUrl,
  isAllowedAppNavigationUrl,
  isAllowedWebviewUrl,
  hardenWebviewPreferences,
  hardenAttachedWebContents,
} from "./security";
import { resolveSpsVaultDir } from "./sps-storage";
import { resolveAssetPath, writeAsset } from "./sps-assets";
import { startEquityAlertWatcher } from "./equity-alerts";
import { startScheduledResearch } from "./scheduled-research";
import { updaterLogger } from "./updater-log";
import { getConnectionConfig } from "./config";
import {
  sshGatewayStatus,
  sshStartGateway,
  sshReadRemoteApiKey,
} from "./ssh-remote";

import { registerSystemIpc } from "./ipc/system";
import { registerConfigIpc } from "./ipc/config";
import { registerChatIpc, abortAllChats } from "./ipc/chat";
import { registerNotesIpc, closeObsidianWatcher } from "./ipc/notes";
import { registerWorkspaceIpc } from "./ipc/workspace";
import { registerUtilityIpc } from "./ipc/utility";
import { registerFederatedSearchIpc } from "./ipc/federated-search";
import {
  registerExternalContextIpc,
  scheduleExternalContextScans,
  stopExternalContextScans,
} from "./ipc/external-context";
import { registerHealthRssIpc } from "./ipc/health-rss";
import { registerSubstackRadarIpc } from "./ipc/substack-radar";
import { closeExternalContextDb } from "./external-context/index";
import { startScheduler, stopScheduler } from "./scheduler";
import {
  startCapabilityRiskScheduler,
  stopCapabilityRiskScheduler,
} from "./capability-risk";
import { startControlServer, stopControlServer } from "./control-server";
import { setMainWindowGetter } from "./self-healing";
import { log } from "./log";
import { redactExternalText } from "./external-context/redact";

// Last-resort loggers: anything that escapes a handler or a stray promise lands
// here as a structured, redacted line in desktop.log instead of vanishing into a
// dev-only console.error. Secrets can ride in either the message or the stack.
process.on("uncaughtException", (err) => {
  const message = redactExternalText(
    err instanceof Error ? err.message : String(err),
  );
  const stack = err instanceof Error ? err.stack : undefined;
  log.error("main", {
    kind: "uncaughtException",
    message,
    stack: typeof stack === "string" ? redactExternalText(stack) : undefined,
  });
});

process.on("unhandledRejection", (reason) => {
  const message = redactExternalText(
    reason instanceof Error ? reason.message : String(reason),
  );
  const stack = reason instanceof Error ? reason.stack : undefined;
  log.error("main", {
    kind: "unhandledRejection",
    message,
    stack: typeof stack === "string" ? redactExternalText(stack) : undefined,
  });
});

let mainWindow: BrowserWindow | null = null;
let captureWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function createCaptureWindow(): void {
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.focus();
    return;
  }

  const rendererHtmlPath = join(__dirname, "../renderer/index.html");
  captureWindow = new BrowserWindow({
    width: 600,
    height: 350,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  const devUrl = is.dev ? process.env["ELECTRON_RENDERER_URL"] : undefined;
  if (devUrl) {
    captureWindow.loadURL(`${devUrl}?window=capture`);
  } else {
    captureWindow.loadURL(
      `${pathToFileURL(rendererHtmlPath).toString()}?window=capture`,
    );
  }

  captureWindow.on("blur", () => {
    captureWindow?.hide();
  });

  captureWindow.on("closed", () => {
    captureWindow = null;
  });
}

function toggleCaptureWindow(): void {
  if (!captureWindow || captureWindow.isDestroyed()) {
    createCaptureWindow();
  }
  if (captureWindow) {
    if (captureWindow.isVisible()) {
      captureWindow.hide();
    } else {
      captureWindow.show();
      captureWindow.focus();
    }
  }
}

function createTray(): void {
  if (tray) return;
  try {
    tray = new Tray(icon);
    tray.setToolTip("Hermes Quick Capture");
    tray.on("click", () => {
      toggleCaptureWindow();
    });
  } catch (err) {
    console.error("[TRAY] Failed to create tray icon:", err);
  }
}

function openExternalUrl(rawUrl: unknown): void {
  if (!isAllowedExternalUrl(rawUrl) && !isAllowedObsidianExternalUrl(rawUrl)) {
    console.warn("[SECURITY] Blocked unsafe external URL");
    return;
  }

  shell.openExternal(rawUrl as string).catch((err) => {
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

interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized?: boolean;
}

function getSavedWindowState(): WindowState {
  const statePath = join(HERMES_HOME, "window-state.json");
  try {
    if (existsSync(statePath)) {
      const data = JSON.parse(readFileSync(statePath, "utf-8"));
      if (typeof data.width === "number" && typeof data.height === "number") {
        return data;
      }
    }
  } catch (err) {
    console.error("[WINDOW STATE] Failed to load window state:", err);
  }
  return { width: 1100, height: 850 };
}

function saveWindowState(win: BrowserWindow): void {
  const statePath = join(HERMES_HOME, "window-state.json");
  try {
    const isMaximized = win.isMaximized();
    let bounds;
    if (isMaximized) {
      const existing = getSavedWindowState();
      bounds = {
        width: existing.width,
        height: existing.height,
        x: existing.x,
        y: existing.y,
      };
    } else {
      bounds = win.getBounds();
    }
    const state: WindowState = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized,
    };
    const dir = join(HERMES_HOME);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(statePath, JSON.stringify(state), "utf-8");
  } catch (err) {
    console.error("[WINDOW STATE] Failed to save window state:", err);
  }
}

function createWindow(): void {
  const rendererHtmlPath = join(__dirname, "../renderer/index.html");
  const state = getSavedWindowState();

  // Validate coordinates: verify they are within display bounds
  if (state.x !== undefined && state.y !== undefined) {
    const displays = screen.getAllDisplays();
    const isVisible = displays.some((display) => {
      const db = display.bounds;
      return (
        state.x! >= db.x &&
        state.x! < db.x + db.width &&
        state.y! >= db.y &&
        state.y! < db.y + db.height
      );
    });
    if (!isVisible) {
      state.x = undefined;
      state.y = undefined;
    }
  }

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
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
    ...(process.platform !== "darwin" ? { icon } : {}),
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

  if (state.isMaximized) {
    mainWindow.maximize();
  }

  const handleSaveState = (): void => {
    if (mainWindow) {
      saveWindowState(mainWindow);
    }
  };

  mainWindow.on("resize", handleSaveState);
  mainWindow.on("move", handleSaveState);
  mainWindow.on("close", handleSaveState);

  mainWindow.on("ready-to-show", () => {
    mainWindow!.show();
    // Watch the equity alert log → OS notification + renderer event per new line.
    void startEquityAlertWatcher(() => mainWindow);
    // Scheduled research: catch up on launch, then tick on a timer.
    startScheduledResearch(() => mainWindow);
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

  // Microphone access for push-to-talk voice input and voice notes. Grant audio-only
  // `media` ONLY to the app renderer (file:// or the dev server); deny camera,
  // attached webviews, and any other untrusted permission requests.
  mainWindow.webContents.session.setPermissionRequestHandler(
    (wc, permission, callback, details) => {
      const url = wc?.getURL?.() ?? "";
      const devUrl = is.dev ? process.env["ELECTRON_RENDERER_URL"] : undefined;
      const isAppRenderer =
        url.startsWith("file://") || (!!devUrl && url.startsWith(devUrl));

      if (permission === "media") {
        if (!isAppRenderer) return callback(false);
        const mediaTypes =
          (details as { mediaTypes?: string[] }).mediaTypes ?? [];
        callback(!mediaTypes.includes("video")); // Grant audio-only, deny video/camera
        return;
      }

      callback(isAppRenderer);
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
  registerSystemIpc(() => mainWindow);
  registerConfigIpc();
  registerChatIpc(() => mainWindow);
  registerNotesIpc(() => mainWindow);
  registerWorkspaceIpc(() => mainWindow);
  registerUtilityIpc(() => mainWindow);
  registerExternalContextIpc(() => mainWindow);
  registerFederatedSearchIpc();
  scheduleExternalContextScans(() => mainWindow);
  registerHealthRssIpc();
  registerSubstackRadarIpc();

  ipcMain.handle(
    "sps-trigger-screencapture",
    async (_event, profile?: string) => {
      if (captureWindow && !captureWindow.isDestroyed()) {
        captureWindow.hide();
      }
      await new Promise((resolve) => setTimeout(resolve, 150));

      const tempPath = join(
        tmpdir(),
        `hermes-capture-${Date.now()}.png`,
      );
      try {
        await execAsync(`screencapture -i "${tempPath}"`);
        if (existsSync(tempPath)) {
          const buffer = readFileSync(tempPath);
          try {
            unlinkSync(tempPath);
          } catch (err) {
            console.error("[QuickCapture] Failed to delete temp file:", err);
          }
          const dir = spsVaultDirFor(profile);
          const name = await writeAsset(dir, buffer, "png");
          if (captureWindow && !captureWindow.isDestroyed()) {
            captureWindow.show();
            captureWindow.focus();
          }
          return name;
        }
      } catch (err) {
        console.error("[QuickCapture] screencapture failed or canceled", err);
      }
      if (captureWindow && !captureWindow.isDestroyed()) {
        captureWindow.show();
        captureWindow.focus();
      }
      return null;
    },
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
  const isPortableBuild = !!process.env.PORTABLE_EXECUTABLE_DIR;

  if (!app.isPackaged || isPortableBuild) {
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
  if (process.platform === "darwin") {
    try {
      app.dock?.setIcon(icon);
    } catch (err) {
      console.error("[DOCK] Failed to set dock icon:", err);
    }
  }
  electronApp.setAppUserModelId("com.nousresearch.hermes");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // Register global shortcut for voice input trigger (Feature D)
  globalShortcut.register("Control+Shift+V", () => {
    if (mainWindow) {
      mainWindow.webContents.send("global-voice-trigger");
    }
  });

  globalShortcut.register("Alt+Space", () => {
    toggleCaptureWindow();
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
  createTray();
  ensureDesktopMcpRegistered();
  setMainWindowGetter(() => mainWindow);
  // Phase 1.1 — let the gateway supervisor push health transitions to the renderer
  // and know when an interactive stream is in-flight (so it never restarts mid-turn).
  setGatewayHealthBroadcaster((status) =>
    mainWindow?.webContents.send("gateway-health-changed", { status }),
  );
  setStreamOpenProvider(() => activeChatAborts.size > 0);
  setupUpdater();

  // Start background routines scheduler and control server
  startScheduler();
  startCapabilityRiskScheduler();
  startControlServer().catch((err) => {
    console.error("[CONTROL SERVER] Failed to auto-start:", err);
  });

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
    // detached and meant to keep running headless (e.g. Discord bots
    // stay online after the desktop closes). The user stops a gateway
    // explicitly via the Gateway controls.
    stopSshTunnel();
    app.quit();
  }
});

app.on("before-quit", () => {
  globalShortcut.unregisterAll();
  stopScheduler();
  stopCapabilityRiskScheduler();
  stopControlServer();
  stopHealthPolling();
  abortAllChats();
  void closeObsidianWatcher();
  // Leave profile gateways running on quit (see window-all-closed) so bots
  // and other platforms stay online headless.
  stopSshTunnel();
  void closeAllNoteIndexes();
  stopExternalContextScans();
  closeExternalContextDb();
  closeSharedDb();
});

// appendAuditLog moved to ./audit-log to break the index ↔ ipc/chat cycle.
