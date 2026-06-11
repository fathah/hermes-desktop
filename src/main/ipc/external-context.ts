/**
 * IPC surface for the External Context Bridge. Owns:
 *  - the per-source toggles (desktop-store, default all OFF),
 *  - gathering the app's KNOWN secrets (api-server key, remote bearer, env
 *    values) once per scan and handing them to the redacting writer,
 *  - driving scans (manual + app-start + 15-min interval) and forwarding
 *    progress to the renderer,
 *  - read handlers (status / search / get-conversation / list-projects).
 *
 * Save-to-KB (commit 6) and MCP registration (commit 7) add their handlers here.
 */
import { BrowserWindow, dialog } from "electron";
import { safeHandle } from "./safe-handle";
import type {
  ExternalImportResult,
  ExternalImportSource,
  ExternalIndexStatus,
  ExternalScanProgress,
  ExternalSource,
} from "../../shared/external-context";
import {
  EXTERNAL_IMPORT_SOURCES,
  formatProvenance,
} from "../../shared/external-context";
import { spsExternalSaveToKb } from "../sps-agent";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join as joinPath } from "path";
import { extractImportPayload } from "../external-context/import-extract";
import { copyExportToImportRoot } from "../external-context/import-roots";
import {
  externalContextMcpServerPath,
  hasMcpServer,
  writeMcpServerEntry,
} from "../installer/mcp";
import { externalDbPath } from "../external-context/index";
import {
  getExternalContextSources,
  setExternalContextSource,
  getExternalContextMaxAgeDays,
  setExternalContextMaxAgeDays,
} from "../config/desktop-store";
import { getApiServerKey } from "../config/api-server-key";
import { readEnv } from "../config/env-store";
import { getRemoteAuthHeader } from "../hermes/gateway-process";
import {
  ensureImportRootEnv,
  getExternalContextDb,
  isScanning,
  scanExternalSources,
  sourceAvailability,
} from "../external-context/index";

/** App start delay before the first background backfill (let the UI settle). */
const STARTUP_SCAN_DELAY_MS = 10_000;
/** Periodic re-scan cadence while the app is open. */
const SCAN_INTERVAL_MS = 15 * 60_000;

/**
 * Gather the exact secret strings the app already holds, so the redactor can
 * strip them from external transcripts even if they don't match a known shape.
 */
function gatherKnownSecrets(): string[] {
  const secrets: string[] = [];
  try {
    const apiKey = getApiServerKey();
    if (apiKey) secrets.push(apiKey);
  } catch {
    /* no key configured */
  }
  try {
    const auth = getRemoteAuthHeader().Authorization;
    const match = auth?.match(/^Bearer\s+(.+)$/);
    if (match?.[1]) secrets.push(match[1]);
  } catch {
    /* no remote auth */
  }
  try {
    for (const value of Object.values(readEnv())) {
      if (typeof value === "string" && value.trim().length > 8)
        secrets.push(value);
    }
  } catch {
    /* no env store */
  }
  return secrets;
}

const MS_PER_DAY = 86_400_000;

function buildStatus(): ExternalIndexStatus {
  const db = getExternalContextDb();
  const enabled = getExternalContextSources();
  const available = sourceAvailability();
  const totals = db.totals();
  return {
    sources: db.buildSourceStatuses(enabled, available),
    totalConversations: totals.conversations,
    totalMessages: totals.messages,
    lastScanAt: lastScanAt,
    scanning: isScanning(),
    maxAgeDays: getExternalContextMaxAgeDays(),
  };
}

let lastScanAt: number | null = null;

/** Run a scan over the currently-enabled sources, forwarding progress. The
 *  date-filter (if set) caps backfill to sessions newer than N days. */
async function runScan(getWindow: () => BrowserWindow | null): Promise<number> {
  const db = getExternalContextDb();
  const enabled = getExternalContextSources();
  const secrets = gatherKnownSecrets();
  const maxAgeDays = getExternalContextMaxAgeDays();
  const olderThanMs = maxAgeDays ? maxAgeDays * MS_PER_DAY : undefined;
  const onProgress = (progress: ExternalScanProgress): void => {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("external-context-progress", progress);
    }
  };
  const indexed = await scanExternalSources(
    db,
    enabled,
    secrets,
    onProgress,
    olderThanMs,
  );
  lastScanAt = Date.now();
  return indexed;
}

export function registerExternalContextIpc(
  getWindow: () => BrowserWindow | null,
): void {
  safeHandle("external-context-get-config", () => getExternalContextSources());

  safeHandle(
    "external-context-set-source",
    async (_e, source: ExternalSource, enabled: boolean) => {
      const cfg = setExternalContextSource(source, enabled);
      if (enabled) {
        // Backfill the newly-enabled source immediately.
        void runScan(getWindow);
      } else {
        // Disabling a source purges its indexed content.
        getExternalContextDb().purgeSource(source);
      }
      return cfg;
    },
  );

  safeHandle("external-context-status", () => buildStatus());

  safeHandle("external-context-scan", async () => {
    await runScan(getWindow);
    return buildStatus();
  });

  safeHandle("external-context-rebuild", async () => {
    getExternalContextDb().rebuild();
    await runScan(getWindow);
    return buildStatus();
  });

  // Native file picker for the Import drop-zone (zip / json / jsonl).
  safeHandle("external-context-pick-file", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts: Electron.OpenDialogOptions = {
      properties: ["openFile"],
      filters: [
        { name: "Conversation export", extensions: ["zip", "json", "jsonl"] },
        { name: "All files", extensions: ["*"] },
      ],
    };
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Import a user-supplied export artifact: extract (if a ZIP) → content-hash
  // copy into the source's import root → enable the source → scan (redaction +
  // idempotency via the standard pipeline) → return the source's totals. The
  // CPU-bound parse runs on the main thread (matching the live `gemini`
  // whole-file source); the renderer stays responsive because IPC is async. A
  // worker_thread offload for pathologically-large exports is deferred hardening.
  safeHandle(
    "external-context-import-file",
    async (_e, source: ExternalImportSource, filePath: string) => {
      if (!(EXTERNAL_IMPORT_SOURCES as readonly string[]).includes(source)) {
        throw new Error(`not an import source: ${String(source)}`);
      }
      if (typeof filePath !== "string" || filePath.length === 0) {
        throw new Error("an import file path is required");
      }
      ensureImportRootEnv();
      const win = getWindow();
      const emit = (
        phase: ExternalScanProgress["phase"],
        message?: string,
      ): void => {
        if (win && !win.isDestroyed()) {
          win.webContents.send("external-context-progress", {
            source,
            phase,
            filesProcessed: 0,
            filesTotal: 1,
            messagesIndexed: 0,
            message,
          } satisfies ExternalScanProgress);
        }
      };

      emit("start", "Reading export…");
      const tmp = mkdtempSync(joinPath(tmpdir(), "ec-import-"));
      try {
        const { payloadPath } = extractImportPayload(source, filePath, tmp);
        const staged = copyExportToImportRoot(source, payloadPath);
        // Enable so the source participates in scans + search + digests.
        setExternalContextSource(source, true);
        emit("scanning", "Indexing…");
        await runScan(getWindow);
        const stats = getExternalContextDb().sourceStats()[source];
        emit("done");
        return {
          status: buildStatus(),
          source,
          reused: staged.reused,
          conversations: stats.conversations,
          messages: stats.messages,
        } satisfies ExternalImportResult;
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },
  );

  safeHandle(
    "external-context-set-max-age",
    async (_e, days: number | null) => {
      setExternalContextMaxAgeDays(days);
      // Rebuild so a tightened window also DROPS now-excluded sessions (a scan
      // alone only adds). Loosening then re-adds them on the same pass.
      getExternalContextDb().rebuild();
      await runScan(getWindow);
      return buildStatus();
    },
  );

  safeHandle(
    "external-context-search",
    (
      _e,
      query: string,
      opts?: { source?: ExternalSource; project?: string; limit?: number },
    ) => getExternalContextDb().search(query, opts ?? {}),
  );

  safeHandle(
    "external-context-get-conversation",
    (_e, convId: string, opts?: { aroundSeq?: number; limit?: number }) => {
      const db = getExternalContextDb();
      return {
        meta: db.getConversationMeta(convId),
        messages: db.getConversation(convId, opts ?? {}),
      };
    },
  );

  safeHandle("external-context-list-projects", (_e, source?: ExternalSource) =>
    getExternalContextDb().listProjects(source),
  );

  safeHandle(
    "external-context-save-to-kb",
    async (_e, convId: string, profile?: string) => {
      const db = getExternalContextDb();
      const meta = db.getConversationMeta(convId);
      if (!meta) {
        return { ok: false, captureCount: 0, error: "Session not found." };
      }
      const provenance = formatProvenance({
        source: meta.source,
        projectPath: meta.projectPath,
        gitBranch: meta.gitBranch,
        title: meta.title,
        ts: meta.lastAt ?? meta.startedAt,
      });
      const messages = db.getConversation(convId, { limit: 1000 });
      const transcript = capExternalTranscript(
        messages.map((m) => `**${m.role}:** ${m.text}`).join("\n\n"),
      );
      return spsExternalSaveToKb(provenance, transcript, profile);
    },
  );

  safeHandle("external-context-ensure-mcp", (_e, profile?: string) =>
    ensureExternalContextMcpRegistered(profile),
  );
}

/**
 * Register the external-context stdio MCP server into the profile's config.yaml
 * so the Hermes agent can search external transcripts itself (idempotent). Twin
 * of ensureResearchMcpRegistered. The server opens the machine-global index
 * read-only via HERMES_EXTERNAL_CONTEXT_DB.
 */
export function ensureExternalContextMcpRegistered(profile?: string): {
  registered: boolean;
  alreadyPresent: boolean;
} {
  const name = "external-context";
  if (hasMcpServer(name, profile)) {
    return { registered: true, alreadyPresent: true };
  }
  const serverPath = externalContextMcpServerPath();
  if (!existsSync(serverPath)) {
    return { registered: false, alreadyPresent: false };
  }
  const env: Record<string, string> = {
    ELECTRON_RUN_AS_NODE: "1",
    HERMES_EXTERNAL_CONTEXT_DB: externalDbPath(),
  };
  writeMcpServerEntry(
    name,
    { command: process.execPath, args: [serverPath], env, enabled: true },
    profile,
  );
  return { registered: true, alreadyPresent: false };
}

/** Head+tail cap so a long session can't blow the synthesis pass's context. */
function capExternalTranscript(text: string): string {
  const LIMIT = 24_000;
  if (text.length <= LIMIT) return text;
  const head = text.slice(0, 16_000);
  const tail = text.slice(-8_000);
  return `${head}\n\n…[transcript truncated]…\n\n${tail}`;
}

/** Schedule the app-start backfill and the periodic re-scan (idempotent). */
let scanTimers: { startup: NodeJS.Timeout; interval: NodeJS.Timeout } | null =
  null;

export function scheduleExternalContextScans(
  getWindow: () => BrowserWindow | null,
): void {
  if (scanTimers) return;
  const startup = setTimeout(() => {
    const enabled = getExternalContextSources();
    const anyOn = Object.values(enabled).some(Boolean);
    if (anyOn) void runScan(getWindow);
  }, STARTUP_SCAN_DELAY_MS);
  const interval = setInterval(() => {
    const enabled = getExternalContextSources();
    const anyOn = Object.values(enabled).some(Boolean);
    if (anyOn) void runScan(getWindow);
  }, SCAN_INTERVAL_MS);
  startup.unref?.();
  interval.unref?.();
  scanTimers = { startup, interval };
}

export function stopExternalContextScans(): void {
  if (!scanTimers) return;
  clearTimeout(scanTimers.startup);
  clearInterval(scanTimers.interval);
  scanTimers = null;
}
