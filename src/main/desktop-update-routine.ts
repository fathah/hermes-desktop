import {
  getDesktopUpdateRoutine,
  isDesktopUpdateRoutineDue,
  recordDesktopUpdateRoutineResult,
  type DesktopUpdateRoutineResult,
} from "./config";

interface UpdateCheckResult {
  updateInfo?: {
    version?: unknown;
    releaseNotes?: unknown;
  } | null;
}

interface DesktopAutoUpdater {
  autoDownload?: boolean;
  checkForUpdates: () => Promise<UpdateCheckResult | null>;
  downloadUpdate: () => Promise<unknown>;
}

export interface DesktopUpdateRoutineDeps {
  isPackaged: boolean;
  isPortable: boolean;
  platform: NodeJS.Platform | string;
  checkForUpdates?: () => Promise<UpdateCheckResult | null>;
  downloadUpdate?: () => Promise<unknown>;
}

export interface DesktopUpdateCheckOptions {
  now?: Date;
  autoDownload?: boolean;
  deps?: DesktopUpdateRoutineDeps;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function normalizeReleaseNotes(notes: unknown): string | undefined {
  if (!notes) return undefined;
  if (typeof notes === "string") return notes;
  if (Array.isArray(notes)) {
    const text = notes
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const note = (item as Record<string, unknown>).note;
          return typeof note === "string" ? note : "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
    return text || undefined;
  }
  return String(notes);
}

function extractUpdateInfo(result: UpdateCheckResult | null): {
  version: string | null;
  releaseNotes?: string;
} {
  const info = result?.updateInfo;
  const version = typeof info?.version === "string" ? info.version : null;
  return {
    version,
    releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
  };
}

function result(
  status: DesktopUpdateRoutineResult["status"],
  message: string,
  checkedAt: string,
  extra: Partial<DesktopUpdateRoutineResult> = {},
): DesktopUpdateRoutineResult {
  return { checkedAt, status, message, ...extra };
}

function loadAutoUpdater(): DesktopAutoUpdater | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { autoUpdater } = require("electron-updater") as {
      autoUpdater: DesktopAutoUpdater;
    };
    autoUpdater.autoDownload = false;
    return autoUpdater;
  } catch (err) {
    console.error("[desktop-update-routine] Failed to load autoUpdater:", err);
    return null;
  }
}

function defaultDeps(): DesktopUpdateRoutineDeps {
  let isPackaged = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require("electron") as {
      app?: { isPackaged?: boolean };
    };
    isPackaged = app?.isPackaged === true;
  } catch {
    isPackaged = false;
  }

  const updater = loadAutoUpdater();
  return {
    isPackaged,
    isPortable: !!process.env.PORTABLE_EXECUTABLE_DIR,
    platform: process.platform,
    checkForUpdates: updater ? () => updater.checkForUpdates() : undefined,
    downloadUpdate: updater ? () => updater.downloadUpdate() : undefined,
  };
}

function record(
  result: DesktopUpdateRoutineResult,
): DesktopUpdateRoutineResult {
  recordDesktopUpdateRoutineResult(result);
  return result;
}

export async function runDesktopUpdateCheck(
  options: DesktopUpdateCheckOptions = {},
): Promise<DesktopUpdateRoutineResult> {
  const now = options.now || new Date();
  const checkedAt = now.toISOString();
  const routine = getDesktopUpdateRoutine(now);
  const autoDownload = options.autoDownload ?? routine.autoDownload;
  const deps = options.deps || defaultDeps();

  if (!deps.isPackaged) {
    return record(
      result(
        "skipped",
        "Skipped because Hermes Desktop is running in development mode.",
        checkedAt,
        { phase: "check", reason: "dev-mode" },
      ),
    );
  }
  if (deps.isPortable) {
    return record(
      result(
        "skipped",
        "Skipped because portable builds cannot self-update.",
        checkedAt,
        { phase: "check", reason: "portable-build" },
      ),
    );
  }
  if (deps.platform === "win32") {
    return record(
      result(
        "skipped",
        "Skipped because unsigned Windows builds use manual updates.",
        checkedAt,
        { phase: "check", reason: "windows-unsigned" },
      ),
    );
  }
  if (!deps.checkForUpdates) {
    return record(
      result("skipped", "Desktop updater is unavailable.", checkedAt, {
        phase: "check",
        reason: "updater-unavailable",
      }),
    );
  }

  let updateInfo: { version: string | null; releaseNotes?: string };
  try {
    updateInfo = extractUpdateInfo(await deps.checkForUpdates());
  } catch (err) {
    return record(
      result(
        "error",
        `Desktop update check failed: ${errorMessage(err)}`,
        checkedAt,
        {
          phase: "check",
          reason: "check-failed",
        },
      ),
    );
  }

  if (!updateInfo.version) {
    return record(
      result("current", "Hermes Desktop is already current.", checkedAt, {
        phase: "check",
        reason: "already-current",
      }),
    );
  }

  if (!autoDownload) {
    return record(
      result("available", "Hermes Desktop update available.", checkedAt, {
        phase: "check",
        reason: "update-available",
        version: updateInfo.version,
        releaseNotes: updateInfo.releaseNotes,
      }),
    );
  }

  if (!deps.downloadUpdate) {
    return record(
      result("error", "Desktop update download is unavailable.", checkedAt, {
        phase: "download",
        reason: "download-unavailable",
        version: updateInfo.version,
        releaseNotes: updateInfo.releaseNotes,
      }),
    );
  }

  try {
    await deps.downloadUpdate();
    return record(
      result(
        "downloaded",
        "Hermes Desktop update downloaded. Restart to install.",
        checkedAt,
        {
          phase: "download",
          reason: "downloaded",
          version: updateInfo.version,
          releaseNotes: updateInfo.releaseNotes,
        },
      ),
    );
  } catch (err) {
    return record(
      result(
        "error",
        `Desktop update download failed: ${errorMessage(err)}`,
        checkedAt,
        {
          phase: "download",
          reason: "download-failed",
          version: updateInfo.version,
          releaseNotes: updateInfo.releaseNotes,
        },
      ),
    );
  }
}

export async function maybeRunDesktopUpdateRoutine(
  now = new Date(),
): Promise<DesktopUpdateRoutineResult | null> {
  const routine = getDesktopUpdateRoutine(now);
  if (!isDesktopUpdateRoutineDue(routine, now)) return null;
  return runDesktopUpdateCheck({ now });
}
