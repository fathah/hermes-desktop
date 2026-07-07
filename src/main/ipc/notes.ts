import { BrowserWindow, dialog, shell } from "electron";
import { safeHandle } from "./safe-handle";
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
import { classifyTaskCandidate } from "../task-triage";
import { routeTask } from "../task-routing";
import { openContactChannel } from "../contact-messaging";
import { getMacContactsStatus, syncMacContacts } from "../mac-contacts";
import { proposeContactEnrichment } from "../contact-enrichment";
import { createVaultProposal } from "../vault-review-queue";
import { getNagRecord, upsertNagRecord, removeNagRecord } from "../tasks-dump";
import type { RouteTaskInput } from "../../shared/tasks-dump";
import {
  PERSON_FOLDER,
  personRefFrom,
  type ContactChannel,
  type ContactChannelContext,
} from "../../shared/contacts";
import { extractPdfToMarkdown } from "../pdf-extract";
import { formatLogError, log } from "../log";
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
  writeVaultSnapshot,
  writeAssetTo,
  readAssetFrom,
} from "../sps-vault";
import { spsBackupWorkspace } from "../sps-agent";
import { resetWorkspaceWriteQueue } from "../sps-agent/persistence";
import {
  createWorkspaceSnapshot,
  listWorkspaceBackups,
  restoreWorkspaceSnapshot,
} from "../sps-backups";
import { writeAsset, assetExists, gcAssets } from "../sps-assets";
import { requireLocalWorkspace } from "./connection-guards";
import { isAllowedExternalUrl } from "../security";
import { HERMES_HOME } from "../installer/paths";
import { assertGrantedFilePath, grantFilePath } from "../file-access-grants";
import { assertFileWithinByteLimit } from "../file-size-limits";
import {
  recordMirrorFailure,
  readMirrorFailRecord,
} from "../mirror-fail-counter";
import {
  assertIpcString,
  assertPathInside,
  normalizeIpcProfile,
} from "./validate";

// Record one failed vault-mirror write so the silent divergence surfaces in
// Workspace settings. Machine-global (HERMES_HOME) — an operator signal, not
// per-profile accounting. Injected as the onError sink into the sps-vault writes.
function noteMirrorFailure(error: unknown): void {
  recordMirrorFailure(HERMES_HOME, error, Date.now());
}

let obsidianWatcher: Awaited<ReturnType<typeof watchObsidian>> | null = null;
let obsidianWatcherProfile = "";

export async function closeObsidianWatcher(): Promise<void> {
  if (obsidianWatcher) {
    try {
      await obsidianWatcher.close();
    } catch (e) {
      log.error("notes", {
        msg: "failed to close obsidian watcher",
        profile: obsidianWatcherProfile,
        error: formatLogError(e),
      });
    }
    obsidianWatcher = null;
  }
}

function spsVaultDirFor(profile?: unknown): string {
  return resolveSpsVaultDir(normalizeIpcProfile(profile));
}

function openExternalUrl(rawUrl: unknown): void {
  if (!isAllowedExternalUrl(rawUrl) && !isAllowedObsidianExternalUrl(rawUrl)) {
    log.warn("security", {
      msg: "blocked unsafe external URL",
      url: typeof rawUrl === "string" ? rawUrl : undefined,
    });
    return;
  }

  shell.openExternal(rawUrl as string).catch((err) => {
    log.error("security", {
      msg: "failed to open external URL",
      url: rawUrl as string,
      error: formatLogError(err),
    });
  });
}

export function registerNotesIpc(
  mainWindowGetter: () => BrowserWindow | null,
): void {
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
  safeHandle(
    "sps-index-query",
    async (_event, query: NoteQuery, profile?: string) => {
      requireLocalWorkspace();
      return (await getSpsNoteIndex(profile)).query(query ?? {});
    },
  );

  safeHandle(
    "sps-index-search",
    async (_event, text: string, limit?: number, profile?: string) => {
      requireLocalWorkspace();
      return (await getSpsNoteIndex(profile)).search(text, limit ?? 20);
    },
  );

  safeHandle(
    "sps-index-backlinks",
    async (_event, path: string, profile?: string) => {
      requireLocalWorkspace();
      return (await getSpsNoteIndex(profile)).backlinks(path);
    },
  );

  safeHandle(
    "sps-index-backlink-details",
    async (_event, path: string, profile?: string) => {
      requireLocalWorkspace();
      return (await getSpsNoteIndex(profile)).backlinkDetails(path);
    },
  );

  safeHandle(
    "sps-index-unlinked-mentions",
    async (_event, path: string, profile?: string) => {
      requireLocalWorkspace();
      return (await getSpsNoteIndex(profile)).unlinkedMentions(path);
    },
  );

  safeHandle("sps-index-links", async (_event, profile?: string) => {
    requireLocalWorkspace();
    return (await getSpsNoteIndex(profile)).links();
  });

  safeHandle("sps-index-tags", async (_event, profile?: string) => {
    requireLocalWorkspace();
    return (await getSpsNoteIndex(profile)).allTags();
  });

  safeHandle(
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

  safeHandle(
    "sps-index-by-tag",
    async (_event, tag: string, profile?: string) => {
      requireLocalWorkspace();
      return (await getSpsNoteIndex(profile)).notesByTag(tag);
    },
  );

  safeHandle("sps-index-status", async (_event, profile?: string) => {
    requireLocalWorkspace();
    return (await getSpsNoteIndex(profile)).status();
  });

  safeHandle("sps-index-rebuild", async (_event, profile?: string) => {
    requireLocalWorkspace();
    const status = await (await getSpsNoteIndex(profile)).rebuild();
    // Phase 1.7 — tell the renderer the index changed so search/graph/backlink
    // hooks refetch instead of showing stale results until the next manual action.
    mainWindowGetter()?.webContents.send("sps-index-rebuilt", {
      profile,
      status,
    });
    return status;
  });

  // Vault location settings
  safeHandle("sps-get-vault-location", (_event, profile?: unknown) => {
    requireLocalWorkspace();
    return getVaultLocation(normalizeIpcProfile(profile));
  });

  safeHandle(
    "sps-set-vault-location",
    async (_event, dir: unknown, profile?: unknown) => {
      requireLocalWorkspace();
      const result = setVaultLocation(
        assertIpcString(dir, "vault directory"),
        normalizeIpcProfile(profile),
      );
      if (result.ok) await closeAllNoteIndexes();
      return result;
    },
  );

  safeHandle("sps-reset-vault-location", async (_event, profile?: unknown) => {
    requireLocalWorkspace();
    const location = resetVaultLocation(normalizeIpcProfile(profile));
    await closeAllNoteIndexes();
    return location;
  });

  safeHandle("sps-pick-vault-dir", async () => {
    requireLocalWorkspace();
    const res = await dialog.showOpenDialog({
      title: "Choose a folder for the SPS vault",
      properties: ["openDirectory", "createDirectory"],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  // PDF import / text extraction
  safeHandle("sps-pick-pdf", async (event) => {
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
    return grantFilePath(result.filePaths[0]);
  });

  safeHandle("sps-pick-image", async (event) => {
    requireLocalWorkspace();
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts: Electron.OpenDialogOptions = {
      properties: ["openFile"],
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"],
        },
      ],
    };
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return null;
    return grantFilePath(result.filePaths[0]);
  });

  safeHandle("sps-extract-pdf", async (_event, filePath: string) => {
    requireLocalWorkspace();
    return extractPdfToMarkdown(assertGrantedFilePath(filePath));
  });

  safeHandle("sps-read-file-bytes", async (_event, filePath: string) => {
    requireLocalWorkspace();
    const grantedFile = assertGrantedFilePath(filePath);
    assertFileWithinByteLimit(grantedFile);
    const buffer = await readFile(grantedFile);
    return new Uint8Array(buffer);
  });

  // Obsidian
  safeHandle("get-obsidian-config", async (_event, profile?: string) => {
    requireLocalWorkspace();
    return getObsidianConfig(profile);
  });

  safeHandle(
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

  safeHandle("get-obsidian-tree", async (_event, profile?: string) => {
    requireLocalWorkspace();
    await ensureObsidianWatcher(profile);
    return getObsidianTree(profile);
  });

  safeHandle(
    "read-obsidian-file",
    async (_event, path: string, profile?: string) => {
      requireLocalWorkspace();
      await ensureObsidianWatcher(profile);
      return readObsidianFile(path, profile);
    },
  );

  safeHandle(
    "write-obsidian-file",
    async (_event, path: string, content: string, profile?: string) => {
      requireLocalWorkspace();
      await ensureObsidianWatcher(profile);
      return writeObsidianFile(path, content, profile);
    },
  );

  safeHandle(
    "append-obsidian-file",
    async (_event, path: string, content: string, profile?: string) => {
      requireLocalWorkspace();
      await ensureObsidianWatcher(profile);
      return appendObsidianFile(path, content, profile);
    },
  );

  safeHandle(
    "search-obsidian",
    async (_event, query: string, limit?: number, profile?: string) => {
      requireLocalWorkspace();
      return searchObsidian(query, limit ?? 20, profile);
    },
  );

  safeHandle(
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

  safeHandle(
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
  safeHandle(
    "sps-export-page",
    (_event, pageId: unknown, markdown: string, profile?: unknown) => {
      const dir = spsVaultDirFor(profile);
      const safePageId = assertIpcString(pageId, "page id");
      assertPathInside(dir, `${safePageId}.md`, "page id");
      return exportPageMarkdownTo(dir, safePageId, markdown, noteMirrorFailure);
    },
  );

  safeHandle(
    "sps-export-row",
    (
      _event,
      dbFolder: unknown,
      rowId: unknown,
      markdown: string,
      profile?: unknown,
    ) => {
      const dir = spsVaultDirFor(profile);
      const safeDbFolder = assertIpcString(dbFolder, "database folder");
      const safeRowId = assertIpcString(rowId, "row id");
      assertPathInside(
        dir,
        `${safeDbFolder}/${safeRowId}.md`,
        "database row path",
      );
      return exportRowMarkdownTo(
        dir,
        safeDbFolder,
        safeRowId,
        markdown,
        noteMirrorFailure,
      );
    },
  );
  // Classify a captured task (GTD clarify). Never throws — degrades to the
  // human lane assigned to self. (Person-aware assignee matching is wired in a
  // later phase; for now the classifier defaults the assignee to self.)
  safeHandle("sps-classify-task", (_event, text: string, profile?: string) =>
    classifyTaskCandidate(text, { profile }),
  );
  // Organize: dispatch an AI task to Kanban, hold a risky one for review, or
  // schedule the nag engine for a human task.
  safeHandle(
    "sps-route-task",
    (_event, input: RouteTaskInput, profile?: string) =>
      routeTask(input, profile),
  );
  // "Suggest details": propose new reachability fragments + tags for a contact
  // from notes that mention them. Never writes the person row — it lands a
  // proposal in the Review Queue, where the user reviews and applies it.
  safeHandle(
    "sps-propose-contact-enrichment",
    async (_event, personId: string, profile?: string) => {
      requireLocalWorkspace();
      const basename = (p: string): string =>
        p.split("/").pop()?.replace(/\.md$/, "") ?? "";
      const index = await getSpsNoteIndex(profile);
      const rows = index.query({ scope: PERSON_FOLDER });
      const row = rows.find((r) => basename(r.path) === personId);
      if (!row) return { created: false, reason: "not-found" };
      const person = personRefFrom(
        personId,
        row.title,
        row.props as Record<string, unknown>,
      );
      const queries = [person.name, ...(person.aliases ?? [])].filter(Boolean);
      const seen = new Set<string>();
      const snippets: string[] = [];
      for (const q of queries) {
        for (const hit of index.search(q, 6)) {
          if (hit.path === row.path || !hit.snippet) continue;
          const clean = hit.snippet.replace(/[⟦⟧]/g, "").trim();
          if (!clean || seen.has(clean)) continue;
          seen.add(clean);
          snippets.push(clean);
        }
      }
      if (!snippets.length) return { created: false, reason: "no-context" };
      const proposed = await proposeContactEnrichment(
        person,
        snippets.slice(0, 12),
        profile,
      );
      if (!proposed.fragments.length && !proposed.tags.length) {
        return { created: false, reason: "nothing-new" };
      }
      const proposal = await createVaultProposal(
        {
          source: "enrichment",
          title: `Enrich ${person.name}`,
          summary: `Suggested ${proposed.fragments.length} fragment(s) and ${proposed.tags.length} tag(s) for ${person.name}.`,
          operations: [
            {
              id: "op_1",
              kind: "enrich-contact",
              pageId: `${PERSON_FOLDER}/${personId}`,
              personName: person.name,
              fragments: proposed.fragments,
              tags: proposed.tags,
            },
          ],
        },
        profile,
      );
      return {
        created: true,
        proposalId: proposal.id,
        fragments: proposed.fragments.length,
        tags: proposed.tags.length,
      };
    },
  );
  // Nag snooze/ack: let the user read and quiet a human task's reminders. The
  // engine already honors snoozedUntil (isNagDue); ack removes the record so it
  // stops nagging entirely (the task row itself is untouched).
  safeHandle("sps-nag-get", (_event, rowId: string, profile?: string) =>
    getNagRecord(rowId, profile),
  );
  safeHandle(
    "sps-nag-snooze",
    (_event, rowId: string, snoozedUntil: number, profile?: string) =>
      upsertNagRecord(rowId, { snoozedUntil }, profile),
  );
  safeHandle("sps-nag-ack", (_event, rowId: string, profile?: string) =>
    removeNagRecord(rowId, profile),
  );
  // Hand off to the native app (Mail/Messages/WhatsApp) for a contact channel.
  safeHandle(
    "sps-open-contact-channel",
    (
      _event,
      channel: ContactChannel,
      context?: ContactChannelContext,
      profile?: string,
    ) => openContactChannel(channel, undefined, context, profile),
  );
  // Mac/iPhone contacts sync (optional native module; degrades if absent).
  safeHandle("mac-contacts-status", () => getMacContactsStatus());
  safeHandle("mac-contacts-sync", (_event, profile?: string) =>
    syncMacContacts(profile),
  );
  safeHandle(
    "sps-read-row",
    (_event, dbFolder: unknown, rowId: unknown, profile?: unknown) => {
      const dir = spsVaultDirFor(profile);
      const safeDbFolder = assertIpcString(dbFolder, "database folder");
      const safeRowId = assertIpcString(rowId, "row id");
      assertPathInside(
        dir,
        `${safeDbFolder}/${safeRowId}.md`,
        "database row path",
      );
      return readRowMarkdownFrom(dir, safeDbFolder, safeRowId);
    },
  );
  safeHandle(
    "sps-delete-row",
    (_event, dbFolder: unknown, rowId: unknown, profile?: unknown) => {
      const dir = spsVaultDirFor(profile);
      const safeDbFolder = assertIpcString(dbFolder, "database folder");
      const safeRowId = assertIpcString(rowId, "row id");
      assertPathInside(
        dir,
        `${safeDbFolder}/${safeRowId}.md`,
        "database row path",
      );
      return deleteRowIn(dir, safeDbFolder, safeRowId);
    },
  );

  safeHandle(
    "sps-delete-page",
    (_event, pageId: unknown, profile?: unknown) => {
      const dir = spsVaultDirFor(profile);
      const safePageId = assertIpcString(pageId, "page id");
      assertPathInside(dir, `${safePageId}.md`, "page id");
      return deletePageIn(dir, safePageId);
    },
  );

  safeHandle(
    "sps-delete-db-folder",
    (_event, dbFolder: unknown, profile?: unknown) => {
      const dir = spsVaultDirFor(profile);
      const safeDbFolder = assertIpcString(dbFolder, "database folder");
      assertPathInside(dir, safeDbFolder, "database folder");
      return deleteDbFolderIn(dir, safeDbFolder);
    },
  );

  // Vault-as-authoritative-store manifest and backup
  const spsVaultDir = (profile?: unknown): string => spsVaultDirFor(profile);
  safeHandle("sps-vault-read", async (_event, profile?: unknown) => {
    const dir = spsVaultDir(profile);
    const [pages, manifest] = await Promise.all([
      readVaultPages(dir),
      readVaultManifest(dir),
    ]);
    return { pages, manifest };
  });
  safeHandle(
    "sps-vault-write-manifest",
    (_event, json: string, profile?: unknown) =>
      writeVaultManifest(spsVaultDir(profile), json, noteMirrorFailure),
  );
  safeHandle(
    "sps-vault-write-snapshot",
    (
      _event,
      snapshot: { pages: Record<string, string>; manifest: string },
      profile?: unknown,
    ) => writeVaultSnapshot(spsVaultDir(profile), snapshot, noteMirrorFailure),
  );
  safeHandle("sps-backup-workspace", (_event, profile?: unknown) =>
    spsBackupWorkspace(normalizeIpcProfile(profile)),
  );

  // MED-11 — whole-workspace snapshot & restore (workspace.json + vault
  // markdown + _manifest.json; the derived .note-index.db is never included).
  safeHandle("sps-list-backups", (_event, profile?: unknown) =>
    listWorkspaceBackups(normalizeIpcProfile(profile)),
  );
  safeHandle("sps-create-backup", (_event, profile?: unknown) =>
    createWorkspaceSnapshot(normalizeIpcProfile(profile)),
  );
  safeHandle(
    "sps-restore-backup",
    async (_event, id: unknown, profile?: unknown) => {
      requireLocalWorkspace();
      const p = normalizeIpcProfile(profile);
      const result = await restoreWorkspaceSnapshot(String(id ?? ""), p);
      if (result.ok) {
        // The in-memory write queue tracks the pre-restore revision — drop it
        // so a late autosave can't clobber the restored blob.
        resetWorkspaceWriteQueue(p);
        const status = await (await getSpsNoteIndex(p)).rebuild();
        mainWindowGetter()?.webContents.send("sps-index-rebuilt", {
          profile: p,
          status,
        });
      }
      return result;
    },
  );

  // How many vault-mirror writes have silently failed (markdown drifting from the
  // authoritative blob). Read-only observability for the Workspace settings panel.
  safeHandle("sps-get-mirror-fail-count", () =>
    readMirrorFailRecord(HERMES_HOME),
  );

  // Excalidraw
  safeHandle(
    "sps-write-excalidraw",
    async (
      _event,
      pageId: unknown,
      assetId: unknown,
      sceneJson: string,
      svg: string,
      profile?: unknown,
    ) => {
      const dir = spsVaultDir(profile);
      const safePageId = assertIpcString(pageId, "page id");
      const safeAssetId = assertIpcString(assetId, "asset id");
      assertPathInside(
        dir,
        `assets/${safePageId}/${safeAssetId}.excalidraw`,
        "asset path",
      );
      const okScene = await writeAssetTo(
        dir,
        safePageId,
        `${safeAssetId}.excalidraw`,
        sceneJson,
        noteMirrorFailure,
      );
      const okSvg = await writeAssetTo(
        dir,
        safePageId,
        `${safeAssetId}.excalidraw.svg`,
        svg,
        noteMirrorFailure,
      );
      return okScene && okSvg;
    },
  );
  safeHandle(
    "sps-read-excalidraw",
    async (_event, pageId: unknown, assetId: unknown, profile?: unknown) => {
      const dir = spsVaultDir(profile);
      const safePageId = assertIpcString(pageId, "page id");
      const safeAssetId = assertIpcString(assetId, "asset id");
      assertPathInside(
        dir,
        `assets/${safePageId}/${safeAssetId}.excalidraw`,
        "asset path",
      );
      const [scene, svg] = await Promise.all([
        readAssetFrom(dir, safePageId, `${safeAssetId}.excalidraw`),
        readAssetFrom(dir, safePageId, `${safeAssetId}.excalidraw.svg`),
      ]);
      return { scene, svg };
    },
  );

  // Assets Write / GC
  safeHandle(
    "sps-asset-write",
    (_event, bytes: Uint8Array, ext: unknown, profile?: unknown) =>
      writeAsset(
        spsVaultDirFor(profile),
        Buffer.from(bytes),
        assertIpcString(ext, "asset extension"),
      ),
  );
  safeHandle("sps-asset-exists", (_event, name: unknown, profile?: unknown) => {
    const dir = spsVaultDirFor(profile);
    const safeName = assertIpcString(name, "asset name");
    assertPathInside(dir, `_assets/${safeName}`, "asset name");
    return assetExists(dir, safeName);
  });
  safeHandle(
    "sps-asset-gc",
    (_event, referenced: unknown[], profile?: unknown) => {
      const dir = spsVaultDirFor(profile);
      const safeReferenced = referenced.map((name) => {
        const safeName = assertIpcString(name, "asset name");
        assertPathInside(dir, `_assets/${safeName}`, "asset name");
        return safeName;
      });
      return gcAssets(dir, safeReferenced);
    },
  );

  // Semantic Graph / txtai Integration
  safeHandle("sps-semantic-index", async (_event, profile?: unknown) => {
    requireLocalWorkspace();
    const vaultPath = spsVaultDirFor(profile);
    return semanticManager.index(vaultPath);
  });

  safeHandle(
    "sps-semantic-search",
    async (_event, query: string, limit?: number) => {
      requireLocalWorkspace();
      return semanticManager.search(query, limit);
    },
  );

  safeHandle("sps-semantic-graph", async () => {
    requireLocalWorkspace();
    return semanticManager.graph();
  });

  safeHandle(
    "sps-semantic-rag",
    async (_event, query: string, limit?: number) => {
      requireLocalWorkspace();
      return semanticManager.rag(query, limit);
    },
  );
}
