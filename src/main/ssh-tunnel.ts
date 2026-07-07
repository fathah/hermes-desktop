import { ChildProcess, spawn } from "child_process";
import { homedir } from "os";
import { join } from "path";
import net from "net";
import http from "node:http";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { buildSshControlOptions } from "./ssh-options";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";

export interface SshConfig {
  host: string;
  port: number;
  username: string;
  keyPath: string;
  remotePort: number;
  localPort: number;
}

export interface SshTunnelRuntime {
  spawn: typeof spawn;
  createServer: typeof net.createServer;
  connect: (
    port: number,
    host: string,
    connectionListener?: () => void,
  ) => net.Socket;
  request: (
    url: string | URL,
    options: RequestOptions,
    callback?: (res: IncomingMessage) => void,
  ) => ClientRequest;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  now: () => number;
}

export interface SshTunnelTiming {
  healthRequestTimeoutMs: number;
  healthPollRequestTimeoutMs: number;
  exitHealthTimeoutMs: number;
  healthPollIntervalMs: number;
  portReadyTimeoutMs: number;
  portPollIntervalMs: number;
  startupHealthTimeoutMs: number;
  connectionReadyDelayMs: number;
  connectionReadyTimeoutMs: number;
  connectionPollIntervalMs: number;
  connectionOverallTimeoutMs: number;
  connectionHealthRequestTimeoutMs: number;
  reconnectInitialBackoffMs: number;
  reconnectMaxBackoffMs: number;
  reconnectMaxAttempts: number;
}

const DEFAULT_SSH_TUNNEL_TIMING: SshTunnelTiming = {
  healthRequestTimeoutMs: 3000,
  healthPollRequestTimeoutMs: 1500,
  exitHealthTimeoutMs: 2000,
  healthPollIntervalMs: 500,
  portReadyTimeoutMs: 12000,
  portPollIntervalMs: 400,
  startupHealthTimeoutMs: 20000,
  connectionReadyDelayMs: 600,
  connectionReadyTimeoutMs: 15000,
  connectionPollIntervalMs: 400,
  connectionOverallTimeoutMs: 20000,
  connectionHealthRequestTimeoutMs: 3000,
  reconnectInitialBackoffMs: 1000,
  reconnectMaxBackoffMs: 30000,
  reconnectMaxAttempts: 5,
};

function defaultSshTunnelRuntime(): SshTunnelRuntime {
  return {
    spawn,
    createServer: net.createServer.bind(net) as typeof net.createServer,
    connect: net.connect.bind(net) as SshTunnelRuntime["connect"],
    request: http.request.bind(http) as SshTunnelRuntime["request"],
    setTimeout: globalThis.setTimeout.bind(globalThis) as typeof setTimeout,
    clearTimeout: globalThis.clearTimeout.bind(
      globalThis,
    ) as typeof clearTimeout,
    now: () => Date.now(),
  };
}

let sshTunnelRuntime = defaultSshTunnelRuntime();
let sshTunnelTiming: SshTunnelTiming = { ...DEFAULT_SSH_TUNNEL_TIMING };

let tunnelProcess: ChildProcess | null = null;
let activeConfig: SshConfig | null = null;
let desiredConfig: SshConfig | null = null;
let tunnelRunning = false;
let tunnelGeneration = 0;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function __setSshTunnelRuntimeForTests(
  runtime: Partial<SshTunnelRuntime>,
  timing: Partial<SshTunnelTiming> = {},
): void {
  sshTunnelRuntime = { ...sshTunnelRuntime, ...runtime };
  sshTunnelTiming = { ...sshTunnelTiming, ...timing };
}

export function __resetSshTunnelForTests(): void {
  stopSshTunnel();
  sshTunnelRuntime = defaultSshTunnelRuntime();
  sshTunnelTiming = { ...DEFAULT_SSH_TUNNEL_TIMING };
}

export function getSshTunnelUrl(): string | null {
  if (!activeConfig || !tunnelRunning) return null;
  return `http://127.0.0.1:${activeConfig.localPort}`;
}

export function isSshTunnelActive(): boolean {
  return tunnelRunning && activeConfig !== null;
}

function checkTunnelHealth(
  port: number,
  timeoutMs = sshTunnelTiming.healthRequestTimeoutMs,
): Promise<boolean> {
  return new Promise((resolve) => {
    const req = sshTunnelRuntime.request(
      `http://127.0.0.1:${port}/health`,
      { method: "GET", timeout: timeoutMs },
      (res) => {
        const healthy = res.statusCode === 200;
        res.resume();
        resolve(healthy);
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

async function waitForHealth(port: number, timeoutMs: number): Promise<void> {
  const deadline = sshTunnelRuntime.now() + timeoutMs;
  while (sshTunnelRuntime.now() <= deadline) {
    if (
      await checkTunnelHealth(port, sshTunnelTiming.healthPollRequestTimeoutMs)
    )
      return;
    await new Promise((resolve) =>
      sshTunnelRuntime.setTimeout(
        resolve,
        sshTunnelTiming.healthPollIntervalMs,
      ),
    );
  }
  throw new Error(`SSH tunnel health check failed after ${timeoutMs}ms`);
}

export async function isSshTunnelHealthy(): Promise<boolean> {
  return activeConfig !== null && tunnelRunning
    ? checkTunnelHealth(activeConfig.localPort)
    : false;
}

function findFreePort(preferred: number): Promise<number> {
  return new Promise((resolve) => {
    const server = sshTunnelRuntime.createServer();
    server.listen(preferred, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      const fallback = sshTunnelRuntime.createServer();
      fallback.listen(0, "127.0.0.1", () => {
        const port = (fallback.address() as net.AddressInfo).port;
        fallback.close(() => resolve(port));
      });
    });
  });
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = sshTunnelRuntime.now() + timeoutMs;
    function attempt(): void {
      const socket = sshTunnelRuntime.connect(port, "127.0.0.1", () => {
        socket.destroy();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (sshTunnelRuntime.now() > deadline) {
          reject(new Error(`SSH tunnel not ready after ${timeoutMs}ms`));
        } else {
          sshTunnelRuntime.setTimeout(
            attempt,
            sshTunnelTiming.portPollIntervalMs,
          );
        }
      });
    }
    attempt();
  });
}

function buildSshArgs(config: SshConfig, localPort: number): string[] {
  const keyPath = config.keyPath || join(homedir(), ".ssh", "id_rsa");
  return [
    "-N",
    "-L",
    `${localPort}:127.0.0.1:${config.remotePort}`,
    "-p",
    String(config.port),
    "-i",
    keyPath,
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "BatchMode=yes",
    ...buildSshControlOptions(process.platform, { forTunnel: true }),
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
    `${config.username}@${config.host}`,
  ];
}

function clearReconnectTimer(): void {
  if (reconnectTimer) {
    sshTunnelRuntime.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function stopActiveTunnelProcess(): void {
  const proc = tunnelProcess;
  tunnelProcess = null;
  tunnelRunning = false;
  activeConfig = null;
  tunnelGeneration += 1;

  if (proc && !proc.killed) {
    proc.kill("SIGTERM");
  }
}

function reconnectBackoffMs(attempt: number): number {
  const raw =
    sshTunnelTiming.reconnectInitialBackoffMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(raw, sshTunnelTiming.reconnectMaxBackoffMs);
}

function scheduleReconnect(): void {
  if (!desiredConfig || reconnectTimer) return;
  if (reconnectAttempts >= sshTunnelTiming.reconnectMaxAttempts) return;

  reconnectAttempts += 1;
  const config = desiredConfig;
  const backoffMs = reconnectBackoffMs(reconnectAttempts);
  reconnectTimer = sshTunnelRuntime.setTimeout(() => {
    reconnectTimer = null;
    if (!desiredConfig) return;
    void launchSshTunnel(config, false).catch(() => {
      if (desiredConfig) scheduleReconnect();
    });
  }, backoffMs);
}

async function handleTunnelProcessEnded(
  proc: ChildProcess,
  localPort: number,
  generation: number,
): Promise<void> {
  if (tunnelProcess === proc) tunnelProcess = null;

  // With ControlMaster=auto, the spawned SSH process may exit immediately
  // after handing off to the master. The tunnel may still be alive via
  // the mux master, so check health before declaring it dead.
  const healthy = await checkTunnelHealth(
    localPort,
    sshTunnelTiming.exitHealthTimeoutMs,
  );
  if (generation !== tunnelGeneration) return;
  if (healthy) return;

  tunnelRunning = false;
  activeConfig = null;
  scheduleReconnect();
}

async function launchSshTunnel(
  config: SshConfig,
  clearDesiredOnFailure: boolean,
): Promise<void> {
  stopActiveTunnelProcess();

  const localPort = await findFreePort(config.localPort || 18642);
  const generation = ++tunnelGeneration;
  activeConfig = { ...config, localPort };
  tunnelRunning = false;

  const proc = sshTunnelRuntime.spawn("ssh", buildSshArgs(config, localPort), {
    stdio: "ignore",
    detached: false,
    ...HIDDEN_SUBPROCESS_OPTIONS,
  });
  tunnelProcess = proc;

  proc.on("exit", () => {
    void handleTunnelProcessEnded(proc, localPort, generation);
  });

  proc.on("error", () => {
    void handleTunnelProcessEnded(proc, localPort, generation);
  });

  try {
    await waitForPort(localPort, sshTunnelTiming.portReadyTimeoutMs);
    await waitForHealth(localPort, sshTunnelTiming.startupHealthTimeoutMs);
    tunnelRunning = true;
    reconnectAttempts = 0;
  } catch (err) {
    if (tunnelGeneration === generation) {
      tunnelGeneration += 1;
      tunnelRunning = false;
      activeConfig = null;
      if (tunnelProcess === proc) tunnelProcess = null;
    }
    if (!proc.killed) proc.kill("SIGTERM");
    if (clearDesiredOnFailure) {
      desiredConfig = null;
      clearReconnectTimer();
      reconnectAttempts = 0;
    }
    throw err;
  }
}

export async function startSshTunnel(config: SshConfig): Promise<void> {
  desiredConfig = { ...config };
  reconnectAttempts = 0;
  clearReconnectTimer();
  await launchSshTunnel(config, true);
}

export function stopSshTunnel(): void {
  desiredConfig = null;
  reconnectAttempts = 0;
  clearReconnectTimer();
  stopActiveTunnelProcess();
}

export async function ensureSshTunnel(config: SshConfig): Promise<void> {
  if (isSshTunnelActive() && (await isSshTunnelHealthy())) return;
  await startSshTunnel(config);
}

// Test SSH reachability + hermes health endpoint through a temporary tunnel
export function testSshConnection(config: SshConfig): Promise<boolean> {
  return findFreePort(config.localPort || 19642)
    .then(
      (localPort) =>
        new Promise<boolean>((resolve) => {
          const args = buildSshArgs(config, localPort);
          const proc = sshTunnelRuntime.spawn("ssh", args, {
            stdio: "ignore",
            ...HIDDEN_SUBPROCESS_OPTIONS,
          });

          let done = false;
          const finish = (result: boolean): void => {
            if (done) return;
            done = true;
            proc.kill("SIGTERM");
            resolve(result);
          };

          proc.on("error", () => finish(false));

          const timeout = sshTunnelRuntime.setTimeout(
            () => finish(false),
            sshTunnelTiming.connectionOverallTimeoutMs,
          );

          // Poll until tunnel port is reachable, then hit /health
          const deadline =
            sshTunnelRuntime.now() + sshTunnelTiming.connectionReadyTimeoutMs;
          async function poll(): Promise<void> {
            if (done) return;
            const portOpen = await new Promise<boolean>((res) => {
              const s = sshTunnelRuntime.connect(localPort, "127.0.0.1", () => {
                s.destroy();
                res(true);
              });
              s.on("error", () => {
                s.destroy();
                res(false);
              });
            });

            if (!portOpen) {
              if (sshTunnelRuntime.now() > deadline) {
                sshTunnelRuntime.clearTimeout(timeout);
                finish(false);
                return;
              }
              sshTunnelRuntime.setTimeout(
                poll,
                sshTunnelTiming.connectionPollIntervalMs,
              );
              return;
            }

            // Port is open — hit hermes /health
            const req = sshTunnelRuntime.request(
              `http://127.0.0.1:${localPort}/health`,
              {
                method: "GET",
                timeout: sshTunnelTiming.connectionHealthRequestTimeoutMs,
              },
              (res) => {
                sshTunnelRuntime.clearTimeout(timeout);
                finish(res.statusCode === 200);
                res.resume();
              },
            );
            req.on("error", () => {
              sshTunnelRuntime.clearTimeout(timeout);
              finish(false);
            });
            req.end();
          }

          sshTunnelRuntime.setTimeout(
            poll,
            sshTunnelTiming.connectionReadyDelayMs,
          );
        }),
    )
    .catch(() => false);
}
