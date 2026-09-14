import { spawn, ChildProcess, spawnSync, execFileSync } from "child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  mkdirSync,
} from "fs";
import { join, win32 } from "path";
import { homedir } from "os";
import { createConnection } from "net";
import { getEnhancedPath, HERMES_HOME } from "./installer";
import { stripAnsi, safeWriteFile, getActiveProfileNameSync } from "./utils";
import { getApiServerKey, getConnectionConfig, getModelConfig } from "./config";
import http from "http";

const HERMES_OFFICE_REPO = "https://github.com/fathah/hermes-office";
const HERMES_OFFICE_DIR = join(HERMES_HOME, "hermes-office");
const DEV_PID_FILE = join(HERMES_HOME, "claw3d-dev.pid");
const ADAPTER_PID_FILE = join(HERMES_HOME, "claw3d-adapter.pid");
const PORT_FILE = join(HERMES_HOME, "claw3d-port");
const WS_URL_FILE = join(HERMES_HOME, "claw3d-ws-url");
const DEFAULT_PORT = 3000;
const OLD_DEFAULT_WS_URL = "ws://localhost:18789";
const DEFAULT_ADAPTER_PORT = 18989;
const DEFAULT_WS_URL = `ws://localhost:${DEFAULT_ADAPTER_PORT}`;
const CLAW3D_SETTINGS_DIR = join(homedir(), ".openclaw", "claw3d");

let devServerProcess: ChildProcess | null = null;
let adapterProcess: ChildProcess | null = null;
let devServerLogs = "";
let adapterLogs = "";
let devServerError = "";
let adapterError = "";

export interface ResolvedCommand {
  command: string;
  windowsScript: boolean;
}

export interface CommandInvocation {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

interface NpmInvocationOptions {
  platform?: NodeJS.Platform;
  fileExists?: (path: string) => boolean;
}

type Claw3dScript = "dev" | "hermes-adapter";

const CLAW3D_SCRIPT_ARGS: Record<Claw3dScript, string[]> = {
  dev: ["server/index.js", "--dev"],
  "hermes-adapter": ["server/hermes-gateway-adapter.js"],
};

export function isWindowsCommandScript(command: string): boolean {
  return /\.(cmd|bat)$/i.test(command);
}

export function pickWindowsCommandCandidate(
  candidates: string[],
): ResolvedCommand | null {
  const normalized = candidates
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  const executable = normalized.find((candidate) => /\.exe$/i.test(candidate));
  if (executable) {
    return { command: executable, windowsScript: false };
  }

  const script = normalized.find(isWindowsCommandScript);
  if (script) {
    return { command: script, windowsScript: true };
  }

  const fallback = normalized[0];
  return fallback ? { command: fallback, windowsScript: false } : null;
}

function resolveCommandOnPath(
  command: string,
  envPath: string,
): ResolvedCommand | null {
  const lookupCommand = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(lookupCommand, [command], {
    encoding: "utf8",
    env: { ...process.env, PATH: envPath },
    timeout: 5000,
    windowsHide: true,
  });

  if (result.error || result.status !== 0 || !result.stdout) return null;

  const candidates = result.stdout.split(/\r?\n/);
  if (process.platform === "win32") {
    return pickWindowsCommandCandidate(candidates);
  }

  const resolved = candidates
    .map((candidate) => candidate.trim())
    .find(Boolean);
  return resolved ? { command: resolved, windowsScript: false } : null;
}

function resolveCommand(command: string, envPath: string): ResolvedCommand {
  const resolved = resolveCommandOnPath(command, envPath);
  if (resolved) return resolved;

  return {
    command,
    windowsScript:
      process.platform === "win32" && isWindowsCommandScript(command),
  };
}

function quoteWindowsCmdArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function buildWindowsScriptCommandLine(
  command: string,
  args: string[],
): string {
  const parts = [quoteWindowsCmdArg(command), ...args.map(quoteWindowsCmdArg)];
  return `"${parts.join(" ")}"`;
}

function createCommandInvocation(
  resolved: ResolvedCommand,
  args: string[],
): CommandInvocation {
  if (resolved.windowsScript) {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        buildWindowsScriptCommandLine(resolved.command, args),
      ],
      windowsVerbatimArguments: true,
    };
  }

  return { command: resolved.command, args };
}

function createWindowsNpmCliInvocation(
  npmCommand: string,
  args: string[],
  fileExists: (path: string) => boolean,
): CommandInvocation | null {
  const npmDir = win32.dirname(npmCommand);
  const nodeCandidates = [
    win32.join(npmDir, "node.exe"),
    win32.join(npmDir, "..", "..", "..", "node.exe"),
  ];
  const npmCliCandidates = [
    win32.join(npmDir, "node_modules", "npm", "bin", "npm-cli.js"),
    win32.join(npmDir, "npm-cli.js"),
  ];

  const nodeExe = nodeCandidates.find(fileExists);
  const npmCli = npmCliCandidates.find(fileExists);
  if (!npmCli) return null;

  return {
    command: nodeExe || "node",
    args: [npmCli, ...args],
  };
}

export function createNpmCommandInvocation(
  resolved: ResolvedCommand,
  args: string[],
  options: NpmInvocationOptions = {},
): CommandInvocation {
  const platform = options.platform ?? process.platform;
  const fileExists = options.fileExists ?? existsSync;

  if (platform === "win32") {
    const directNpm = createWindowsNpmCliInvocation(
      resolved.command,
      args,
      fileExists,
    );
    if (directNpm) return directNpm;
  }

  return createCommandInvocation(resolved, args);
}

export function createClaw3dScriptInvocation(
  script: Claw3dScript,
  nodeCommand = "node",
): CommandInvocation {
  return {
    command: nodeCommand,
    args: CLAW3D_SCRIPT_ARGS[script],
  };
}

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
    if (url === OLD_DEFAULT_WS_URL) return DEFAULT_WS_URL;
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

export function adapterPortFromWsUrl(url: string): number {
  try {
    const parsed = new URL(url);
    if (parsed.port) {
      const port = Number(parsed.port);
      if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
    }
  } catch {
    /* fall through */
  }
  return DEFAULT_ADAPTER_PORT;
}

/**
 * The model Hermes Office should default to. Office runs against the same
 * gateway as the desktop chat, so it should use the same configured model
 * rather than a generic `hermes` agent the user never selected (issue
 * #256). Falls back to `hermes` only when no model is configured.
 */
function resolveOfficeModel(profile?: string): string {
  try {
    const activeProfile = profile || getActiveProfileNameSync();
    const model = getModelConfig(activeProfile).model?.trim();
    if (model) return model;
  } catch {
    /* no model configured — fall through to the default */
  }
  return "hermes";
}

/**
 * Build the `.env` Hermes One writes into the hermes-office directory.
 * Exported so the contents (notably `HERMES_MODEL`, issue #256) can be
 * unit tested without a live Office install.
 */
export function buildOfficeEnv(opts: {
  port: number;
  url: string;
  apiKey: string;
  model: string;
  adapterPort?: number;
}): string {
  const adapterPort = opts.adapterPort ?? adapterPortFromWsUrl(opts.url);
  return [
    "# Auto-configured by Hermes One",
    `PORT=${opts.port}`,
    `HOST=127.0.0.1`,
    `NEXT_PUBLIC_GATEWAY_URL=${opts.url}`,
    `CLAW3D_GATEWAY_URL=${opts.url}`,
    `CLAW3D_GATEWAY_TOKEN=${opts.apiKey}`,
    `CLAW3D_GATEWAY_ADAPTER_TYPE=hermes`,
    `HERMES_API_KEY=${opts.apiKey}`,
    `HERMES_ADAPTER_PORT=${adapterPort}`,
    `HERMES_MODEL=${opts.model || "hermes"}`,
    `HERMES_AGENT_NAME=Hermes`,
    "",
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function buildOfficeSettings(
  existing: Record<string, unknown>,
  opts: { url: string; apiKey: string },
): Record<string, unknown> {
  const existingGateway = isRecord(existing.gateway) ? existing.gateway : {};
  const existingProfiles = isRecord(existingGateway.profiles)
    ? existingGateway.profiles
    : {};
  const hermesProfile = {
    url: opts.url,
    token: opts.apiKey,
  };
  return {
    ...existing,
    // Keep the legacy top-level fields for older Office builds and rollback.
    adapter: "hermes",
    url: opts.url,
    token: opts.apiKey,
    gateway: {
      ...existingGateway,
      url: opts.url,
      token: opts.apiKey,
      adapterType: "hermes",
      profiles: {
        ...existingProfiles,
        hermes: hermesProfile,
      },
      lastKnownGood: {
        url: opts.url,
        token: opts.apiKey,
        adapterType: "hermes",
      },
    },
  };
}

export function writeOfficeFileIfChanged(
  filePath: string,
  content: string,
): boolean {
  try {
    if (existsSync(filePath) && readFileSync(filePath, "utf-8") === content) {
      return false;
    }
  } catch {
    /* If the existing file cannot be read, try to repair it below. */
  }
  safeWriteFile(filePath, content);
  return true;
}

/**
 * Write Claw3D settings to ~/.openclaw/claw3d/settings.json
 * and .env in the claw3d directory so onboarding is skipped.
 */
function writeClaw3dSettings(wsUrl?: string, profile?: string): void {
  const activeProfile = profile || getActiveProfileNameSync();
  const url = wsUrl || getSavedWsUrl();
  const adapterPort = adapterPortFromWsUrl(url);
  // Gateway bearer token — empty string when the gateway has no API_SERVER_KEY.
  const apiKey = getApiServerKey(activeProfile);

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

    const settings = buildOfficeSettings(existing, { url, apiKey });
    writeOfficeFileIfChanged(settingsPath, JSON.stringify(settings, null, 2));
  } catch {
    /* non-fatal */
  }

  // Write .env in claw3d directory
  try {
    if (existsSync(HERMES_OFFICE_DIR)) {
      const envPath = join(HERMES_OFFICE_DIR, ".env");
      writeOfficeFileIfChanged(
        envPath,
        buildOfficeEnv({
          port: getSavedPort(),
          url,
          apiKey,
          model: resolveOfficeModel(activeProfile),
          adapterPort,
        }),
      );
    }
  } catch {
    /* non-fatal */
  }
}

function probeTcp(
  port: number,
  host = "127.0.0.1",
  timeoutMs = 300,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    socket.setTimeout(timeoutMs);
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

function checkPort(port: number): Promise<boolean> {
  return probeTcp(port);
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
  // Populated in SSH tunnel mode when a Claw3D / hermes-office service is
  // running on the remote host. Renderer should prefer this over launching
  // a local dev server. Null/undefined when not in SSH mode or when the
  // remote service is unreachable.
  remoteUrl?: string | null;
  remoteSource?: "ssh" | null;
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

// Probe an HTTP endpoint with a short timeout. Returns true if any response
// arrives (we don't care about the status code — even a 404 confirms a
// listener). Used to detect remote Claw3D / hermes-office without dragging
// in the SSH tunnel machinery.
function probeHttp(url: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      url,
      { method: "GET", timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve(true);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

export async function waitForClaw3dReady(
  timeoutMs = 45000,
  intervalMs = 1000,
): Promise<boolean> {
  const port = getSavedPort();
  const conn = getConnectionConfig();
  const host =
    conn.mode === "ssh" && conn.ssh?.host ? conn.ssh.host : "127.0.0.1";
  const url = `http://${host}:${port}/office`;
  const adapterPort = adapterPortFromWsUrl(getSavedWsUrl());
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const officeReady = await probeHttp(url, Math.min(intervalMs, 2000));
    const adapterReady =
      conn.mode === "local" || conn.mode === "remote" || !conn.ssh?.host
        ? await probeTcp(adapterPort, "127.0.0.1", Math.min(intervalMs, 2000))
        : true;

    if (officeReady && adapterReady) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return false;
}

export async function getClaw3dStatus(): Promise<Claw3dStatus> {
  const cloned = existsSync(join(HERMES_OFFICE_DIR, "package.json"));
  const installed = existsSync(join(HERMES_OFFICE_DIR, "node_modules"));
  if (installed) {
    writeClaw3dSettings();
  }
  const port = getSavedPort();
  const devRunning = isDevServerRunning();
  // Only check port conflict when dev server is NOT running
  const portInUse = devRunning ? false : await checkPort(port);
  const adapterUp = isAdapterRunning();
  const error = devServerError || adapterError;

  // SSH tunnel mode: probe the remote host for a Claw3D / hermes-office
  // service. The official systemd unit binds Next.js to :3000 by default,
  // so we try the SSH host at the saved Claw3D port. When reachable, the
  // renderer can point its webview at it instead of asking the user to
  // install Claw3D locally.
  let remoteUrl: string | null = null;
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh?.host) {
    const candidateUrl = `http://${conn.ssh.host}:${port}`;
    const reachable = await probeHttp(candidateUrl, 1500);
    if (reachable) remoteUrl = candidateUrl;
  }

  return {
    cloned,
    installed: installed || Boolean(remoteUrl),
    devServerRunning: devRunning,
    adapterRunning: adapterUp,
    running: (devRunning && adapterUp) || Boolean(remoteUrl),
    port,
    portInUse,
    wsUrl: getSavedWsUrl(),
    error,
    remoteUrl,
    remoteSource: remoteUrl ? "ssh" : null,
  };
}

let _cachedNpmCommand: ResolvedCommand | null = null;

function findNpm(envPath = getEnhancedPath()): ResolvedCommand {
  if (_cachedNpmCommand) return _cachedNpmCommand;

  const home = homedir();

  if (process.platform === "win32") {
    const resolved = resolveCommandOnPath("npm", envPath);
    if (resolved) {
      _cachedNpmCommand = resolved;
      return resolved;
    }
  }

  // Try common locations first (no process spawn).
  // Includes nvm, nvm-windows, volta, fnm, and system paths.
  const candidates = [
    ...(process.platform === "win32"
      ? [
          process.env.NVM_SYMLINK
            ? join(process.env.NVM_SYMLINK, "npm.cmd")
            : undefined,
          join(home, "AppData", "Roaming", "npm", "npm.cmd"),
          process.env.ProgramFiles
            ? join(process.env.ProgramFiles, "nodejs", "npm.cmd")
            : undefined,
          process.env["ProgramFiles(x86)"]
            ? join(process.env["ProgramFiles(x86)"], "nodejs", "npm.cmd")
            : undefined,
        ]
      : []),
    join(home, ".volta", "bin", "npm"),
    join(home, ".asdf", "shims", "npm"),
    join(home, ".local", "share", "fnm", "aliases", "default", "bin", "npm"),
    join(home, ".fnm", "aliases", "default", "bin", "npm"),
    "/usr/local/bin/npm",
    "/opt/homebrew/bin/npm",
  ].filter((candidate): candidate is string => Boolean(candidate));

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
      _cachedNpmCommand = {
        command: c,
        windowsScript:
          process.platform === "win32" && isWindowsCommandScript(c),
      };
      return _cachedNpmCommand;
    }
  }

  // Fallback path lookup only runs once because the result is cached.
  if (process.platform !== "win32") {
    const resolved = resolveCommandOnPath("npm", envPath);
    if (resolved) {
      _cachedNpmCommand = resolved;
      return resolved;
    }
  }

  _cachedNpmCommand = resolveCommand("npm", envPath);
  return _cachedNpmCommand;
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
  const git = resolveCommand("git", env.PATH);

  // Step 1: Clone (or pull if already cloned)
  const cloned = existsSync(join(HERMES_OFFICE_DIR, "package.json"));

  if (!cloned) {
    emit(1, "Cloning Claw3D repository...", "Cloning from GitHub...\n");
    await new Promise<void>((resolve, reject) => {
      const gitClone = createCommandInvocation(git, [
        "clone",
        HERMES_OFFICE_REPO,
        HERMES_OFFICE_DIR,
      ]);
      const proc = spawn(gitClone.command, gitClone.args, {
        cwd: homedir(),
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        windowsVerbatimArguments: gitClone.windowsVerbatimArguments,
      });

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
      const gitPull = createCommandInvocation(git, ["pull", "--ff-only"]);
      const proc = spawn(gitPull.command, gitPull.args, {
        cwd: HERMES_OFFICE_DIR,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        windowsVerbatimArguments: gitPull.windowsVerbatimArguments,
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
  const npm = createNpmCommandInvocation(findNpm(env.PATH), ["install"]);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(npm.command, npm.args, {
      cwd: HERMES_OFFICE_DIR,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments: npm.windowsVerbatimArguments,
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
  if (!proc.pid) return;

  if (process.platform === "win32") {
    try {
      // /F: Force terminate the process
      // /T: Terminate the specified process and any child processes started by it
      execFileSync("taskkill", ["/F", "/T", "/PID", String(proc.pid)], {
        stdio: "ignore",
      });
    } catch (err) {
      console.error(
        `[killProcessTree] taskkill failed for PID ${proc.pid}:`,
        err,
      );
      try {
        proc.kill("SIGKILL");
      } catch {
        /* already dead */
      }
    }
  } else {
    // POSIX: Kill the process group (since the process was spawned as detached)
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
    const pid = proc.pid;
    setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* already dead */
        }
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
  const env = {
    ...process.env,
    PATH: getEnhancedPath(),
    HOME: homedir(),
    TERM: "dumb",
    HERMES_API_KEY: getApiServerKey(),
    PORT: String(port),
  };
  const node = resolveCommand("node", env.PATH);
  const devScript = createClaw3dScriptInvocation("dev", node.command);
  const proc = spawn(devScript.command, devScript.args, {
    cwd: HERMES_OFFICE_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    windowsHide: true,
    windowsVerbatimArguments: devScript.windowsVerbatimArguments,
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
  // The hermes-gateway-adapter authenticates to the Hermes gateway with
  // `Authorization: Bearer ${HERMES_API_KEY}`. Without it, a gateway that
  // has an API_SERVER_KEY configured rejects the Office chat with HTTP 401.
  const env = {
    ...process.env,
    PATH: getEnhancedPath(),
    HOME: homedir(),
    TERM: "dumb",
    HERMES_API_KEY: getApiServerKey(),
    HERMES_ADAPTER_PORT: String(adapterPortFromWsUrl(getSavedWsUrl())),
  };
  const node = resolveCommand("node", env.PATH);
  const adapterScript = createClaw3dScriptInvocation(
    "hermes-adapter",
    node.command,
  );
  const proc = spawn(adapterScript.command, adapterScript.args, {
    cwd: HERMES_OFFICE_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    windowsHide: true,
    windowsVerbatimArguments: adapterScript.windowsVerbatimArguments,
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

export function startAll(profile?: string): {
  success: boolean;
  error?: string;
} {
  if (!existsSync(join(HERMES_OFFICE_DIR, "node_modules"))) {
    return {
      success: false,
      error: "Claw3D is not installed. Please install it first.",
    };
  }

  const port = getSavedPort();

  // Refresh the `.env` before the processes read it, so Office always
  // starts against the current port/URL and the desktop's configured
  // model rather than a value frozen at first setup (issue #256).
  writeClaw3dSettings(undefined, profile);

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
