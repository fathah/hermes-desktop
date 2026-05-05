import { ChildProcess, spawn } from "child_process";
import { homedir } from "os";
import { join } from "path";
import net from "net";
import http from "http";

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

export function getSshTunnelUrl(): string {
  return `http://127.0.0.1:${activeConfig?.localPort ?? 18642}`;
}

export function isSshTunnelActive(): boolean {
  return tunnelProcess !== null && !tunnelProcess.killed;
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

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function attempt(): void {
      const socket = net.connect(port, "127.0.0.1", () => {
        socket.destroy();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`SSH tunnel not ready after ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 400);
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
    "-L", `${localPort}:127.0.0.1:${config.remotePort}`,
    "-p", String(config.port),
    "-i", keyPath,
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "BatchMode=yes",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    `${config.username}@${config.host}`,
  ];
}

export async function startSshTunnel(config: SshConfig): Promise<void> {
  stopSshTunnel();

  const localPort = await findFreePort(config.localPort || 18642);
  activeConfig = { ...config, localPort };

  tunnelProcess = spawn("ssh", buildSshArgs(config, localPort), {
    stdio: "ignore",
    detached: false,
  });

  tunnelProcess.on("exit", () => {
    tunnelProcess = null;
  });

  tunnelProcess.on("error", () => {
    tunnelProcess = null;
  });

  await waitForPort(localPort, 12000);
}

export function stopSshTunnel(): void {
  if (tunnelProcess && !tunnelProcess.killed) {
    tunnelProcess.kill("SIGTERM");
  }
  tunnelProcess = null;
  activeConfig = null;
}

export async function ensureSshTunnel(config: SshConfig): Promise<void> {
  if (isSshTunnelActive()) return;
  await startSshTunnel(config);
}

// Test SSH reachability + hermes health endpoint through a temporary tunnel
export function testSshConnection(config: SshConfig): Promise<boolean> {
  return new Promise(async (resolve) => {
    let localPort: number;
    try {
      localPort = await findFreePort(config.localPort || 19642);
    } catch {
      resolve(false);
      return;
    }

    const args = buildSshArgs(config, localPort);
    const proc = spawn("ssh", args, { stdio: "ignore" });

    let done = false;
    const finish = (result: boolean): void => {
      if (done) return;
      done = true;
      proc.kill("SIGTERM");
      resolve(result);
    };

    proc.on("error", () => finish(false));

    const timeout = setTimeout(() => finish(false), 20000);

    // Poll until tunnel port is reachable, then hit /health
    const deadline = Date.now() + 15000;
    async function poll(): Promise<void> {
      if (done) return;
      const portOpen = await new Promise<boolean>((res) => {
        const s = net.connect(localPort, "127.0.0.1", () => { s.destroy(); res(true); });
        s.on("error", () => { s.destroy(); res(false); });
      });

      if (!portOpen) {
        if (Date.now() > deadline) { clearTimeout(timeout); finish(false); return; }
        setTimeout(poll, 400);
        return;
      }

      // Port is open — hit hermes /health
      const req = http.request(
        `http://127.0.0.1:${localPort}/health`,
        { method: "GET", timeout: 3000 },
        (res) => {
          clearTimeout(timeout);
          finish(res.statusCode === 200);
          res.resume();
        },
      );
      req.on("error", () => { clearTimeout(timeout); finish(false); });
      req.end();
    }

    setTimeout(poll, 600);
  });
}
