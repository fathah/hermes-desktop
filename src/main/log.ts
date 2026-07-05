// Phase 1.6 — dependency-free JSON-lines logger with size rotation.
//
// Replaces scattered console.* in the long-lived background paths (gateway
// supervisor, scheduler, the IPC envelope in 1.3) with one structured sink at
// <HERMES_HOME>/logs/desktop.log, rotated so it can't grow without bound. Pure
// helpers (formatLogLine / shouldRotate) are split out and electron-free so they
// stay vitest-testable.

import {
  existsSync,
  mkdirSync,
  appendFileSync,
  statSync,
  renameSync,
  unlinkSync,
} from "fs";
import { join } from "path";
import { HERMES_HOME } from "./installer/paths";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const DESKTOP_LOG_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const DESKTOP_LOG_KEEP = 3; // desktop.log + .1 .2 .3
const GATEWAY_STDERR_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const GATEWAY_STDERR_KEEP = 2;

/** Pure: render one JSON-lines record. A string payload becomes { msg }, an
 *  object payload is spread as structured fields. */
export function formatLogLine(
  level: LogLevel,
  scope: string,
  payload: string | LogFields,
  ts: number,
): string {
  const base = { ts: new Date(ts).toISOString(), level, scope };
  const fields = typeof payload === "string" ? { msg: payload } : payload;
  return `${JSON.stringify({ ...base, ...fields })}\n`;
}

/** Pure: rotate once the file reaches the byte ceiling. */
export function shouldRotate(sizeBytes: number, maxBytes: number): boolean {
  return sizeBytes >= maxBytes;
}

export function formatLogError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    const json = JSON.stringify(error);
    if (json) return json;
  } catch {
    // fall back to String below
  }
  return String(error);
}

function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

function logDir(): string {
  return join(HERMES_HOME, "logs");
}

function desktopLogPath(): string {
  return join(logDir(), "desktop.log");
}

let _bytesWritten = 0;
let _initialized = false;

function ensureInit(): void {
  if (_initialized) return;
  _initialized = true;
  try {
    mkdirSync(logDir(), { recursive: true });
  } catch {
    // best-effort
  }
  try {
    _bytesWritten = existsSync(desktopLogPath())
      ? statSync(desktopLogPath()).size
      : 0;
  } catch {
    _bytesWritten = 0;
  }
}

/** Shift <base> -> <base>.1 -> ... up to `keep`, dropping anything beyond. */
function rotateNumbered(basePath: string, keep: number): void {
  try {
    const beyond = `${basePath}.${keep}`;
    if (existsSync(beyond)) unlinkSync(beyond);
    for (let i = keep - 1; i >= 1; i--) {
      const src = `${basePath}.${i}`;
      if (existsSync(src)) renameSync(src, `${basePath}.${i + 1}`);
    }
    if (existsSync(basePath)) renameSync(basePath, `${basePath}.1`);
  } catch {
    // best-effort — never let logging crash a caller
  }
}

function writeLine(
  level: LogLevel,
  scope: string,
  payload: string | LogFields,
): void {
  ensureInit();
  const line = formatLogLine(level, scope, payload, Date.now());
  if (shouldRotate(_bytesWritten, DESKTOP_LOG_MAX_BYTES)) {
    rotateNumbered(desktopLogPath(), DESKTOP_LOG_KEEP);
    _bytesWritten = 0;
  }
  try {
    appendFileSync(desktopLogPath(), line);
    _bytesWritten += Buffer.byteLength(line);
  } catch {
    // best-effort
  }
  if (isDev()) {
    // eslint-disable-next-line no-console -- log.ts is the single dev-console mirror.
    const consoleFn = level === "debug" ? console.log : console[level];
    consoleFn(`[${scope}]`, payload);
  }
}

export const log = {
  debug: (scope: string, payload: string | LogFields): void =>
    writeLine("debug", scope, payload),
  info: (scope: string, payload: string | LogFields): void =>
    writeLine("info", scope, payload),
  warn: (scope: string, payload: string | LogFields): void =>
    writeLine("warn", scope, payload),
  error: (scope: string, payload: string | LogFields): void =>
    writeLine("error", scope, payload),
};

/** Rotate the gateway's stderr log if it has grown past the ceiling. Called at
 *  gateway start so a long-running install never lets it balloon unbounded. */
export function rotateGatewayStderrIfLarge(stderrPath: string): void {
  try {
    if (!existsSync(stderrPath)) return;
    if (statSync(stderrPath).size < GATEWAY_STDERR_MAX_BYTES) return;
    rotateNumbered(stderrPath, GATEWAY_STDERR_KEEP);
  } catch {
    // best-effort
  }
}
