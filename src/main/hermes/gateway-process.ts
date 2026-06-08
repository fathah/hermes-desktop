import { ChildProcess, spawn } from "child_process";
import { existsSync, readFileSync, appendFileSync, unlinkSync, mkdirSync, openSync, closeSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import http from "http";
import https from "https";
import { getSshTunnelUrl } from "../ssh-tunnel";
import {
  HERMES_HOME,
  HERMES_REPO,
  HERMES_PYTHON,
  hermesCliArgs,
  getEnhancedPath,
} from "../installer";
import {
  getConnectionConfig,
  getApiServerKey,
  readEnv,
} from "../config";
import {
  pidIsAliveAs,
  profileHome,
  profilePaths,
  normalizeProfileName,
  getActiveProfileNameSync,
} from "../utils";
import { getProfilePort } from "../gateway-ports";
import { HIDDEN_SUBPROCESS_OPTIONS } from "../process-options";

export function resolveProfile(profile?: string): string | undefined {
  return normalizeProfileName(profile ?? getActiveProfileNameSync());
}

export function profileKey(profile?: string): string {
  return resolveProfile(profile) ?? "default";
}

export function isRemoteMode(): boolean {
  const mode = getConnectionConfig().mode;
  return mode === "remote" || mode === "ssh";
}

export function normaliseRemoteUrl(raw: string): string {
  let url = (raw || "").trim();
  url = url.replace(/\/+$/, "");
  url = url.replace(/\/v1$/i, "");
  return url;
}

export function getApiUrl(profile?: string): string {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh") {
    // Defined dynamically from tunnel configuration
    const sshUrl = getSshTunnelUrl();
    if (sshUrl) return normaliseRemoteUrl(sshUrl);
    throw new Error("SSH tunnel is not active");
  }
  if (conn.mode === "remote" && conn.remoteUrl) {
    return normaliseRemoteUrl(conn.remoteUrl);
  }
  return `http://127.0.0.1:${getProfilePort(resolveProfile(profile))}`;
}

export let apiServerAvailable: boolean | null = null;

export function getApiServerAvailable(): boolean | null {
  return apiServerAvailable;
}

export function setApiServerAvailable(val: boolean | null): void {
  apiServerAvailable = val;
}

export async function isApiServerReady(profile?: string): Promise<boolean> {
  const url = `${getApiUrl(profile)}/health`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);

    const res = await fetch(url, {
      method: "GET",
      headers: getRemoteAuthHeader(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    return res.status === 200;
  } catch {
    return false;
  }
}

// SSH-Remote API Key Cache
let _sshRemoteApiKey = "";

export function setSshRemoteApiKey(key: string): void {
  _sshRemoteApiKey = key;
}

export function getRemoteAuthHeader(): Record<string, string> {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh") {
    if (_sshRemoteApiKey)
      return { Authorization: `Bearer ${_sshRemoteApiKey}` };
    return {};
  }
  if (conn.mode === "remote" && conn.apiKey) {
    return { Authorization: `Bearer ${conn.apiKey}` };
  }
  return {};
}

export function resolveRemoteApiKey(url: string, apiKey?: string): string {
  if (apiKey !== undefined) return apiKey;

  const conn = getConnectionConfig();
  if (conn.mode !== "remote" || !conn.apiKey || !conn.remoteUrl) return "";
  if (normaliseRemoteUrl(conn.remoteUrl) !== normaliseRemoteUrl(url)) {
    return "";
  }
  return conn.apiKey;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForApiServerReady(
  timeoutMs = 8000,
  profile?: string,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isApiServerReady(profile)) return true;
    await delay(250);
  }
  return false;
}

export function ensureApiServerConfig(profile?: string): void {
  try {
    const { configFile } = profilePaths(resolveProfile(profile));
    if (!existsSync(configFile)) return;
    const content = readFileSync(configFile, "utf-8");
    if (/api_server/i.test(content)) return;
    const port = getProfilePort(profile);
    const addition = `
# Desktop app API server (auto-configured)
platforms:
  api_server:
    enabled: true
    extra:
      port: ${port}
      host: "127.0.0.1"
`;
    appendFileSync(configFile, addition, "utf-8");
  } catch {
    /* non-fatal */
  }
}

const gatewayProcesses = new Map<string, ChildProcess>();
const appStartedProfiles = new Set<string>();

function invalidateApiCacheFor(profile?: string): void {
  if (profileKey(profile) === profileKey(undefined)) {
    apiServerAvailable = false;
  }
}

export function startGateway(profile?: string): boolean {
  if (isRemoteMode()) {
    console.warn(
      "[gateway] startGateway() called in remote/SSH mode — refusing local spawn",
    );
    return false;
  }
  ensureInitialized();
  if (isGatewayRunning(profile)) return false;

  if (!existsSync(HERMES_PYTHON)) {
    console.error(
      `[gateway] Cannot start: Python interpreter not found at ${HERMES_PYTHON}. ` +
        "Is hermes-agent installed?",
    );
    return false;
  }
  if (!existsSync(HERMES_REPO)) {
    console.error(
      `[gateway] Cannot start: hermes-agent repo not found at ${HERMES_REPO}. ` +
        "Is hermes-agent installed?",
    );
    return false;
  }

  const resolved = resolveProfile(profile);
  const key = profileKey(profile);

  ensureApiServerConfig(profile);
  const port = getProfilePort(profile);

  const gatewayEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PATH: getEnhancedPath(),
    HOME: homedir(),
    HERMES_HOME: HERMES_HOME,
    API_SERVER_ENABLED: "true",
    API_SERVER_PORT: String(port),
  };

  const profileEnv = readEnv(profile);
  for (const [k, value] of Object.entries(profileEnv)) {
    if (value) {
      gatewayEnv[k] = value;
    }
  }

  const resolvedApiServerKey = getApiServerKey(profile);
  if (resolvedApiServerKey) {
    gatewayEnv.API_SERVER_KEY = resolvedApiServerKey;
  }

  const logDir = profileHome(resolved);
  try {
    mkdirSync(logDir, { recursive: true });
  } catch {
    // ignore
  }
  const logPath = join(logDir, "gateway-stderr.log");
  let stderrFd: number;
  try {
    stderrFd = openSync(logPath, "a");
  } catch {
    stderrFd = -1;
  }

  const cliArgs = resolved ? ["--profile", resolved, "gateway"] : ["gateway"];
  const proc = spawn(HERMES_PYTHON, hermesCliArgs(cliArgs), {
    cwd: HERMES_REPO,
    env: gatewayEnv,
    stdio: ["ignore", "ignore", stderrFd >= 0 ? stderrFd : "ignore"],
    detached: true,
    ...HIDDEN_SUBPROCESS_OPTIONS,
  });

  if (stderrFd >= 0) {
    try {
      closeSync(stderrFd);
    } catch {
      // best-effort
    }
  }

  proc.on("error", (err) => {
    console.error(
      `[gateway:${key}] Failed to spawn gateway process:`,
      err.message,
    );
    if (gatewayProcesses.get(key) === proc) gatewayProcesses.delete(key);
    appStartedProfiles.delete(key);
    invalidateApiCacheFor(profile);
  });

  proc.on("close", (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(
        `[gateway:${key}] Process exited with code ${code}${signal ? ` (signal: ${signal})` : ""}. ` +
          `Check ${logPath} for details.`,
      );
    }
    if (gatewayProcesses.get(key) === proc) gatewayProcesses.delete(key);
    appStartedProfiles.delete(key);
    invalidateApiCacheFor(profile);
    startHealthPolling();
  });

  proc.unref();
  gatewayProcesses.set(key, proc);
  appStartedProfiles.add(key);

  setTimeout(async () => {
    if (profileKey(profile) === profileKey(undefined)) {
      apiServerAvailable = await isApiServerReady(profile);
    }
  }, 3000);

  return true;
}

function parsePidFromFile(pidFile: string): number | null {
  if (!existsSync(pidFile)) return null;
  try {
    const raw = readFileSync(pidFile, "utf-8").trim();
    const parsed = raw.startsWith("{")
      ? JSON.parse(raw).pid
      : parseInt(raw, 10);
    return typeof parsed === "number" && !isNaN(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function gatewayPidPath(profile?: string): string {
  return join(profileHome(resolveProfile(profile)), "gateway.pid");
}

function readPidFile(profile?: string): number | null {
  return parsePidFromFile(gatewayPidPath(profile));
}

export function stopGateway(profile?: string, force = false): void {
  const key = profileKey(profile);
  if (!force && !appStartedProfiles.has(key)) return;

  const proc = gatewayProcesses.get(key);
  if (proc && !proc.killed) {
    proc.kill("SIGTERM");
  }
  gatewayProcesses.delete(key);

  const pid = readPidFile(profile);
  if (pid) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already dead
    }
  }
  const pidFile = gatewayPidPath(profile);
  if (existsSync(pidFile)) {
    try {
      unlinkSync(pidFile);
    } catch {
      // best-effort
    }
  }
  appStartedProfiles.delete(key);
  invalidateApiCacheFor(profile);
}

const GATEWAY_IMAGE_PREFIXES = ["python", "pythonw"];

export function isGatewayRunning(profile?: string): boolean {
  const proc = gatewayProcesses.get(profileKey(profile));
  if (proc && !proc.killed) return true;
  const pid = readPidFile(profile);
  if (!pid) return false;
  return pidIsAliveAs(pid, GATEWAY_IMAGE_PREFIXES);
}

export function isApiReady(): boolean {
  return apiServerAvailable === true;
}

export function testRemoteConnection(
  url: string,
  apiKey?: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const target = `${normaliseRemoteUrl(url)}/health`;
    const mod = target.startsWith("https") ? https : http;
    const headers: Record<string, string> = {};
    const resolvedApiKey = resolveRemoteApiKey(url, apiKey);
    if (resolvedApiKey) headers.Authorization = `Bearer ${resolvedApiKey}`;
    const req = mod.request(
      target,
      { method: "GET", timeout: 5000, headers },
      (res) => {
        resolve(res.statusCode === 200);
        res.resume();
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

export function restartGateway(profile?: string): void {
  if (isRemoteMode()) return;
  const key = profileKey(profile);
  if (!appStartedProfiles.has(key) && !isGatewayRunning(profile)) return;
  stopGateway(profile, true);
  setTimeout(() => {
    startGateway(profile);
  }, 500);
}

export function notifyProfileSwitched(): void {
  apiServerAvailable = null;
}

let _initialized = false;
let _healthCheckInterval: ReturnType<typeof setInterval> | null = null;

function ensureInitialized(): void {
  if (_initialized) return;
  _initialized = true;
  startHealthPolling();
}

export function startHealthPolling(): void {
  if (_healthCheckInterval) return;
  _healthCheckInterval = setInterval(async () => {
    apiServerAvailable = await isApiServerReady();
    if (apiServerAvailable && _healthCheckInterval) {
      clearInterval(_healthCheckInterval);
      _healthCheckInterval = null;
    }
  }, 15000);
}

export function stopHealthPolling(): void {
  if (_healthCheckInterval) {
    clearInterval(_healthCheckInterval);
    _healthCheckInterval = null;
  }
}
