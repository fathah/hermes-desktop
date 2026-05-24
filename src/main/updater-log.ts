/**
 * A minimal file logger for electron-updater.
 *
 * The auto-updater previously ran with no logger, so a failed update — e.g.
 * issue #271, "after upgrading, clicking Restart doesn't relaunch the app" —
 * left no trace at all and was undiagnosable from a bug report. This writes
 * electron-updater's own log lines to `<userData>/logs/updater.log` (and
 * mirrors them to the main-process console), with no extra dependency.
 *
 * The object satisfies electron-updater's `Logger` interface.
 */
import { app } from "electron";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from "fs";
import { join } from "path";

// Rotate (truncate) the log once it passes this size — updater sessions are
// short, so keeping only the most recent activity is enough to diagnose.
const MAX_BYTES = 512 * 1024;

/** Resolve `<userData>/logs/updater.log`, creating the dir. Returns "" when
 *  the path can't be resolved (e.g. no Electron runtime under unit tests). */
function logFilePath(): string {
  try {
    const userData = app?.getPath?.("userData");
    if (!userData) return "";
    const dir = join(userData, "logs");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return join(dir, "updater.log");
  } catch {
    return "";
  }
}

function write(level: string, message?: unknown): void {
  const text = typeof message === "string" ? message : JSON.stringify(message);
  const tag = `[updater] ${text}`;
  if (level === "error") console.error(tag);
  else if (level === "warn") console.warn(tag);
  else console.log(tag);

  try {
    const file = logFilePath();
    if (!file) return;
    if (existsSync(file) && statSync(file).size > MAX_BYTES) {
      writeFileSync(file, "");
    }
    appendFileSync(
      file,
      `${new Date().toISOString()} [${level}] ${text}\n`,
      "utf-8",
    );
  } catch {
    /* logging must never throw */
  }
}

export const updaterLogger = {
  info: (message?: unknown): void => write("info", message),
  warn: (message?: unknown): void => write("warn", message),
  error: (message?: unknown): void => write("error", message),
  debug: (message?: unknown): void => write("debug", message),
};
