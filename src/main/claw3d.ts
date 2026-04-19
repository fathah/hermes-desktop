import { spawn, ChildProcess, execSync } from "child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  mkdirSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import { createConnection } from "net";
import { getEnhancedPath, HERMES_HOME } from "./installer";
import { stripAnsi, safeWriteFile } from "./utils";

const HERMES_OFFICE_REPO = "https://github.com/fathah/hermes-office";
const HERMES_OFFICE_DIR = join(HERMES_HOME, "hermes-office");
const DEV_PID_FILE = join(HERMES_HOME, "claw3d-dev.pid");
const ADAPTER_PID_FILE = join(HERMES_HOME, "claw3d-adapter.pid");
const PORT_FILE = join(HERMES_HOME, "claw3d-port");
const WS_URL_FILE = join(HERMES_HOME, "claw3d-ws-url");
const DEFAULT_PORT = 3000;
const DEFAULT_WS_URL = "ws://localhost:18789";
const CLAW3D_SETTINGS_DIR = join(homedir(), ".openclaw", "claw3d");

let devServerProcess: ChildProcess | null = null;
let adapterProcess: ChildProcess | null = null;
let devServerLogs = "";
let adapterLogs = "";
let devServerError = "";
let adapterError = "";

function getSavedPort(): number {
  try {
    const port = parseInt(readFileSync(PORT_FILE, "utf-8").trim(), 10);
    return isNaN(port) ? DEFAULT_PORT : port;
  } catch {
    return DEFAULT_PORT;
  }
}

export function setClaw3dPort(port: number): void {
  safeWriteFile(PORT_FILE, String(port));
  // Re-write .env with updated port
  writeClaw3dSettings();
}

export function getClaw3dPort(): number {
  return getSavedPort();
}

function getSavedWsUrl(): string {
  try {
    const url = readFileSync(WS_URL_FILE, "utf-8").trim();
    return url || DEFAULT_WS_URL;
  } catch {
    return DEFAULT_WS_URL;
  }
}

export function setClaw3dWsUrl(url: string): void {
  safeWriteFile(WS_URL_FILE, url);
  // Also update the settings.json so Claw3D picks it up
  writeClaw3dSettings(url);
}

export function getClaw3dWsUrl(): string {
  return getSavedWsUrl();
}

/**
 * Write Claw3D settings to ~/.openclaw/claw3d/settings.json
 * and .env in the claw3d directory so onboarding is skipped.
 */
function writeClaw3dSettings(wsUrl?: string): void {
  const url = wsUrl || getSavedWsUrl();

  // Write ~/.openclaw/claw3d/settings.json
  try {
    mkdirSync(CLAW3D_SETTINGS_DIR, { recursive: true });
    const settingsPath = join(CLAW3D_SETTINGS_DIR, "settings.json");

    // Preserve existing settings if present
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      /* fresh */
    }

    const settings = {
      ...existing,
      adapter: "hermes",
      url,
      token: "",
    };
    safeWriteFile(settingsPath, JSON.stringify(settings, null, 2));
  } catch {
    /* non-fatal */
  }

  // Write .env in claw3d directory
  try {
    if (existsSync(HERMES_OFFICE_DIR)) {
      const envPath = join(HERMES_OFFICE_DIR, ".env");
      const port = getSavedPort();
      const envContent = [
        "# Auto-configured by Hermes Desktop",
        `PORT=${port}`,
        `HOST=127.0.0.1`,
        `NEXT_PUBLIC_GATEWAY_URL=${url}`,
        `CLAW3D_GATEWAY_URL=${url}`,
        `CLAW3D_GATEWAY_TOKEN=`,
        `HERMES_ADAPTER_PORT=18789`,
        `HERMES_MODEL=hermes`,
        `HERMES_AGENT_NAME=Hermes`,
        "",
      ].join("\n");
      safeWriteFile(envPath, envContent);
    }
  } catch {
    /* non-fatal */
  }
}

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.setTimeout(300); // 300ms is plenty for localhost
    socket.on("connect", () => {
      socket.destroy();
      resolve(true); // port is in use
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false); // port is free
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export interface Claw3dStatus {
  cloned: boolean;
  installed: boolean;
  devServerRunning: boolean;
  adapterRunning: boolean;
  running: boolean; // true when both dev + adapter are up
  port: number;
  portInUse: boolean;
  wsUrl: string;
  error: string; // last error from either process
}

export interface Claw3dSetupProgress {
  step: number;
  totalSteps: number;
  title: string;
  detail: string;
  log: string;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(file: string): number | null {
  try {
    const pid = parseInt(readFileSync(file, "utf-8").trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function writePid(file: string, pid: number): void {
  safeWriteFile(file, String(pid));
}

function cleanupPid(file: string): void {
  try {
    unlinkSync(file);
  } catch {
    /* ignore */
  }
}

function isDevServerRunning(): boolean {
  if (devServerProcess && !devServerProcess.killed) return true;
  const pid = readPid(DEV_PID_FILE);
  if (pid && isProcessRunning(pid)) return true;
  cleanupPid(DEV_PID_FILE);
  return false;
}

function isAdapterRunning(): boolean {
  if (adapterProcess && !adapterProcess.killed) return true;
  const pid = readPid(ADAPTER_PID_FILE);
  if (pid && isProcessRunning(pid)) return true;
  cleanupPid(ADAPTER_PID_FILE);
  return false;
}

export async function getClaw3dStatus(): Promise<Claw3dStatus> {
  const cloned = existsSync(join(HERMES_OFFICE_DIR, "package.json"));
  const installed = existsSync(join(HERMES_OFFICE_DIR, "node_modules"));
  const port = getSavedPort();
  const devRunning = isDevServerRunning();
  // Only check port conflict when dev server is NOT running
  const portInUse = devRunning ? false : await checkPort(port);
  const adapterUp = isAdapterRunning();
  const error = devServerError || adapterError;
  return {
    cloned,
    installed,
    devServerRunning: devRunning,
    adapterRunning: adapterUp,
    running: devRunning && adapterUp,
    port,
    portInUse,
    wsUrl: getSavedWsUrl(),
    error,
  };
}

let _cachedNpmPath: string | null = null;

function findNpm(): string {
  if (_cachedNpmPath) return _cachedNpmPath;

  const home = homedir();

  // Try common locations first (no process spawn).
  // Includes nvm, volta, fnm, and system paths.
  const candidates = [
    join(home, ".volta", "bin", "npm"),
    join(home, ".asdf", "shims", "npm"),
    join(home, ".local", "share", "fnm", "aliases", "default", "bin", "npm"),
    join(home, ".fnm", "aliases", "default", "bin", "npm"),
    "/usr/local/bin/npm",
    "/opt/homebrew/bin/npm",
  ];

  // Discover nvm npm dynamically (active version)
  const nvmDir = process.env.NVM_DIR || join(home, ".nvm");
  const nvmVersions = join(nvmDir, "versions", "node");
  if (existsSync(nvmVersions)) {
    try {
      const versions = readdirSync(nvmVersions)
        .filter((d: string) => d.startsWith("v"))
        .sort()
        .reverse();
      for (const v of versions) {
        candidates.unshift(join(nvmVersions, v, "bin", "npm"));
      }
    } catch {
      /* non-fatal */
    }
  }

  for (const c of candidates) {
    if (existsSync(c)) {
      _cachedNpmPath = c;
      return c;
    }
  }

  // Fallback: which/where (blocks main thread — only runs once)
  try {
    const npmPath = execSync("which npm 2>/dev/null || where npm 2>/dev/null", {
      env: { ...process.env, PATH: getEnhancedPath() },
      timeout: 5000,
    })
      .toString()
      .trim()
      .split("\n")[0];
    if (npmPath && existsSync(npmPath)) {
      _cachedNpmPath = npmPath;
      return npmPath;
    }
  } catch {
    /* fall through */
  }

  _cachedNpmPath = "npm";
  return "npm";
}

export async function setupClaw3d(
  onProgress: (progress: Claw3dSetupProgress) => void,
): Promise<void> {
  const totalSteps = 2;
  let log = "";

  function emit(step: number, title: string, text: string): void {
    log += text;
    onProgress({
      step,
      totalSteps,
      title,
      detail: text.trim().slice(0, 120),
      log,
    });
  }

  const env = {
    ...process.env,
    PATH: getEnhancedPath(),
    HOME: homedir(),
    TERM: "dumb",
  };

  // Step 1: Clone (or pull if already cloned)
  const cloned = existsSync(join(HERMES_OFFICE_DIR, "package.json"));

  if (!cloned) {
    emit(1, "Cloning Claw3D repository...", "Cloning from GitHub...\n");
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        "git",
        ["clone", HERMES_OFFICE_REPO, HERMES_OFFICE_DIR],
        {
          cwd: homedir(),
          env,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      proc.stdout?.on("data", (data: Buffer) => {
        emit(1, "Cloning Claw3D repository...", stripAnsi(data.toString()));
      });
      proc.stderr?.on("data", (data: Buffer) => {
        emit(1, "Cloning Claw3D repository...", stripAnsi(data.toString()));
      });

      proc.on("close", (code) => {
        if (code === 0) {
          emit(1, "Cloning Claw3D repository...", "Clone complete.\n");
          resolve();
        } else {
          reject(new Error(`git clone failed (exit code ${code})`));
        }
      });
      proc.on("error", (err) =>
        reject(new Error(`Failed to run git: ${err.message}`)),
      );
    });
  } else {
    emit(
      1,
      "Claw3D already cloned",
      "Repository already exists, pulling latest...\n",
    );
    await new Promise<void>((resolve) => {
      const proc = spawn("git", ["pull", "--ff-only"], {
        cwd: HERMES_OFFICE_DIR,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      proc.stdout?.on("data", (data: Buffer) => {
        emit(1, "Updating Claw3D...", stripAnsi(data.toString()));
      });
      proc.stderr?.on("data", (data: Buffer) => {
        emit(1, "Updating Claw3D...", stripAnsi(data.toString()));
      });

      proc.on("close", (code) => {
        if (code === 0) resolve();
        else resolve(); // non-fatal: pull failures shouldn't block setup
      });
      proc.on("error", () => resolve());
    });
  }

  // Step 2: npm install
  emit(2, "Installing dependencies...", "Running npm install...\n");
  const npm = findNpm();

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(npm, ["install"], {
      cwd: HERMES_OFFICE_DIR,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout?.on("data", (data: Buffer) => {
      emit(2, "Installing dependencies...", stripAnsi(data.toString()));
    });
    proc.stderr?.on("data", (data: Buffer) => {
      emit(2, "Installing dependencies...", stripAnsi(data.toString()));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        emit(
          2,
          "Installing dependencies...",
          "Dependencies installed successfully.\n",
        );
        resolve();
      } else {
        reject(new Error(`npm install failed (exit code ${code})`));
      }
    });
    proc.on("error", (err) =>
      reject(new Error(`Failed to run npm: ${err.message}`)),
    );
  });

  // Write config files so Claw3D skips onboarding
  writeClaw3dSettings();
}

function killProcessTree(proc: ChildProcess): void {
  if (proc.pid) {
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {
      try {
        proc.kill("SIGTERM");
      } catch {
        /* already dead */
      }
    }
    // Fallback: SIGKILL after 3 seconds
    setTimeout(() => {
      try {
        if (proc.pid) process.kill(-proc.pid, "SIGKILL");
      } catch {
        /* already dead */
      }
    }, 3000);
  }
}

export function startDevServer(): boolean {
  if (isDevServerRunning()) return true;
  if (!existsSync(join(HERMES_OFFICE_DIR, "node_modules"))) return false;

  devServerError = "";
  devServerLogs = "";
  const port = getSavedPort();
  const npm = findNpm();
  const proc = spawn(npm, ["run", "dev"], {
    cwd: HERMES_OFFICE_DIR,
    env: {
      ...process.env,
      PATH: getEnhancedPath(),
      HOME: homedir(),
      TERM: "dumb",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  devServerProcess = proc;
  if (proc.pid) writePid(DEV_PID_FILE, proc.pid);

  proc.stdout?.on("data", (data: Buffer) => {
    devServerLogs += stripAnsi(data.toString());
    // Keep only last 2000 chars
    if (devServerLogs.length > 2000) devServerLogs = devServerLogs.slice(-2000);
  });

  proc.stderr?.on("data", (data: Buffer) => {
    const text = stripAnsi(data.toString());
    devServerLogs += text;
    if (devServerLogs.length > 2000) devServerLogs = devServerLogs.slice(-2000);
    // Capture real errors (not warnings)
    if (
      /error|EADDRINUSE|ENOENT|failed|fatal/i.test(text) &&
      !/warning/i.test(text)
    ) {
      devServerError = text.trim().slice(0, 300);
    }
  });

  proc.on("close", (code) => {
    if (code && code !== 0 && !devServerError) {
      devServerError = `Dev server exited with code ${code}. Check if port ${port} is available.`;
    }
    devServerProcess = null;
    cleanupPid(DEV_PID_FILE);
  });

  proc.unref();
  return true;
}

export function stopDevServer(): void {
  if (devServerProcess) {
    killProcessTree(devServerProcess);
    devServerProcess = null;
  }

  const pid = readPid(DEV_PID_FILE);
  if (pid) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* already dead */
      }
    }
  }
  cleanupPid(DEV_PID_FILE);
}

export function startAdapter(): boolean {
  if (isAdapterRunning()) return true;
  if (!existsSync(join(HERMES_OFFICE_DIR, "node_modules"))) return false;

  adapterError = "";
  adapterLogs = "";
  const npm = findNpm();
  const proc = spawn(npm, ["run", "hermes-adapter"], {
    cwd: HERMES_OFFICE_DIR,
    env: {
      ...process.env,
      PATH: getEnhancedPath(),
      HOME: homedir(),
      TERM: "dumb",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  adapterProcess = proc;
  if (proc.pid) writePid(ADAPTER_PID_FILE, proc.pid);

  proc.stdout?.on("data", (data: Buffer) => {
    adapterLogs += stripAnsi(data.toString());
    if (adapterLogs.length > 2000) adapterLogs = adapterLogs.slice(-2000);
  });

  proc.stderr?.on("data", (data: Buffer) => {
    const text = stripAnsi(data.toString());
    adapterLogs += text;
    if (adapterLogs.length > 2000) adapterLogs = adapterLogs.slice(-2000);
    if (
      /error|EADDRINUSE|ENOENT|failed|fatal/i.test(text) &&
      !/warning/i.test(text)
    ) {
      adapterError = text.trim().slice(0, 300);
    }
  });

  proc.on("close", (code) => {
    if (code && code !== 0 && !adapterError) {
      adapterError = `Hermes adapter exited with code ${code}`;
    }
    adapterProcess = null;
    cleanupPid(ADAPTER_PID_FILE);
  });

  proc.unref();
  return true;
}

export function stopAdapter(): void {
  if (adapterProcess) {
    killProcessTree(adapterProcess);
    adapterProcess = null;
  }

  const pid = readPid(ADAPTER_PID_FILE);
  if (pid) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* already dead */
      }
    }
  }
  cleanupPid(ADAPTER_PID_FILE);
}

export function startAll(): { success: boolean; error?: string } {
  if (!existsSync(join(HERMES_OFFICE_DIR, "node_modules"))) {
    return {
      success: false,
      error: "Claw3D is not installed. Please install it first.",
    };
  }

  const port = getSavedPort();

  // Start dev server
  const devOk = startDevServer();
  if (!devOk) {
    return {
      success: false,
      error: `Failed to start dev server on port ${port}`,
    };
  }

  // Start adapter
  const adapterOk = startAdapter();
  if (!adapterOk) {
    return { success: false, error: "Failed to start Hermes adapter" };
  }

  return { success: true };
}

export function stopAll(): void {
  stopDevServer();
  stopAdapter();
  devServerError = "";
  adapterError = "";
}

export function getClaw3dLogs(): string {
  return [
    devServerLogs ? `=== Dev Server ===\n${devServerLogs}` : "",
    adapterLogs ? `=== Adapter ===\n${adapterLogs}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
