import { randomUUID } from "crypto";
import { stat } from "fs/promises";
import type { WebContents } from "electron";
import type { IPty } from "node-pty";

interface TerminalSession {
  ownerId: number;
  process: IPty;
}

const sessions = new Map<string, TerminalSession>();
const observedOwners = new Set<number>();
let nodePtyModule: Promise<typeof import("node-pty")> | null = null;

function loadNodePty(): Promise<typeof import("node-pty")> {
  nodePtyModule ??= import("node-pty");
  return nodePtyModule;
}

function terminalEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  return env;
}

export function resolveTerminalShell(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[] } {
  if (platform === "win32") {
    return {
      command: env.COMSPEC || "powershell.exe",
      args: env.COMSPEC ? [] : ["-NoLogo"],
    };
  }
  return { command: env.SHELL || "/bin/zsh", args: ["-l"] };
}

function stopOwnedTerminals(ownerId: number): void {
  for (const [id, session] of sessions) {
    if (session.ownerId !== ownerId) continue;
    sessions.delete(id);
    session.process.kill();
  }
  observedOwners.delete(ownerId);
}

export async function startIntegratedTerminal(
  cwd: string,
  owner: WebContents,
): Promise<{ id: string } | null> {
  if (typeof cwd !== "string" || cwd.trim().length === 0) return null;
  const info = await stat(cwd).catch(() => null);
  if (!info?.isDirectory()) return null;

  const id = randomUUID();
  const shell = resolveTerminalShell();
  const { spawn } = await loadNodePty();
  const terminal = spawn(shell.command, shell.args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd,
    env: terminalEnvironment(),
  });
  sessions.set(id, { ownerId: owner.id, process: terminal });

  if (!observedOwners.has(owner.id)) {
    observedOwners.add(owner.id);
    owner.once("destroyed", () => stopOwnedTerminals(owner.id));
  }

  terminal.onData((data) => {
    if (!owner.isDestroyed()) owner.send("integrated-terminal-data", id, data);
  });
  terminal.onExit(({ exitCode }) => {
    if (sessions.get(id)?.process !== terminal) return;
    sessions.delete(id);
    if (!owner.isDestroyed()) {
      owner.send("integrated-terminal-exit", id, exitCode);
    }
  });

  return { id };
}

export function writeIntegratedTerminal(
  id: string,
  ownerId: number,
  data: string,
): boolean {
  const session = sessions.get(id);
  if (!session || session.ownerId !== ownerId || typeof data !== "string")
    return false;
  session.process.write(data);
  return true;
}

export function resizeIntegratedTerminal(
  id: string,
  ownerId: number,
  cols: number,
  rows: number,
): boolean {
  const session = sessions.get(id);
  if (!session || session.ownerId !== ownerId) return false;
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) return false;
  if (cols < 2 || cols > 1000 || rows < 1 || rows > 1000) return false;
  session.process.resize(cols, rows);
  return true;
}

export function stopIntegratedTerminal(id: string, ownerId: number): boolean {
  const session = sessions.get(id);
  if (!session || session.ownerId !== ownerId) return false;
  sessions.delete(id);
  session.process.kill();
  return true;
}

export function stopAllIntegratedTerminals(): void {
  for (const [id, session] of sessions) {
    sessions.delete(id);
    session.process.kill();
  }
  observedOwners.clear();
}
