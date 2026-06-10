import {
  ipcMain,
  BrowserWindow,
  clipboard,
  shell,
  dialog,
  Menu,
} from "electron";
import { safeHandle } from "./safe-handle";
import { readdir, readFile } from "fs/promises";
import { extname } from "path";
import { readMediaAsDataUrl, saveMedia, mediaFileExists } from "../media";
import { stageAttachment, clearStagedAttachments } from "../attachment-staging";
import {
  pythonCompress,
  pythonIsPathAllowed,
  pythonEvaluateExecution,
  pythonMemorySave,
  pythonMemorySearch,
  pythonMemoryGraph,
} from "../agent-core-bridge";
import { getConnectionConfig, type SshConnectionConfig } from "../config";
import {
  dualHandlerTarget,
  UnsupportedConnectionModeError,
} from "../connection-capabilities";
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

export function registerDualHandler<Args extends unknown[], RetLocal, RetSsh>(
  channel: string,
  localFn: (...args: Args) => Promise<RetLocal> | RetLocal,
  sshFn: (ssh: SshConnectionConfig, ...args: Args) => Promise<RetSsh> | RetSsh,
): void {
  safeHandle(channel, async (_event, ...args: unknown[]) => {
    const conn = getConnectionConfig();
    const target = dualHandlerTarget(conn);
    if (target === "ssh") {
      return sshFn(conn.ssh, ...(args as Args));
    }
    // Remote-URL mode has no implementation for these channels (only local and
    // SSH do). Previously it silently fell through to localFn, returning LOCAL
    // data while connected remotely — a latent correctness bug. Surface it.
    if (target === "remote-unsupported") {
      throw new UnsupportedConnectionModeError(
        "remote",
        `"${channel}" is not available in remote-URL connection mode (this build is local-first; SSH is the supported remote path).`,
      );
    }
    return localFn(...(args as Args));
  });
}

export function registerUtilityIpc(
  _mainWindowGetter: () => BrowserWindow | null,
): void {
  // Shell
  safeHandle("open-external", (_event, url: string) => {
    openExternalUrl(url);
  });

  // Clipboard
  safeHandle("copy-to-clipboard", (_event, text: string) => {
    clipboard.writeText(typeof text === "string" ? text : "");
  });

  // Media
  safeHandle("read-media-file", (_event, filePath: string) =>
    readMediaAsDataUrl(filePath),
  );
  safeHandle("save-media-file", (event, src: string, name: string) =>
    saveMedia(src, name, BrowserWindow.fromWebContents(event.sender)),
  );
  safeHandle("media-file-exists", (_event, filePath: string) =>
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
  safeHandle(
    "stage-attachment",
    (_event, sessionId: string, filename: string, base64Bytes: string) => {
      return stageAttachment(sessionId, filename, base64Bytes);
    },
  );
  safeHandle("clear-staged-attachments", (_event, sessionId: string) => {
    clearStagedAttachments(sessionId);
  });

  // File system navigation
  safeHandle("select-folder", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ["openDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  safeHandle(
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

  safeHandle(
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

  safeHandle("open-file-in-editor", async (_event, filePath: string) => {
    try {
      await shell.openPath(filePath);
      return true;
    } catch {
      return false;
    }
  });

  safeHandle(
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

  // Python bridge
  safeHandle("python-compress", async (_event, text: string, tool?: string) => {
    return pythonCompress(text, tool);
  });

  safeHandle(
    "python-is-path-allowed",
    async (_event, targetPath: string, actionDir: string) => {
      return pythonIsPathAllowed(targetPath, actionDir);
    },
  );

  safeHandle(
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

  safeHandle(
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

  safeHandle(
    "python-memory-search",
    async (_event, vaultDir: string, query: string) => {
      return pythonMemorySearch(vaultDir, query);
    },
  );

  safeHandle("python-memory-graph", async (_event, vaultDir: string) => {
    return pythonMemoryGraph(vaultDir);
  });

  // Usage stats & cost
  safeHandle("get-usage-stats", (_event, profile?: string) =>
    getUsageStats({ profile }),
  );

  safeHandle("get-run-ledger", (_event, profile?: string) => {
    const rows = sessionLedger(readUsageRecords({ profile }));
    const titles = new Map<string, string | null>();
    try {
      for (const s of listSessions(1000, 0)) titles.set(s.id, s.title);
    } catch {
      // no session db (remote/ssh, or not yet created) — leave titles empty
    }
    return rows.map((r) => ({ ...r, title: titles.get(r.sessionId) ?? null }));
  });

  safeHandle("summarize-search", (_event, query: string, profile?: string) =>
    summarizeSearch(query, profile),
  );

  // Skins
  safeHandle("list-skins", (_event, profile?: string) => listSkins(profile));

  // Security audit & prompt size breakdown
  safeHandle("run-security-audit", (_event, profile?: string) =>
    runSecurityAudit(profile),
  );
  safeHandle("get-prompt-size-breakdown", (_event, profile?: string) =>
    getPromptSizeBreakdown(profile),
  );
}
