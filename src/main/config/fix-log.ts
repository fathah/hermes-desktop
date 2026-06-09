import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { HERMES_HOME } from "../installer";

/**
 * Append a JSONL entry to `~/.hermes/logs/config-fixes.log` recording
 * an automated or user-initiated config migration. Auto-truncates the
 * log to the most-recent 1000 entries on each write so it doesn't grow
 * unbounded. Best-effort — any I/O error is silently swallowed so a
 * broken log directory never blocks the migration itself.
 */
export interface ConfigFixLogEntry {
  ts: number;
  issueCode: string;
  action: "migrate" | "autofix" | "manual-fix";
  from?: string;
  to?: string;
  profile?: string;
  valueMasked?: string;
  detail?: string;
}

const CONFIG_FIX_LOG_MAX_LINES = 1000;

export function appendConfigFixLog(entry: ConfigFixLogEntry): void {
  try {
    const logDir = join(HERMES_HOME, "logs");
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    const logFile = join(logDir, "config-fixes.log");
    let existing = "";
    if (existsSync(logFile)) {
      existing = readFileSync(logFile, "utf-8");
      const lines = existing.split("\n").filter((l) => l.trim() !== "");
      if (lines.length >= CONFIG_FIX_LOG_MAX_LINES) {
        existing =
          lines.slice(lines.length - CONFIG_FIX_LOG_MAX_LINES + 1).join("\n") +
          "\n";
      } else if (existing && !existing.endsWith("\n")) {
        existing += "\n";
      }
    }
    const line = JSON.stringify(entry) + "\n";
    writeFileSync(logFile, existing + line, "utf-8");
  } catch {
    // intentionally silent — never let log I/O block a migration
  }
}
