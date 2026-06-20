import { join } from "path";
import { appendFileSync, existsSync, mkdirSync } from "fs";
import { HERMES_HOME } from "./installer";

export interface AuditLogEntry {
  ts: number;
  action: string;
  command?: string;
  runId?: string;
  profile?: string;
}

export function appendAuditLog(entry: AuditLogEntry): void {
  try {
    const logDir = join(HERMES_HOME, "logs");
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    const logFile = join(logDir, "audit.log");
    const line = JSON.stringify(entry) + "\n";
    appendFileSync(logFile, line, { encoding: "utf-8", mode: 0o600 });
  } catch {
    // intentionally silent
  }
}
