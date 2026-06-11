/**
 * External Context orchestrator — owns the lazy DB singleton and the incremental
 * scan loop that drives the source adapters into {@link ExternalContextDb}.
 *
 * Scan triggers (wired by the IPC layer): enable-source backfill, app start,
 * a periodic interval, modal-open staleness, and manual Scan/Rebuild. The scan
 * is single-flight (module-level guard) and yields to the event loop between
 * chunks so a multi-GB backfill never blocks the main process.
 */
import { join } from "path";
import { getHermesHome } from "../config/env-store";
import type {
  ExternalScanProgress,
  ExternalSource,
} from "../../shared/external-context";
import { EXTERNAL_SOURCES } from "../../shared/external-context";
import { ExternalContextDb } from "./db";
import { ALL_ADAPTERS } from "./adapters";
import { decideFileAction } from "./scan-logic";

/** Yield to the event loop after this many files so the UI stays responsive. */
const CHUNK_SIZE = 25;

export type ProgressFn = (progress: ExternalScanProgress) => void;

/** Resolve the machine-global index path (sources aren't per-profile). */
export function externalDbPath(): string {
  return (
    process.env.HERMES_EXTERNAL_CONTEXT_DB ||
    join(getHermesHome(), "external-context.db")
  );
}

let dbInstance: ExternalContextDb | null = null;

export function getExternalContextDb(): ExternalContextDb {
  if (!dbInstance) {
    dbInstance = new ExternalContextDb(externalDbPath());
  }
  return dbInstance;
}

export function closeExternalContextDb(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      /* best-effort */
    }
    dbInstance = null;
  }
}

/** Availability of each source's root directory on this machine. Import sources
 *  with no adapter yet report false (their data arrives via the Import flow). */
export function sourceAvailability(): Record<ExternalSource, boolean> {
  const out = {} as Record<ExternalSource, boolean>;
  for (const source of EXTERNAL_SOURCES) {
    out[source] = false;
  }
  for (const adapter of ALL_ADAPTERS) {
    out[adapter.source] = adapter.available();
  }
  return out;
}

let scanning = false;

/** Whether a scan is currently in flight (single-flight guard for the UI). */
export function isScanning(): boolean {
  return scanning;
}

/**
 * Bridge the authoritative (electron-resolved) Hermes home into the env the
 * PURE import adapters read, so a scan looks in the SAME directory the import
 * IPC copies exports to — even when the user set a custom HERMES_HOME. Idempotent
 * and only sets the var when unset (tests/smoke pin it themselves).
 */
export function ensureImportRootEnv(): void {
  if (!process.env.HERMES_EC_IMPORT_ROOT) {
    process.env.HERMES_EC_IMPORT_ROOT = join(
      getHermesHome(),
      "external-imports",
    );
  }
}

const yieldToLoop = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

/**
 * Scan the enabled+available sources into `db`, redacting with `knownSecrets`.
 * Returns the number of messages indexed this pass. Single-flight: a second
 * concurrent call returns 0 immediately.
 */
export async function scanExternalSources(
  db: ExternalContextDb,
  enabled: Record<ExternalSource, boolean>,
  knownSecrets: readonly string[],
  onProgress?: ProgressFn,
  olderThanMs?: number,
): Promise<number> {
  if (scanning) return 0;
  scanning = true;
  ensureImportRootEnv();
  let messagesIndexed = 0;
  try {
    onProgress?.({
      source: null,
      phase: "start",
      filesProcessed: 0,
      filesTotal: 0,
      messagesIndexed: 0,
    });

    for (const adapter of ALL_ADAPTERS) {
      const source = adapter.source;
      if (!enabled[source] || !adapter.available()) continue;

      let files: Awaited<ReturnType<typeof adapter.discoverFiles>>;
      try {
        files = await adapter.discoverFiles();
      } catch {
        onProgress?.({
          source,
          phase: "error",
          filesProcessed: 0,
          filesTotal: 0,
          messagesIndexed,
          message: `failed to enumerate ${source}`,
        });
        continue;
      }

      const records = db.fileRecords();
      const discoveredPaths = new Set(files.map((f) => f.absPath));
      let filesProcessed = 0;

      for (const file of files) {
        const action = decideFileAction(
          file,
          records.get(file.absPath),
          olderThanMs,
        );
        if (action.kind === "parse") {
          try {
            const result = await adapter.parseSlice(file, action.fromOffset);
            const replace = action.reparse || file.strategy === "replace";
            db.applyFragments(file, result, knownSecrets, replace);
            messagesIndexed += result.messages.length;
          } catch {
            /* one bad file must not abort the whole source */
          }
        }
        filesProcessed += 1;
        if (filesProcessed % CHUNK_SIZE === 0) {
          onProgress?.({
            source,
            phase: "scanning",
            filesProcessed,
            filesTotal: files.length,
            messagesIndexed,
          });
          await yieldToLoop();
        }
      }

      // Drop cursors for files that have vanished since the last scan.
      db.dropMissingFiles(source, discoveredPaths);

      onProgress?.({
        source,
        phase: "scanning",
        filesProcessed: files.length,
        filesTotal: files.length,
        messagesIndexed,
      });
    }

    onProgress?.({
      source: null,
      phase: "done",
      filesProcessed: 0,
      filesTotal: 0,
      messagesIndexed,
    });
    return messagesIndexed;
  } finally {
    scanning = false;
  }
}
