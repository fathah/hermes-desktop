import { ipcMain, BrowserWindow, dialog, shell } from "electron";
import { readFile } from "fs/promises";
import {
  getSpsNoteIndex,
  closeAllNoteIndexes,
  type NoteQuery,
} from "../note-index";
import {
  getVaultLocation,
  setVaultLocation,
  resetVaultLocation,
  resolveSpsVaultDir,
} from "../sps-storage";
import { semanticManager } from "../semantic-index";
import { extractPdfToMarkdown } from "../pdf-extract";
import {
  getObsidianConfig,
  setObsidianConfig,
  getObsidianTree,
  readObsidianFile,
  writeObsidianFile,
  appendObsidianFile,
  searchObsidian,
  buildObsidianOpenUri,
  callObsidianFunction,
  watchObsidian,
  isAllowedObsidianExternalUrl,
  type ObsidianConfigInput,
  type ObsidianFunctionName,
} from "../obsidian";
import {
  exportPageMarkdownTo,
  exportRowMarkdownTo,
  readRowMarkdownFrom,
  deleteRowIn,
  deletePageIn,
  deleteDbFolderIn,
  readVaultPages,
  readVaultManifest,
  writeVaultManifest,
  writeAssetTo,
  readAssetFrom,
} from "../sps-vault";
import { spsBackupWorkspace } from "../sps-agent";
import { writeAsset, assetExists, gcAssets } from "../sps-assets";
import { getConnectionConfig } from "../config";
import { isAllowedExternalUrl } from "../security";

let obsidianWatcher: Awaited<ReturnType<typeof watchObsidian>> | null = null;
let obsidianWatcherProfile = "";

export async function closeObsidianWatcher(): Promise<void> {
  if (obsidianWatcher) {
    try {
      await obsidianWatcher.close();
    } catch (e) {
      console.error("[notes] Failed to close obsidian watcher:", e);
    }
    obsidianWatcher = null;
  }
}

function requireLocalWorkspace(): void {
  const conn = getConnectionConfig();
  if (conn.mode !== "local") {
    throw new Error(
      "Workspace files are only available in local mode in this version.",
    );
  }
}

function spsVaultDirFor(profile?: string): string {
  return resolveSpsVaultDir(profile);
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

export function registerNotesIpc(mainWindowGetter: () => BrowserWindow | null): void {
  async function ensureObsidianWatcher(profile?: string): Promise<void> {
    const profileKey = profile || "";
    if (obsidianWatcher && obsidianWatcherProfile === profileKey) return;
    if (obsidianWatcher) {
      await obsidianWatcher.close();
      obsidianWatcher = null;
    }
    obsidianWatcherProfile = profileKey;
    obsidianWatcher = await watchObsidian(profile, (payload) => {
      mainWindowGetter()?.webContents.send("obsidian-file-changed", payload);
    });
  }

  // SPS Vault note index
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

  ipcMain.handle("sps-index-links", async (_event, profile?: string) => {
    requireLocalWorkspace();
    return (await getSpsNoteIndex(profile)).links();
  });

  ipcMain.handle("sps-index-tags", async (_event, profile?: string) => {
    requireLocalWorkspace();
    return (await getSpsNoteIndex(profile)).allTags();
  });

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

  // Vault location settings
  ipcMain.handle("sps-get-vault-location", (_event, profile?: string) => {
    requireLocalWorkspace();
    return getVaultLocation(profile);
  });

  ipcMain.handle(
    "sps-set-vault-location",
    async (_event, dir: string, profile?: string) => {
      requireLocalWorkspace();
      const result = setVaultLocation(dir, profile);
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

  ipcMain.handle("sps-pick-vault-dir", async () => {
    requireLocalWorkspace();
    const res = await dialog.showOpenDialog({
      title: "Choose a folder for the SPS vault",
      properties: ["openDirectory", "createDirectory"],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  // PDF import / text extraction
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

  ipcMain.handle("sps-extract-pdf", async (_event, filePath: string) => {
    requireLocalWorkspace();
    return extractPdfToMarkdown(filePath);
  });

  ipcMain.handle("sps-read-file-bytes", async (_event, filePath: string) => {
    requireLocalWorkspace();
    const buffer = await readFile(filePath);
    return new Uint8Array(buffer);
  });

  // Obsidian
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

  // Markdown pages export
  ipcMain.handle(
    "sps-export-page",
    (_event, pageId: string, markdown: string, profile?: string) => {
      const dir = spsVaultDirFor(profile);
      return exportPageMarkdownTo(dir, pageId, markdown);
    },
  );

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

  ipcMain.handle(
    "sps-delete-page",
    (_event, pageId: string, profile?: string) => {
      const dir = spsVaultDirFor(profile);
      return deletePageIn(dir, pageId);
    },
  );

  ipcMain.handle(
    "sps-delete-db-folder",
    (_event, dbFolder: string, profile?: string) => {
      const dir = spsVaultDirFor(profile);
      return deleteDbFolderIn(dir, dbFolder);
    },
  );

  // Vault-as-authoritative-store manifest and backup
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

  // Excalidraw
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

  // Assets Write / GC
  ipcMain.handle(
    "sps-asset-write",
    (_event, bytes: Uint8Array, ext: string, profile?: string) =>
      writeAsset(spsVaultDirFor(profile), Buffer.from(bytes), ext),
  );
  ipcMain.handle("sps-asset-exists", (_event, name: string, profile?: string) =>
    assetExists(spsVaultDirFor(profile), name),
  );
  ipcMain.handle(
    "sps-asset-gc",
    (_event, referenced: string[], profile?: string) =>
      gcAssets(spsVaultDirFor(profile), referenced),
  );

  // Semantic Graph / txtai Integration
  ipcMain.handle("sps-semantic-index", async (_event, profile?: string) => {
    requireLocalWorkspace();
    const vaultPath = spsVaultDirFor(profile);
    return semanticManager.index(vaultPath);
  });

  ipcMain.handle(
    "sps-semantic-search",
    async (_event, query: string, limit?: number) => {
      requireLocalWorkspace();
      return semanticManager.search(query, limit);
    },
  );

  ipcMain.handle("sps-semantic-graph", async () => {
    requireLocalWorkspace();
    return semanticManager.graph();
  });

  ipcMain.handle(
    "sps-semantic-rag",
    async (_event, query: string, limit?: number) => {
      requireLocalWorkspace();
      return semanticManager.rag(query, limit);
    },
  );
}
