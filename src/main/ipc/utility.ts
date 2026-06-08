import { ipcMain, BrowserWindow, clipboard, shell, dialog, Menu } from "electron";
import { readdir, readFile } from "fs/promises";
import { extname } from "path";
import { readMediaAsDataUrl, saveMedia, mediaFileExists } from "../media";
import { stageAttachment, clearStagedAttachments } from "../attachment-staging";
import {
  getClaw3dStatus,
  setupClaw3d,
  getClaw3dPort,
  setClaw3dPort,
  getClaw3dWsUrl,
  setClaw3dWsUrl,
  startDevServer,
  stopDevServer,
  startAdapter,
  stopAdapter,
  getClaw3dLogs,
  stopAll as stopClaw3d,
  startAll as startClaw3dAll,
  type Claw3dSetupProgress,
} from "../claw3d";
import { startOfficeStack } from "../office-start";
import {
  pythonCompress,
  pythonIsPathAllowed,
  pythonEvaluateExecution,
  pythonMemorySave,
  pythonMemorySearch,
  pythonMemoryGraph,
} from "../agent-core-bridge";
import { getConnectionConfig } from "../config";
import { isGatewayRunning, startGateway, setSshRemoteApiKey } from "../hermes";
import { sshGatewayStatus, sshStartGateway, sshReadRemoteApiKey } from "../ssh-remote";
import { startSshTunnel } from "../ssh-tunnel";
import { isAllowedExternalUrl } from "../security";
import { isAllowedObsidianExternalUrl } from "../obsidian";
import { getUsageStats, readUsageRecords, sessionLedger } from "../usage-store";
import { listSessions } from "../sessions";
import { summarizeSearch } from "../session-summary";
import { listSkins } from "../skins";
import { runSecurityAudit, getPromptSizeBreakdown } from "../installer";


function openExternalUrl(rawUrl: unknown): void {
  if (!isAllowedExternalUrl(rawUrl) && !isAllowedObsidianExternalUrl(rawUrl)) {
    console.warn("[SECURITY] Blocked unsafe external URL");
    return;
  }

  shell.openExternal(rawUrl as string).catch((err) => {
    console.error("[SECURITY] Failed to open external URL:", err);
  });
}

export function registerUtilityIpc(_mainWindowGetter: () => BrowserWindow | null): void {
  // Shell
  ipcMain.handle("open-external", (_event, url: string) => {
    openExternalUrl(url);
  });

  // Clipboard
  ipcMain.handle("copy-to-clipboard", (_event, text: string) => {
    clipboard.writeText(typeof text === "string" ? text : "");
  });

  // Media
  ipcMain.handle("read-media-file", (_event, filePath: string) =>
    readMediaAsDataUrl(filePath),
  );
  ipcMain.handle("save-media-file", (event, src: string, name: string) =>
    saveMedia(src, name, BrowserWindow.fromWebContents(event.sender)),
  );
  ipcMain.handle("media-file-exists", (_event, filePath: string) =>
    mediaFileExists(filePath),
  );

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

  // Attachment Staging
  ipcMain.handle(
    "stage-attachment",
    (_event, sessionId: string, filename: string, base64Bytes: string) => {
      return stageAttachment(sessionId, filename, base64Bytes);
    },
  );
  ipcMain.handle("clear-staged-attachments", (_event, sessionId: string) => {
    clearStagedAttachments(sessionId);
  });

  // File system navigation
  ipcMain.handle("select-folder", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ["openDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

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

  ipcMain.handle("open-file-in-editor", async (_event, filePath: string) => {
    try {
      await shell.openPath(filePath);
      return true;
    } catch {
      return false;
    }
  });

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

  // Claw3D
  ipcMain.handle("claw3d-status", () => getClaw3dStatus());

  ipcMain.handle("claw3d-setup", async (event) => {
    try {
      await setupClaw3d((progress: Claw3dSetupProgress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send("claw3d-setup-progress", progress);
        }
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

  // Python bridge
  ipcMain.handle(
    "python-compress",
    async (_event, text: string, tool?: string) => {
      return pythonCompress(text, tool);
    },
  );

  ipcMain.handle(
    "python-is-path-allowed",
    async (_event, targetPath: string, actionDir: string) => {
      return pythonIsPathAllowed(targetPath, actionDir);
    },
  );

  ipcMain.handle(
    "python-evaluate-execution",
    async (
      _event,
      cmdArgs: string[],
      tier: "readonly" | "supervised" | "full",
      paths: string[],
      actionDir: string,
    ) => {
      return pythonEvaluateExecution(cmdArgs, tier, paths, actionDir);
    },
  );

  ipcMain.handle(
    "python-memory-save",
    async (
      _event,
      vaultDir: string,
      pageId: string,
      metadata: Record<string, unknown>,
      body: string,
    ) => {
      return pythonMemorySave(vaultDir, pageId, metadata, body);
    },
  );

  ipcMain.handle(
    "python-memory-search",
    async (_event, vaultDir: string, query: string) => {
      return pythonMemorySearch(vaultDir, query);
    },
  );

  ipcMain.handle("python-memory-graph", async (_event, vaultDir: string) => {
    return pythonMemoryGraph(vaultDir);
  });

  // Usage stats & cost
  ipcMain.handle("get-usage-stats", (_event, profile?: string) =>
    getUsageStats({ profile }),
  );

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

  ipcMain.handle(
    "summarize-search",
    (_event, query: string, profile?: string) =>
      summarizeSearch(query, profile),
  );

  // Skins
  ipcMain.handle("list-skins", (_event, profile?: string) =>
    listSkins(profile),
  );

  // Security audit & prompt size breakdown
  ipcMain.handle("run-security-audit", (_event, profile?: string) =>
    runSecurityAudit(profile),
  );
  ipcMain.handle("get-prompt-size-breakdown", (_event, profile?: string) =>
    getPromptSizeBreakdown(profile),
  );
}
