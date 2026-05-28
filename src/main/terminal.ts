import { ipcMain, BrowserWindow } from "electron";
import { homedir } from "os";
import { randomUUID } from "crypto";
import pty from "node-pty";

interface PtySession {
  id: string;
  pty: pty.IPty;
}

const sessions = new Map<string, PtySession>();

export function registerTerminalHandlers(): void {
  ipcMain.handle("terminal-create", (_event, cwd?: string) => {
    const shell =
      process.platform === "win32"
        ? "powershell.exe"
        : process.env.SHELL || "/bin/bash";
    const id = randomUUID();
    const instance = pty.spawn(shell, [], {
      name: "xterm-color",
      cwd: cwd || homedir(),
      env: process.env as Record<string, string>,
    });

    sessions.set(id, { id, pty: instance });

    instance.onData((data) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send("terminal-data", { id, data });
      }
    });

    instance.onExit(() => {
      sessions.delete(id);
    });

    return { id };
  });

  ipcMain.handle("terminal-write", (_event, id: string, data: string) => {
    sessions.get(id)?.pty.write(data);
  });

  ipcMain.handle(
    "terminal-resize",
    (_event, id: string, cols: number, rows: number) => {
      sessions.get(id)?.pty.resize(cols, rows);
    },
  );

  ipcMain.handle("terminal-kill", (_event, id: string) => {
    const session = sessions.get(id);
    if (session) {
      session.pty.kill();
      sessions.delete(id);
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
