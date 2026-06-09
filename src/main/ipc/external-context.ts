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
import { ipcMain, type BrowserWindow } from "electron";
import type {
  ExternalIndexStatus,
  ExternalScanProgress,
  ExternalSource,
} from "../../shared/external-context";
import {
  getExternalContextSources,
  setExternalContextSource,
} from "../config/desktop-store";
import { getApiServerKey } from "../config/api-server-key";
import { readEnv } from "../config/env-store";
import { getRemoteAuthHeader } from "../hermes/gateway-process";
import {
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
  };
}

let lastScanAt: number | null = null;

/** Run a scan over the currently-enabled sources, forwarding progress. */
async function runScan(getWindow: () => BrowserWindow | null): Promise<number> {
  const db = getExternalContextDb();
  const enabled = getExternalContextSources();
  const secrets = gatherKnownSecrets();
  const onProgress = (progress: ExternalScanProgress): void => {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("external-context-progress", progress);
    }
  };
  const indexed = await scanExternalSources(db, enabled, secrets, onProgress);
  lastScanAt = Date.now();
  return indexed;
}

export function registerExternalContextIpc(
  getWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle("external-context-get-config", () =>
    getExternalContextSources(),
  );

  ipcMain.handle(
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

  ipcMain.handle("external-context-status", () => buildStatus());

  ipcMain.handle("external-context-scan", async () => {
    await runScan(getWindow);
    return buildStatus();
  });

  ipcMain.handle("external-context-rebuild", async () => {
    getExternalContextDb().rebuild();
    await runScan(getWindow);
    return buildStatus();
  });

  ipcMain.handle(
    "external-context-search",
    (
      _e,
      query: string,
      opts?: { source?: ExternalSource; project?: string; limit?: number },
    ) => getExternalContextDb().search(query, opts ?? {}),
  );

  ipcMain.handle(
    "external-context-get-conversation",
    (_e, convId: string, opts?: { aroundSeq?: number; limit?: number }) => {
      const db = getExternalContextDb();
      return {
        meta: db.getConversationMeta(convId),
        messages: db.getConversation(convId, opts ?? {}),
      };
    },
  );

  ipcMain.handle(
    "external-context-list-projects",
    (_e, source?: ExternalSource) =>
      getExternalContextDb().listProjects(source),
  );
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
