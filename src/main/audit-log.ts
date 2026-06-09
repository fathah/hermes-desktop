import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { HERMES_HOME } from "./installer";

export interface AuditLogEntry {
  ts: number;
  action: string;
  command?: string;
  runId?: string;
  profile?: string;
}

const AUDIT_LOG_MAX_LINES = 1000;

export function appendAuditLog(entry: AuditLogEntry): void {
  try {
    const logDir = join(HERMES_HOME, "logs");
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    const logFile = join(logDir, "audit.log");
    let existing = "";
    if (existsSync(logFile)) {
      existing = readFileSync(logFile, "utf-8");
      const lines = existing.split("\n").filter((l) => l.trim() !== "");
      if (lines.length >= AUDIT_LOG_MAX_LINES) {
        existing =
          lines.slice(lines.length - AUDIT_LOG_MAX_LINES + 1).join("\n") + "\n";
      } else if (existing && !existing.endsWith("\n")) {
        existing += "\n";
      }
    }
    const line = JSON.stringify(entry) + "\n";
    writeFileSync(logFile, existing + line, "utf-8");
  } catch {
    // intentionally silent
  }
}
