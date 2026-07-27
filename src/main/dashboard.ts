import { spawn, type ChildProcess } from "child_process";
import { randomBytes } from "crypto";
import { closeSync, existsSync, mkdirSync, openSync } from "fs";
import http from "http";
import https from "https";
import net from "net";
import { homedir } from "os";
import { join } from "path";
import { getConnectionConfig, type ConnectionConfig } from "./config";
import {
  getEnhancedPath,
  hermesCliArgs,
  HERMES_HOME,
  HERMES_PYTHON,
  HERMES_REPO,
} from "./installer";
import { buildLocalDashboardCliArgs } from "./dashboard-launch";
import { dashboardWebSocketUrlForRenderer } from "./dashboard-websocket-relay";
import { ensureLocalDashboardCompatibility } from "./hermes-agent-compat";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";
import {
  buildRemoteOAuthWsUrl,
  mintRemoteOAuthWsTicket,
  probeRemoteAuthMode,
  remoteOAuthSessionState,
  requestRemoteOAuthJson,
} from "./remote-oauth";
import { ensureSshTunnel, getSshTunnelUrl } from "./ssh-tunnel";
import { sshEnsureDashboard } from "./ssh-remote";
import {
  getActiveProfileNameSync,
  normalizeProfileName,
  profileHome,
} from "./utils";

export interface DashboardConnection {
  baseUrl: string;
  wsUrl: string;
  token: string;
  authMode?: "token" | "oauth";
  mode: "local" | "remote" | "ssh";
  profile?: string;
  pid?: number;
  port?: number;
  logPath?: string;
  alreadyRunning?: boolean;
}

export interface DashboardStatus {
  supported: boolean;
  running: boolean;
  connection?: DashboardConnection;
  error?: string;
  logPath?: string;
  needsOAuthLogin?: boolean;
}

interface ManagedDashboard {
  proc: ChildProcess;
  connection: DashboardConnection;
}

const dashboards = new Map<string, ManagedDashboard>();

function resolveProfile(profile?: string): string | undefined {
  return normalizeProfileName(profile ?? getActiveProfileNameSync());
}

function profileKey(profile?: string): string {
  return resolveProfile(profile) ?? "default";
}

function dashboardWsUrl(baseUrl: string, token: string): string {
  const url = new URL("/api/ws", baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  return url.toString();
}

function normalizeRemoteDashboardBaseUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    if (url.pathname === "/v1" || url.pathname === "/api") {
      url.pathname = "";
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function remoteDashboardConnectionFromConfig(
  config: ConnectionConfig,
  profile?: string,
): DashboardConnection | null {
  if (config.mode !== "remote") return null;
  const baseUrl = normalizeRemoteDashboardBaseUrl(config.remoteUrl);
  const token = config.apiKey.trim();
  const authMode = config.remoteAuthMode === "oauth" ? "oauth" : "token";
  if (!baseUrl || (authMode === "token" && !token)) return null;
  return {
    baseUrl,
    wsUrl: authMode === "oauth" ? "" : dashboardWsUrl(baseUrl, token),
    token: authMode === "oauth" ? "" : token,
    authMode,
    mode: "remote",
    profile: resolveProfile(profile),
  };
}

export function sshDashboardConnectionFromTunnel(
  config: ConnectionConfig,
  baseUrl: string | null,
  token: string,
  profile?: string,
): DashboardConnection | null {
  if (config.mode !== "ssh") return null;
  const normalizedBaseUrl = normalizeRemoteDashboardBaseUrl(baseUrl || "");
  const cleanToken = token.trim();
  if (!normalizedBaseUrl || !cleanToken) return null;
  return {
    baseUrl: normalizedBaseUrl,
    wsUrl: dashboardWsUrl(normalizedBaseUrl, cleanToken),
    token: cleanToken,
    authMode: "token",
    mode: "ssh",
    profile: resolveProfile(profile),
  };
}

async function sshDashboardConnectionFromConfig(
  config: ConnectionConfig,
  profile?: string,
): Promise<DashboardConnection | null> {
  if (config.mode !== "ssh" || !config.ssh) return null;

  // Start `hermes dashboard` on the remote and tunnel to it (full parity with
  // local mode). NB: the dashboard is NOT a /v1 superset — web_server.py has no
  // /v1 chat routes (those live only on the gateway api_server, port 8642).
  // This tunnel serves the /api/* set and the /api/ws chat WebSocket, gated by
  // the dashboard session token, which is the SSH credential here. Returns
  // null when the remote can't run the dashboard (no Node / no web dist) —
  // the caller then falls back to legacy over the gateway /v1 tunnel.
  const dash = await sshEnsureDashboard(config.ssh, profile);
  if (!dash) return null;

  await ensureSshTunnel({ ...config.ssh, remotePort: dash.port });
  return sshDashboardConnectionFromTunnel(
    config,
    getSshTunnelUrl(),
    dash.token,
    profile,
  );
}

function getManagedDashboard(profile?: string): ManagedDashboard | undefined {
  const key = profileKey(profile);
  const managed = dashboards.get(key);
  if (!managed) return undefined;
  if (managed.proc.exitCode === null && !managed.proc.killed) return managed;
  dashboards.delete(key);
  return undefined;
}

function unsupportedReasonForLocalSpawn(): string | undefined {
  if (!existsSync(HERMES_REPO)) {
    return `Hermes repo not found at ${HERMES_REPO}.`;
  }
  if (!existsSync(HERMES_PYTHON)) {
    return `Hermes Python environment not found at ${HERMES_PYTHON}.`;
  }
  return undefined;
}

function dashboardLogPath(profile: string | undefined): string {
  const dir = profileHome(profile);
  mkdirSync(dir, { recursive: true });
  return join(dir, "dashboard-stderr.log");
}

function dashboardHasPrebuiltWebDist(): boolean {
  return existsSync(join(HERMES_REPO, "hermes_cli", "web_dist", "index.html"));
}

async function getFreePort(): Promise<number> {
  const preferred = Number(process.env.HERMES_DESKTOP_DASHBOARD_PORT);
  if (Number.isInteger(preferred) && preferred > 0 && preferred < 65536) {
    if (await isPortFree(preferred)) return preferred;
  }

  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port =
        typeof address === "object" && address !== null ? address.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

function requestJson(
  url: string,
  token: string,
  timeoutMs = 2_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;
    const req = client.request(
      parsed,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Hermes-Session-Token": token,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("error", reject);
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 500) >= 400) {
            reject(
              new Error(`${res.statusCode}: ${text || res.statusMessage}`),
            );
            return;
          }
          if (!text) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(
              new Error(
                `Invalid JSON from ${url} (status ${res.statusCode}): ${text.slice(
                  0,
                  200,
                )}`,
              ),
            );
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(
        new Error(
          `Timed out connecting to Hermes dashboard after ${timeoutMs}ms`,
        ),
      );
    });
    req.end();
  });
}

export function probeDashboardWebSocket(
  connection: DashboardConnection,
  timeoutMs = 2_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(connection.wsUrl);
    const client = parsed.protocol === "wss:" ? https : http;
    parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
    const req = client.request(parsed, {
      method: "GET",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
        "Sec-WebSocket-Version": "13",
      },
    });

    let settled = false;
    const finish = (err?: Error): void => {
      if (settled) return;
      settled = true;
      req.destroy();
      if (err) reject(err);
      else resolve();
    };

    req.on("upgrade", (_res, socket) => {
      socket.destroy();
      finish();
    });
    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8").trim();
        finish(
          new Error(
            `Hermes dashboard chat WebSocket is unavailable (${res.statusCode}${
              body ? `: ${body.slice(0, 160)}` : ""
            })`,
          ),
        );
      });
    });
    req.on("error", (err) => finish(err));
    req.setTimeout(timeoutMs, () => {
      finish(
        new Error(
          `Timed out connecting to Hermes dashboard chat WebSocket after ${timeoutMs}ms`,
        ),
      );
    });
    req.end();
  });
}

async function waitForDashboardReady(
  connection: DashboardConnection,
  timeoutMs = 45_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await requestJson(`${connection.baseUrl}/api/status`, connection.token);
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  const message =
    lastError instanceof Error
      ? lastError.message
      : "dashboard did not respond";
  throw new Error(`Timed out waiting for Hermes dashboard: ${message}`);
}

function dashboardStatusRequiresOAuth(status: unknown): boolean {
  return (
    typeof status === "object" &&
    status !== null &&
    (status as { auth_required?: unknown }).auth_required === true
  );
}

function errorNeedsOAuthLogin(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { needsOAuthLogin?: unknown }).needsOAuthLogin === true
  );
}

export async function getRemoteDashboardStatusForConfig(
  config: ConnectionConfig,
  profile?: string,
): Promise<DashboardStatus> {
  if (config.remoteChatTransport === "legacy") {
    return {
      supported: false,
      running: false,
      error: "Remote dashboard transport is disabled in Settings.",
    };
  }

  const baseUrl = normalizeRemoteDashboardBaseUrl(config.remoteUrl);
  if (!baseUrl) {
    return {
      supported: true,
      running: false,
      error: "Remote dashboard transport needs a valid dashboard URL.",
    };
  }

  let connection: DashboardConnection | undefined;
  try {
    const detected = await probeRemoteAuthMode(baseUrl);
    connection =
      remoteDashboardConnectionFromConfig(
        { ...config, remoteAuthMode: detected.authMode },
        profile,
      ) ?? undefined;

    if (detected.authMode === "oauth") {
      if (!connection) throw new Error("Could not resolve remote OAuth URL.");
      const sessionState = await remoteOAuthSessionState(baseUrl);
      if (!sessionState.signedIn) {
        return {
          supported: true,
          running: false,
          connection,
          needsOAuthLogin: true,
          error: "Sign in with your browser to connect to this remote gateway.",
        };
      }

      await requestRemoteOAuthJson(`${baseUrl}/api/sessions?limit=1`);
      const ticket = await mintRemoteOAuthWsTicket(baseUrl);
      await probeDashboardWebSocket({
        ...connection,
        wsUrl: buildRemoteOAuthWsUrl(baseUrl, ticket),
      });
      return { supported: true, running: true, connection };
    }

    if (!connection) {
      return {
        supported: true,
        running: false,
        error:
          "Remote dashboard transport needs a session token for this gateway.",
      };
    }

    await requestJson(
      `${connection.baseUrl}/api/sessions?limit=1`,
      connection.token,
    );
    await probeDashboardWebSocket(connection);

    return { supported: true, running: true, connection };
  } catch (err) {
    return {
      supported: true,
      running: false,
      connection,
      needsOAuthLogin: errorNeedsOAuthLogin(err),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function getSshDashboardStatusForConfig(
  config: ConnectionConfig,
  profile?: string,
): Promise<DashboardStatus> {
  if (config.sshChatTransport === "legacy") {
    return {
      supported: false,
      running: false,
      error: "SSH dashboard transport is disabled in Settings.",
    };
  }

  if (!config.ssh?.host || !config.ssh.username) {
    return {
      supported: true,
      running: false,
      error: "SSH dashboard transport needs a configured host and username.",
    };
  }

  let connection: DashboardConnection | null = null;
  try {
    connection = await sshDashboardConnectionFromConfig(config, profile);
  } catch (err) {
    return {
      supported: true,
      running: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!connection) {
    return {
      supported: true,
      running: false,
      error:
        "SSH dashboard transport needs an active tunnel and API_SERVER_KEY on the remote Hermes host.",
    };
  }

  try {
    const status = await requestJson(
      `${connection.baseUrl}/api/status`,
      connection.token,
    );
    if (dashboardStatusRequiresOAuth(status)) {
      return {
        supported: true,
        running: false,
        connection,
        error:
          "SSH dashboard requires OAuth browser authentication. Token-based dashboard over SSH is supported now; OAuth ticket flow is not wired in Hermes One yet.",
      };
    }

    await requestJson(
      `${connection.baseUrl}/api/sessions?limit=1`,
      connection.token,
    );
    await probeDashboardWebSocket(connection);

    return { supported: true, running: true, connection };
  } catch (err) {
    return {
      supported: true,
      running: false,
      connection,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getDashboardStatus(
  profile?: string,
): Promise<DashboardStatus> {
  const config = getConnectionConfig();
  const mode =
    config.mode === "remote" || config.mode === "ssh" ? config.mode : "local";
  if (mode === "remote")
    return getRemoteDashboardStatusForConfig(config, profile);
  if (mode === "ssh") return getSshDashboardStatusForConfig(config, profile);

  const managed = getManagedDashboard(profile);
  if (managed) {
    return {
      supported: true,
      running: true,
      connection: { ...managed.connection, alreadyRunning: true },
      logPath: managed.connection.logPath,
    };
  }

  const unsupported = unsupportedReasonForLocalSpawn();
  if (unsupported) {
    return { supported: false, running: false, error: unsupported };
  }

  return {
    supported: true,
    running: false,
    logPath: dashboardLogPath(resolveProfile(profile)),
  };
}

export async function freshDashboardWebSocketUrl(
  profile?: string,
): Promise<string> {
  const config = getConnectionConfig();
  if (config.mode === "remote") {
    const baseUrl = normalizeRemoteDashboardBaseUrl(config.remoteUrl);
    if (!baseUrl) throw new Error("Remote dashboard URL is invalid.");
    const detected = await probeRemoteAuthMode(baseUrl);
    if (detected.authMode === "oauth") {
      const ticket = await mintRemoteOAuthWsTicket(baseUrl);
      return dashboardWebSocketUrlForRenderer(
        buildRemoteOAuthWsUrl(baseUrl, ticket),
      );
    }
    const connection = remoteDashboardConnectionFromConfig(
      { ...config, remoteAuthMode: "token" },
      profile,
    );
    if (!connection) {
      throw new Error("Remote dashboard session token is missing.");
    }
    return dashboardWebSocketUrlForRenderer(connection.wsUrl);
  }

  const status = await getDashboardStatus(profile);
  if (!status.running || !status.connection?.wsUrl) {
    throw new Error(status.error || "Dashboard WebSocket is unavailable.");
  }
  return dashboardWebSocketUrlForRenderer(status.connection.wsUrl);
}

export async function startDashboard(
  profile?: string,
): Promise<DashboardStatus> {
  const config = getConnectionConfig();
  const mode =
    config.mode === "remote" || config.mode === "ssh" ? config.mode : "local";
  if (mode === "remote")
    return getRemoteDashboardStatusForConfig(config, profile);
  if (mode === "ssh") return getSshDashboardStatusForConfig(config, profile);

  const existing = getManagedDashboard(profile);
  if (existing) {
    return {
      supported: true,
      running: true,
      connection: { ...existing.connection, alreadyRunning: true },
      logPath: existing.connection.logPath,
    };
  }

  const unsupported = unsupportedReasonForLocalSpawn();
  if (unsupported) {
    return { supported: false, running: false, error: unsupported };
  }

  const compat = ensureLocalDashboardCompatibility();
  const compatWarning = compat.ok
    ? ""
    : compat.error
      ? `${compat.detail}: ${compat.error}`
      : compat.detail;

  const resolvedProfile = resolveProfile(profile);
  const key = profileKey(profile);
  const token = randomBytes(24).toString("hex");
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logPath = dashboardLogPath(resolvedProfile);
  const stderrFd = openSync(logPath, "a");
  const hasPrebuiltWebDist = dashboardHasPrebuiltWebDist();
  const cliArgs = buildLocalDashboardCliArgs(resolvedProfile, port, {
    skipBuild: hasPrebuiltWebDist,
  });

  let proc: ChildProcess;
  try {
    proc = spawn(HERMES_PYTHON, hermesCliArgs(cliArgs), {
      cwd: HERMES_REPO,
      env: {
        ...process.env,
        PATH: getEnhancedPath(),
        HOME: process.env.HOME || homedir(),
        HERMES_HOME,
        HERMES_DASHBOARD_SESSION_TOKEN: token,
        HERMES_DESKTOP: "1",
        ...(hasPrebuiltWebDist
          ? { HERMES_WEB_DIST: join(HERMES_REPO, "hermes_cli", "web_dist") }
          : {}),
      },
      stdio: ["ignore", "ignore", stderrFd],
      detached: false,
      ...HIDDEN_SUBPROCESS_OPTIONS,
    });
  } catch (err) {
    closeSync(stderrFd);
    return {
      supported: true,
      running: false,
      logPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  closeSync(stderrFd);

  const connection: DashboardConnection = {
    baseUrl,
    wsUrl: dashboardWsUrl(baseUrl, token),
    token,
    authMode: "token",
    mode: "local",
    profile: resolvedProfile,
    pid: proc.pid,
    port,
    logPath,
  };

  dashboards.set(key, { proc, connection });
  proc.once("exit", () => {
    if (dashboards.get(key)?.proc === proc) dashboards.delete(key);
  });

  try {
    await waitForDashboardReady(
      connection,
      hasPrebuiltWebDist ? 45_000 : 180_000,
    );
    await probeDashboardWebSocket(connection, 5_000);
  } catch (err) {
    dashboards.delete(key);
    try {
      proc.kill();
    } catch {
      // Ignore shutdown errors for a failed probe; the log path is returned.
    }
    return {
      supported: true,
      running: false,
      logPath,
      error: [
        err instanceof Error ? err.message : String(err),
        compatWarning ? `compatibility: ${compatWarning}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    };
  }

  return { supported: true, running: true, connection, logPath };
}

export function stopDashboard(profile?: string): boolean {
  const key = profileKey(profile);
  const managed = dashboards.get(key);
  if (!managed) return true;
  dashboards.delete(key);
  try {
    managed.proc.kill();
  } catch {
    return false;
  }
  return true;
}

export function stopAllDashboards(): void {
  for (const key of [...dashboards.keys()]) {
    stopDashboard(key === "default" ? undefined : key);
  }
}
