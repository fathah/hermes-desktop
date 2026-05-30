import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { homedir } from "os";
import { randomUUID } from "crypto";
import { existsSync, statSync } from "fs";
import pty from "node-pty";
import { isRemoteOnlyMode } from "./hermes";

interface PtySession {
  id: string;
  pty: pty.IPty;
  ownerWebContentsId: number;
}

const sessions = new Map<string, PtySession>();
const MAX_GLOBAL_SESSIONS = 8;
const MAX_SESSIONS_PER_OWNER = 3;
const MAX_WRITE_BYTES = 64 * 1024;
const MIN_COLS = 2;
const MAX_COLS = 500;
const MIN_ROWS = 2;
const MAX_ROWS = 200;

interface TerminalResult {
  success: boolean;
  error?: string;
  unsupportedMode?: boolean;
}

interface TerminalCreateResult extends TerminalResult {
  id?: string;
}

function unsupportedInRemote(): TerminalCreateResult {
  return {
    success: false,
    unsupportedMode: true,
    error: "Terminal is only available for local or SSH tunnel modes.",
  };
}

function errorResult(error: unknown): TerminalResult {
  return { success: false, error: error instanceof Error ? error.message : String(error) };
}

function validateCwd(cwd?: string): string | TerminalCreateResult {
  if (cwd !== undefined && typeof cwd !== "string") {
    return { success: false, error: "Invalid working directory." };
  }

  const target = cwd && cwd.trim() ? cwd : homedir();
  try {
    if (!existsSync(target)) {
      return { success: false, error: "Working directory does not exist." };
    }
    if (!statSync(target).isDirectory()) {
      return { success: false, error: "Working directory is not a directory." };
    }
  } catch (err) {
    return errorResult(err) as TerminalCreateResult;
  }
  return target;
}

function sessionsForOwner(ownerWebContentsId: number): number {
  let count = 0;
  for (const session of sessions.values()) {
    if (session.ownerWebContentsId === ownerWebContentsId) count++;
  }
  return count;
}

function getOwnedSession(
  event: IpcMainInvokeEvent,
  id: unknown,
): PtySession | TerminalResult {
  if (typeof id !== "string" || !id) {
    return { success: false, error: "Invalid terminal session id." };
  }
  const session = sessions.get(id);
  if (!session) {
    return { success: false, error: "Unknown terminal session." };
  }
  if (session.ownerWebContentsId !== event.sender.id) {
    return { success: false, error: "Terminal session is owned by another window." };
  }
  return session;
}

function validateResize(cols: unknown, rows: unknown): TerminalResult | null {
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    (cols as number) < MIN_COLS ||
    (cols as number) > MAX_COLS ||
    (rows as number) < MIN_ROWS ||
    (rows as number) > MAX_ROWS
  ) {
    return { success: false, error: "Invalid terminal dimensions." };
  }
  return null;
}

export function registerTerminalHandlers(): void {
  ipcMain.handle("terminal-create", (event, cwd?: string): TerminalCreateResult => {
    if (isRemoteOnlyMode()) return unsupportedInRemote();

    if (sessions.size >= MAX_GLOBAL_SESSIONS) {
      return { success: false, error: "Terminal session limit reached." };
    }
    if (sessionsForOwner(event.sender.id) >= MAX_SESSIONS_PER_OWNER) {
      return { success: false, error: "Window terminal session limit reached." };
    }

    const validatedCwd = validateCwd(cwd);
    if (typeof validatedCwd !== "string") return validatedCwd;

    const shell =
      process.platform === "win32"
        ? "powershell.exe"
        : process.env.SHELL || "/bin/bash";
    const id = randomUUID();

    try {
      const instance = pty.spawn(shell, [], {
        name: "xterm-color",
        cwd: validatedCwd,
        env: process.env,
      });

      sessions.set(id, { id, pty: instance, ownerWebContentsId: event.sender.id });

      instance.onData((data) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send("terminal-data", { id, data });
        }
      });

      instance.onExit(() => {
        sessions.delete(id);
      });

      event.sender.once("destroyed", () => {
        const session = sessions.get(id);
        if (!session) return;
        try {
          session.pty.kill();
        } catch {
          // ignore
        }
        sessions.delete(id);
      });

      return { success: true, id };
    } catch (err) {
      sessions.delete(id);
      return errorResult(err) as TerminalCreateResult;
    }
  });

  ipcMain.handle("terminal-write", (event, id: string, data: string): TerminalResult => {
    const session = getOwnedSession(event, id);
    if ("success" in session) return session;
    if (typeof data !== "string") {
      return { success: false, error: "Terminal input must be a string." };
    }
    if (Buffer.byteLength(data, "utf8") > MAX_WRITE_BYTES) {
      return { success: false, error: "Terminal input is too large." };
    }
    try {
      session.pty.write(data);
      return { success: true };
    } catch (err) {
      return errorResult(err);
    }
  });

  ipcMain.handle(
    "terminal-resize",
    (event, id: string, cols: number, rows: number): TerminalResult => {
      const session = getOwnedSession(event, id);
      if ("success" in session) return session;
      const resizeError = validateResize(cols, rows);
      if (resizeError) return resizeError;
      try {
        session.pty.resize(cols, rows);
        return { success: true };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  ipcMain.handle("terminal-kill", (event, id: string): TerminalResult => {
    const session = getOwnedSession(event, id);
    if ("success" in session) return session;
    try {
      session.pty.kill();
      sessions.delete(id);
      return { success: true };
    } catch (err) {
      sessions.delete(id);
      return errorResult(err);
    }
  });
}

export function killAllTerminals(): void {
  for (const [, session] of sessions) {
    try {
      session.pty.kill();
    } catch {
      // ignore
    }
  }
  sessions.clear();
}
