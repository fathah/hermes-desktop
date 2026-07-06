import { ChildProcess, spawn } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { existsSync } from "fs";
import net from "net";
import http from "http";
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

let tunnelProcess: ChildProcess | null = null;
let activeConfig: SshConfig | null = null;
let activeTargetKey: string | null = null;
let tunnelRunning = false;
let tunnelStartPromise: Promise<void> | null = null;
let tunnelStartTargetKey: string | null = null;
let tunnelGeneration = 0;

export function getSshTunnelUrl(): string | null {
  if (!activeConfig || !tunnelRunning) return null;
  return `http://127.0.0.1:${activeConfig.localPort}`;
}

export function isSshTunnelActive(): boolean {
  return tunnelRunning && activeConfig !== null;
}

function checkHttpPath(
  port: number,
  path: "/health" | "/api/status",
  timeoutMs = 3000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      `http://127.0.0.1:${port}${path}`,
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

async function checkTunnelHealth(
  port: number,
  timeoutMs = 3000,
): Promise<boolean> {
  if (await checkHttpPath(port, "/health", timeoutMs)) return true;
  return checkHttpPath(port, "/api/status", timeoutMs);
}

async function waitForHealth(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (await checkTunnelHealth(port, 1500)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
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
    const server = net.createServer();
    server.listen(preferred, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      const fallback = net.createServer();
      fallback.listen(0, "127.0.0.1", () => {
        const port = (fallback.address() as net.AddressInfo).port;
        fallback.close(() => resolve(port));
      });
    });
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

function tunnelTargetKey(config: SshConfig): string {
  return [
    config.host,
    config.port || 22,
    config.username,
    config.keyPath || join(homedir(), ".ssh", "id_rsa"),
    config.remotePort,
  ].join("\n");
}

async function startSshTunnelInner(config: SshConfig): Promise<void> {
  stopSshTunnel();
  const generation = ++tunnelGeneration;

  const keyPath = config.keyPath?.trim() || join(homedir(), ".ssh", "id_rsa");
  if (!existsSync(keyPath)) {
    throw new Error(`SSH private key file not found at: ${keyPath}`);
  }

  const localPort = await findFreePort(config.localPort || 18642);
  activeConfig = { ...config, localPort };
  activeTargetKey = tunnelTargetKey(config);
  tunnelRunning = false;

  let spawnError: Error | null = null;

  const spawnedProcess = spawn("ssh", buildSshArgs(config, localPort), {
    stdio: "ignore",
    detached: false,
    ...HIDDEN_SUBPROCESS_OPTIONS,
  });
  tunnelProcess = spawnedProcess;

  spawnedProcess.on("exit", () => {
    if (tunnelProcess === spawnedProcess) tunnelProcess = null;
    // With ControlMaster=auto, the spawned SSH process exits immediately
    // after handing off to the master. The tunnel may still be alive via
    // the mux master, so check health before declaring it dead. An older
    // process may exit after a profile/port retarget; never let that stale
    // callback clear the newer tunnel's global state.
    checkTunnelHealth(localPort, 2000).then((healthy) => {
      if (!healthy && generation === tunnelGeneration) {
        tunnelRunning = false;
        activeConfig = null;
        activeTargetKey = null;
      }
    });
  });

  spawnedProcess.on("error", (err) => {
    if (generation !== tunnelGeneration) return;
    if (tunnelProcess === spawnedProcess) tunnelProcess = null;
    if (err && "code" in err && err.code === "ENOENT") {
      spawnError = new Error(
        "System SSH binary not found on your system PATH. Please ensure an SSH client is installed.",
      );
    } else {
      spawnError = err;
    }
    tunnelRunning = false;
    activeConfig = null;
    activeTargetKey = null;
  });

  try {
    // Poll for both port readiness and checking if spawnError was set
    const deadline = Date.now() + 12000;
    while (Date.now() <= deadline) {
      if (spawnError) throw spawnError;

      const portOpen = await new Promise<boolean>((resolve) => {
        const socket = net.connect(localPort, "127.0.0.1", () => {
          socket.destroy();
          resolve(true);
        });
        socket.on("error", () => {
          socket.destroy();
          resolve(false);
        });
      });

      if (portOpen) break;

      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    if (spawnError) throw spawnError;

    if (generation !== tunnelGeneration) {
      throw new Error("SSH tunnel start was superseded by another target.");
    }
    tunnelRunning = true;
    await waitForHealth(localPort, 20000);
  } catch (err) {
    if (generation === tunnelGeneration) stopSshTunnel();
    throw err;
  }
}

export async function startSshTunnel(config: SshConfig): Promise<void> {
  const requestedTargetKey = tunnelTargetKey(config);
  if (tunnelStartPromise) {
    const pendingPromise = tunnelStartPromise;
    const pendingTargetKey = tunnelStartTargetKey;
    try {
      await pendingPromise;
    } catch (err) {
      if (pendingTargetKey === requestedTargetKey) throw err;
    }
    if (isSshTunnelActive() && activeTargetKey === requestedTargetKey) {
      return;
    }
    return startSshTunnel(config);
  }

  const startPromise = startSshTunnelInner(config);
  tunnelStartPromise = startPromise;
  tunnelStartTargetKey = requestedTargetKey;
  try {
    await startPromise;
  } finally {
    if (tunnelStartPromise === startPromise) {
      tunnelStartPromise = null;
      tunnelStartTargetKey = null;
    }
  }
}

export function stopSshTunnel(): void {
  tunnelGeneration++;
  if (tunnelProcess && !tunnelProcess.killed) {
    tunnelProcess.kill("SIGTERM");
  }
  tunnelRunning = false;
  activeConfig = null;
  activeTargetKey = null;
}

export async function ensureSshTunnel(config: SshConfig): Promise<void> {
  if (
    isSshTunnelActive() &&
    activeTargetKey === tunnelTargetKey(config) &&
    (await isSshTunnelHealthy())
  ) {
    return;
  }
  await startSshTunnel(config);
}

// Test SSH reachability + hermes health endpoint through a temporary tunnel
export function testSshConnection(config: SshConfig): Promise<boolean> {
  return findFreePort(config.localPort || 19642)
    .then(
      (localPort) =>
        new Promise<boolean>((resolve) => {
          const args = buildSshArgs(config, localPort);
          const proc = spawn("ssh", args, {
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

          const timeout = setTimeout(() => finish(false), 20000);

          // Poll until the tunnel port is reachable, then accept either the
          // legacy API health endpoint or the dashboard status endpoint used by
          // dashboard-over-SSH.
          const deadline = Date.now() + 15000;
          async function poll(): Promise<void> {
            if (done) return;
            const portOpen = await new Promise<boolean>((res) => {
              const s = net.connect(localPort, "127.0.0.1", () => {
                s.destroy();
                res(true);
              });
              s.on("error", () => {
                s.destroy();
                res(false);
              });
            });

            if (!portOpen) {
              if (Date.now() > deadline) {
                clearTimeout(timeout);
                finish(false);
                return;
              }
              setTimeout(poll, 400);
              return;
            }

            const healthy = await checkTunnelHealth(localPort, 3000);
            clearTimeout(timeout);
            finish(healthy);
          }

          setTimeout(() => {
            poll().catch(() => {
              clearTimeout(timeout);
              finish(false);
            });
          }, 600);
        }),
    )
    .catch(() => false);
}
