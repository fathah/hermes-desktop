import { ChildProcess, spawn } from "child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  unlinkSync,
  mkdirSync,
  openSync,
  closeSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import http from "node:http";
import https from "node:https";
import { getSshTunnelUrl } from "../ssh-tunnel";
import {
  HERMES_HOME,
  HERMES_REPO,
  HERMES_PYTHON,
  hermesCliArgs,
  getEnhancedPath,
} from "../installer";
import { getConnectionConfig, getApiServerKey, readEnv } from "../config";
import { gatewayFetch } from "../security/network-policy";
import {
  pidIsAliveAs,
  profileHome,
  profilePaths,
  normalizeProfileName,
  getActiveProfileNameSync,
} from "../utils";
import { getProfilePort } from "../gateway-ports";
import { HIDDEN_SUBPROCESS_OPTIONS } from "../process-options";
import {
  decideSupervisorAction,
  initialSupervisorState,
  DEFAULT_SUPERVISOR_CONFIG,
  type SupervisorState,
  type GatewayHealthStatus,
} from "./gateway-supervisor";
import { log, rotateGatewayStderrIfLarge } from "../log";
import type { GatewayStartResult } from "../../shared/gateway";

export interface GatewayProcessRuntime {
  spawn: typeof spawn;
  gatewayFetch: typeof gatewayFetch;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  now: () => number;
}

function defaultGatewayProcessRuntime(): GatewayProcessRuntime {
  return {
    spawn,
    gatewayFetch,
    setTimeout: globalThis.setTimeout.bind(globalThis) as typeof setTimeout,
    clearTimeout: globalThis.clearTimeout.bind(
      globalThis,
    ) as typeof clearTimeout,
    setInterval: globalThis.setInterval.bind(globalThis) as typeof setInterval,
    clearInterval: globalThis.clearInterval.bind(
      globalThis,
    ) as typeof clearInterval,
    now: () => Date.now(),
  };
}

let gatewayProcessRuntime = defaultGatewayProcessRuntime();

export function __setGatewayProcessRuntimeForTests(
  runtime: Partial<GatewayProcessRuntime>,
): void {
  gatewayProcessRuntime = { ...gatewayProcessRuntime, ...runtime };
}

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

let chatTransportCacheGeneration = 0;

export function getChatTransportCacheGeneration(): number {
  return chatTransportCacheGeneration;
}

export async function isApiServerReady(profile?: string): Promise<boolean> {
  const url = `${getApiUrl(profile)}/health`;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const controller = new AbortController();
    timeoutId = gatewayProcessRuntime.setTimeout(
      () => controller.abort(),
      1500,
    );

    const res = await gatewayProcessRuntime.gatewayFetch(url, {
      method: "GET",
      headers: getRemoteAuthHeader(),
      signal: controller.signal,
    });

    return res.status === 200;
  } catch (err) {
    log.warn("gateway.ready", {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  } finally {
    if (timeoutId) gatewayProcessRuntime.clearTimeout(timeoutId);
  }
}

// SSH-Remote API Key Cache
let _sshRemoteApiKey = "";

export function setSshRemoteApiKey(key: string): void {
  _sshRemoteApiKey = key;
}

// Phase 1.4 — drop the cached SSH-remote API key (and invalidate the readiness
// cache) on any connection-mode change or tunnel teardown. Without this, a key
// fetched for one SSH host lingers in memory indefinitely and would be sent to a
// different host after the user switches connections.
export function clearSshRemoteApiKey(): void {
  _sshRemoteApiKey = "";
  apiServerAvailable = null;
  chatTransportCacheGeneration += 1;
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
  // Local (managed) gateway: when the gateway enforces an API server key, send
  // it — mirroring the chat path (chat-client.ts). Without this, every direct
  // gateway fetch that authenticates via this helper (SPS assistant/ingest/
  // file-answer/file-research/lint, cronjobs, self-healing, skills) 401s against
  // a key-protected local gateway while streaming chat works. No-op (returns {})
  // when no key is configured, so keyless local gateways are unaffected.
  const localKey = getApiServerKey();
  if (localKey) return { Authorization: `Bearer ${localKey}` };
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
  return new Promise((resolve) =>
    gatewayProcessRuntime.setTimeout(resolve, ms),
  );
}

export async function waitForApiServerReady(
  timeoutMs = 8000,
  profile?: string,
  pollMs = 250,
): Promise<boolean> {
  const deadline = gatewayProcessRuntime.now() + timeoutMs;
  while (gatewayProcessRuntime.now() < deadline) {
    if (await isApiServerReady(profile)) return true;
    await delay(pollMs);
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

function setApiCacheFor(profile: string | undefined, value: boolean): void {
  if (profileKey(profile) === profileKey(undefined)) {
    apiServerAvailable = value;
  }
}

export function startGatewayDetailed(profile?: string): GatewayStartResult {
  if (isRemoteMode()) {
    const error =
      "The local gateway can only be started in local mode. Switch to local mode, or start the gateway on the remote Hermes host.";
    console.warn(
      "[gateway] startGateway() called in remote/SSH mode — refusing local spawn",
    );
    return { success: false, running: false, error };
  }
  ensureInitialized();
  if (isGatewayRunning(profile)) {
    return { success: true, running: true, alreadyRunning: true };
  }

  if (!existsSync(HERMES_PYTHON)) {
    const error =
      `Cannot start the gateway because the Hermes Python interpreter was not found at ${HERMES_PYTHON}. ` +
      "Install or repair Hermes Agent, then try again.";
    console.error(`[gateway] ${error}`);
    return { success: false, running: false, error };
  }
  if (!existsSync(HERMES_REPO)) {
    const error =
      `Cannot start the gateway because the hermes-agent repository was not found at ${HERMES_REPO}. ` +
      "Install or repair Hermes Agent, then try again.";
    console.error(`[gateway] ${error}`);
    return { success: false, running: false, error };
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
  // Phase 1.6 — keep the gateway stderr log from ballooning across many restarts.
  rotateGatewayStderrIfLarge(logPath);
  let stderrFd: number;
  try {
    stderrFd = openSync(logPath, "a");
  } catch {
    stderrFd = -1;
  }

  const cliArgs = resolved ? ["--profile", resolved, "gateway"] : ["gateway"];
  let proc: ChildProcess;
  try {
    proc = gatewayProcessRuntime.spawn(HERMES_PYTHON, hermesCliArgs(cliArgs), {
      cwd: HERMES_REPO,
      env: gatewayEnv,
      stdio: ["ignore", "ignore", stderrFd >= 0 ? stderrFd : "ignore"],
      detached: true,
      ...HIDDEN_SUBPROCESS_OPTIONS,
    });
  } catch (err) {
    if (stderrFd >= 0) {
      try {
        closeSync(stderrFd);
      } catch {
        // best-effort
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    const error = `Failed to start the gateway process: ${message}`;
    console.error(`[gateway:${key}] ${error}`);
    return { success: false, running: false, error, logPath };
  }

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

  gatewayProcessRuntime.setTimeout(() => {
    if (profileKey(profile) !== profileKey(undefined)) return;
    // LOW-4: don't let a rejection here become an unhandled promise rejection.
    isApiServerReady(profile)
      .then((ready) => {
        apiServerAvailable = ready;
        if (ready) notifyGatewayReady(profile);
      })
      .catch((err) => {
        console.warn("[hermes] post-spawn readiness probe failed:", err);
      });
  }, 3000);

  return { success: true, running: true, logPath };
}

export function startGateway(profile?: string): boolean {
  const result = startGatewayDetailed(profile);
  return result.success && !result.alreadyRunning;
}

function gatewayPidPath(profile?: string): string {
  return join(profileHome(resolveProfile(profile)), "gateway.pid");
}

function readPidFile(profile?: string): number | null {
  return readPidFileEntry(profile)?.pid ?? null;
}

function readPidFileEntry(
  profile?: string,
): { path: string; pid: number; raw: string } | null {
  const path = gatewayPidPath(profile);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8").trim();
    const parsed = raw.startsWith("{")
      ? JSON.parse(raw).pid
      : parseInt(raw, 10);
    const pid = typeof parsed === "number" && !isNaN(parsed) ? parsed : null;
    return pid === null ? null : { path, pid, raw };
  } catch {
    return null;
  }
}

export function stopGateway(profile?: string, force = false): void {
  const key = profileKey(profile);
  if (!force && !appStartedProfiles.has(key)) return;

  const proc = gatewayProcesses.get(key);
  if (proc && isChildProcessAlive(proc)) {
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

function isChildProcessAlive(proc: ChildProcess): boolean {
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return false;
  }
  if (typeof proc.pid !== "number") return !proc.killed;
  try {
    process.kill(proc.pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isGatewayRunning(profile?: string): boolean {
  const proc = gatewayProcesses.get(profileKey(profile));
  if (proc && isChildProcessAlive(proc)) return true;
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

async function waitForApiServerStopped(
  profile?: string,
  timeoutMs = 5000,
  pollMs = 250,
): Promise<boolean> {
  const deadline = gatewayProcessRuntime.now() + timeoutMs;
  while (gatewayProcessRuntime.now() < deadline) {
    if (!(await isApiServerReady(profile))) return true;
    await delay(pollMs);
  }
  return false;
}

let gatewayRestartQueueTail: Promise<unknown> = Promise.resolve();
const gatewayRestartByProfile = new Map<string, Promise<boolean>>();

function markGatewayRestartFailed(profile?: string): void {
  const key = profileKey(profile);
  const proc = gatewayProcesses.get(key);
  if (proc && isChildProcessAlive(proc)) {
    proc.kill("SIGTERM");
  }
  gatewayProcesses.delete(key);
  appStartedProfiles.delete(key);
  invalidateApiCacheFor(profile);
  startHealthPolling();
}

function restoreGatewayAfterRestartFailure(
  profile: string | undefined,
  previousProcess: ChildProcess | null,
  previousStartedByApp: boolean,
  previousPidEntry: { path: string; pid: number; raw: string } | null,
): void {
  const key = profileKey(profile);
  if (previousProcess && isChildProcessAlive(previousProcess)) {
    gatewayProcesses.set(key, previousProcess);
    if (previousStartedByApp) {
      appStartedProfiles.add(key);
    } else {
      appStartedProfiles.delete(key);
    }
    invalidateApiCacheFor(profile);
    startHealthPolling();
    return;
  }
  if (
    previousPidEntry &&
    pidIsAliveAs(previousPidEntry.pid, GATEWAY_IMAGE_PREFIXES)
  ) {
    try {
      writeFileSync(
        previousPidEntry.path,
        previousPidEntry.raw || String(previousPidEntry.pid),
        "utf-8",
      );
    } catch {
      // best-effort; health polling will still recover readiness.
    }
    gatewayProcesses.delete(key);
    if (previousStartedByApp) {
      appStartedProfiles.add(key);
    } else {
      appStartedProfiles.delete(key);
    }
    invalidateApiCacheFor(profile);
    startHealthPolling();
    return;
  }
  markGatewayRestartFailed(profile);
}

async function restartGatewayLocallyOnce(
  profile?: string,
  healthTimeoutMs = 30000,
  healthPollMs = 250,
  stopTimeoutMs = 5000,
): Promise<boolean> {
  try {
    if (isRemoteMode()) return false;
    ensureInitialized();

    const key = profileKey(profile);
    const previousProcess = gatewayProcesses.get(key) ?? null;
    const previousStartedByApp = appStartedProfiles.has(key);
    const previousPidEntry = readPidFileEntry(profile);

    stopGateway(profile, true);
    const stopped = await waitForApiServerStopped(
      profile,
      stopTimeoutMs,
      healthPollMs,
    );
    if (!stopped) {
      console.error(
        `[gateway:${key}] Restart failed: gateway did not stop before restart`,
      );
      restoreGatewayAfterRestartFailure(
        profile,
        previousProcess,
        previousStartedByApp,
        previousPidEntry,
      );
      return false;
    }

    const started = startGateway(profile);
    if (!started) {
      const alreadyReady = await waitForApiServerReady(
        healthTimeoutMs,
        profile,
        healthPollMs,
      );
      setApiCacheFor(profile, alreadyReady);
      if (alreadyReady) notifyGatewayReady(profile);
      return alreadyReady;
    }

    const ready = await waitForApiServerReady(
      healthTimeoutMs,
      profile,
      healthPollMs,
    );
    setApiCacheFor(profile, ready);
    if (ready) notifyGatewayReady(profile);
    if (!ready) markGatewayRestartFailed(profile);
    return ready;
  } catch (err) {
    console.error("[gateway] Restart failed:", (err as Error).message);
    markGatewayRestartFailed(profile);
    return false;
  }
}

export function restartGateway(
  profile?: string,
  healthTimeoutMs = 30000,
  healthPollMs = 250,
  stopTimeoutMs = 5000,
): Promise<boolean> {
  if (isRemoteMode()) return Promise.resolve(false);

  const key = profileKey(profile);
  const existing = gatewayRestartByProfile.get(key);
  if (existing) return existing;

  const queued = gatewayRestartQueueTail.then(
    () =>
      restartGatewayLocallyOnce(
        profile,
        healthTimeoutMs,
        healthPollMs,
        stopTimeoutMs,
      ),
    () =>
      restartGatewayLocallyOnce(
        profile,
        healthTimeoutMs,
        healthPollMs,
        stopTimeoutMs,
      ),
  );

  const promise = queued.finally(() => {
    if (gatewayRestartByProfile.get(key) === promise) {
      gatewayRestartByProfile.delete(key);
    }
  });

  gatewayRestartByProfile.set(key, promise);
  gatewayRestartQueueTail = promise.catch(() => undefined);
  return promise;
}

export async function startGatewayWithRecovery(
  profile?: string,
  healthTimeoutMs = 8000,
  healthPollMs = 250,
  restartHealthTimeoutMs = 30000,
  restartStopTimeoutMs = 5000,
): Promise<boolean> {
  if (isRemoteMode()) return false;

  if (isGatewayRunning(profile)) {
    const healthy = await isApiServerReady(profile);
    if (healthy) {
      setApiCacheFor(profile, true);
      notifyGatewayReady(profile);
      return true;
    }
    return restartGateway(
      profile,
      restartHealthTimeoutMs,
      healthPollMs,
      restartStopTimeoutMs,
    );
  }

  const started = startGateway(profile);
  if (!started) return false;

  const ready = await waitForApiServerReady(
    healthTimeoutMs,
    profile,
    healthPollMs,
  );
  if (ready) {
    setApiCacheFor(profile, true);
    notifyGatewayReady(profile);
    return true;
  }

  return restartGateway(
    profile,
    restartHealthTimeoutMs,
    healthPollMs,
    restartStopTimeoutMs,
  );
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

// Phase 1.1 — permanent gateway supervisor.
//
// The old poll self-cancelled the moment the gateway first reported healthy, so a
// *hang* after startup (process alive, /health unresponsive) was never re-detected.
// This is now a permanent 30s loop (local mode only, while a gateway is started)
// that feeds each probe into the pure decision machine in gateway-supervisor.ts and
// auto-recovers: 3 consecutive failures -> kill + restart with exponential backoff
// (bounded attempts) -> a persistent visible "down" state. It never restarts under
// an open interactive stream.

const SUPERVISOR_INTERVAL_MS = 30000;

let _supervisorState: SupervisorState = initialSupervisorState();
let _healthBroadcaster: ((status: GatewayHealthStatus) => void) | null = null;
let _streamOpenProvider: () => boolean = () => false;
let _gatewayReadyNotifier: ((profile?: string) => void) | null = null;

// index.ts injects the renderer broadcaster (kept out of this module so it has no
// Electron dependency and stays vitest-importable).
export function setGatewayHealthBroadcaster(
  fn: (status: GatewayHealthStatus) => void,
): void {
  _healthBroadcaster = fn;
}

// index.ts injects "is an interactive chat stream in-flight?" (activeChatAborts.size).
export function setStreamOpenProvider(fn: () => boolean): void {
  _streamOpenProvider = fn;
}

export function setGatewayReadyNotifier(fn: (profile?: string) => void): void {
  _gatewayReadyNotifier = fn;
}

export function getGatewayHealthStatus(): GatewayHealthStatus {
  return _supervisorState.status;
}

function isStreamOpen(): boolean {
  try {
    return _streamOpenProvider();
  } catch {
    return false;
  }
}

function broadcastGatewayHealth(status: GatewayHealthStatus): void {
  try {
    _healthBroadcaster?.(status);
  } catch (err) {
    console.warn("[gateway] health broadcast failed:", err);
  }
}

function notifyGatewayReady(profile?: string): void {
  try {
    _gatewayReadyNotifier?.(profile);
  } catch (err) {
    console.warn("[gateway] ready notifier failed:", err);
  }
}

function scheduleSupervisedRestart(backoffMs: number): void {
  gatewayProcessRuntime.setTimeout(() => {
    // Re-check the guards at fire time — conditions may have changed during backoff.
    if (isRemoteMode()) return;
    if (isStreamOpen()) return;
    void restartGateway();
  }, backoffMs);
}

async function runSupervisorTick(): Promise<void> {
  // Only ever supervise a local managed gateway.
  if (isRemoteMode()) return;

  // Nothing to supervise until a gateway has been started (or is running). Reset
  // to a clean baseline so a later start begins fresh.
  const supervising = appStartedProfiles.size > 0 || isGatewayRunning();
  if (!supervising) {
    if (_supervisorState.status !== "healthy") {
      _supervisorState = initialSupervisorState();
    }
    return;
  }

  const healthy = await isApiServerReady();
  apiServerAvailable = healthy; // keep the pull-side cache permanently fresh
  const streamOpen = isStreamOpen();

  const decision = decideSupervisorAction(
    _supervisorState,
    { healthy, streamOpen },
    DEFAULT_SUPERVISOR_CONFIG,
  );
  _supervisorState = decision.state;

  if (decision.statusChanged) {
    log.info("gateway-supervisor", {
      msg: "health changed",
      status: decision.state.status,
      consecutiveFailures: decision.state.consecutiveFailures,
      restartAttempts: decision.state.restartAttempts,
    });
    broadcastGatewayHealth(decision.state.status);
    if (decision.state.status === "healthy") notifyGatewayReady();
  }
  if (decision.action.type === "restart") {
    log.warn("gateway-supervisor", {
      msg: "scheduling auto-restart",
      backoffMs: decision.action.backoffMs,
      attempt: decision.state.restartAttempts,
    });
    scheduleSupervisedRestart(decision.action.backoffMs);
  }
}

export function startHealthPolling(): void {
  if (_healthCheckInterval) return;
  _healthCheckInterval = gatewayProcessRuntime.setInterval(() => {
    void runSupervisorTick();
  }, SUPERVISOR_INTERVAL_MS);
}

export function stopHealthPolling(): void {
  if (_healthCheckInterval) {
    gatewayProcessRuntime.clearInterval(_healthCheckInterval);
    _healthCheckInterval = null;
  }
}

export function __resetGatewayProcessForTests(): void {
  for (const proc of gatewayProcesses.values()) {
    if (isChildProcessAlive(proc)) {
      try {
        proc.kill("SIGTERM");
      } catch {
        // best-effort test cleanup
      }
    }
  }
  gatewayProcesses.clear();
  appStartedProfiles.clear();
  gatewayRestartByProfile.clear();
  gatewayRestartQueueTail = Promise.resolve();
  stopHealthPolling();
  apiServerAvailable = null;
  chatTransportCacheGeneration = 0;
  _sshRemoteApiKey = "";
  _initialized = false;
  _supervisorState = initialSupervisorState();
  _healthBroadcaster = null;
  _streamOpenProvider = () => false;
  _gatewayReadyNotifier = null;
  gatewayProcessRuntime = defaultGatewayProcessRuntime();
}
