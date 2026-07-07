import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "child_process";
import type { IncomingMessage, ClientRequest } from "node:http";

import {
  __resetSshTunnelForTests,
  __setSshTunnelRuntimeForTests,
  ensureSshTunnel,
  getSshTunnelUrl,
  isSshTunnelActive,
  startSshTunnel,
  stopSshTunnel,
  testSshConnection,
  type SshConfig,
  type SshTunnelRuntime,
} from "../src/main/ssh-tunnel";

class FakeChildProcess extends EventEmitter {
  killed = false;
  kill = vi.fn((signal?: NodeJS.Signals | number) => {
    this.killed = true;
    this.emit("exit", null, signal ?? "SIGTERM");
    return true;
  });
}

class FakeClientRequest extends EventEmitter {
  destroy = vi.fn();
  end = vi.fn();
}

interface RuntimeHarness {
  children: FakeChildProcess[];
  connectResults: Array<"open" | "closed">;
  healthStatuses: number[];
  runtime: Partial<SshTunnelRuntime>;
}

const config: SshConfig = {
  host: "example.test",
  port: 22,
  username: "alice",
  keyPath: "/tmp/id_ed25519",
  remotePort: 8642,
  localPort: 18642,
};

function createHarness(): RuntimeHarness {
  const children: FakeChildProcess[] = [];
  const connectResults: Array<"open" | "closed"> = ["open"];
  const healthStatuses: number[] = [200];
  let now = 0;

  const runtime: Partial<SshTunnelRuntime> = {
    now: () => now,
    setTimeout: ((callback: (...args: unknown[]) => void) => {
      callback();
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
    clearTimeout: vi.fn() as typeof clearTimeout,
    spawn: vi.fn(() => {
      const child = new FakeChildProcess();
      children.push(child);
      return child as unknown as ChildProcess;
    }) as unknown as SshTunnelRuntime["spawn"],
    createServer: vi.fn(() => {
      const server = {
        listen: vi.fn(
          (
            _port: number,
            _host: string,
            callback?: () => void,
          ): typeof server => {
            callback?.();
            return server;
          },
        ),
        address: vi.fn(() => ({
          address: "127.0.0.1",
          family: "IPv4",
          port: 18642,
        })),
        close: vi.fn((callback?: () => void) => {
          callback?.();
          return server;
        }),
        on: vi.fn(() => server),
      };
      return server;
    }) as unknown as SshTunnelRuntime["createServer"],
    connect: vi.fn(
      (
        _port: number,
        _host: string,
        onConnect?: () => void,
      ): ReturnType<SshTunnelRuntime["connect"]> => {
        const result = connectResults.shift() ?? "open";
        const socket = {
          destroy: vi.fn(),
          on: vi.fn((event: string, callback: (err?: Error) => void) => {
            if (event === "error" && result === "closed") {
              now += 10;
              queueMicrotask(() => callback(new Error("closed")));
            }
            return socket;
          }),
        };
        if (result === "open") {
          queueMicrotask(() => onConnect?.());
        }
        return socket as ReturnType<SshTunnelRuntime["connect"]>;
      },
    ) as unknown as SshTunnelRuntime["connect"],
    request: vi.fn(
      (
        _url: string | URL,
        _options: Parameters<SshTunnelRuntime["request"]>[1],
        callback?: (res: IncomingMessage) => void,
      ): ClientRequest => {
        const req = new FakeClientRequest();
        const status = healthStatuses.shift() ?? 500;
        now += 10;
        queueMicrotask(() => {
          callback?.({
            statusCode: status,
            resume: vi.fn(),
          } as unknown as IncomingMessage);
        });
        return req as unknown as ClientRequest;
      },
    ) as unknown as SshTunnelRuntime["request"],
  };

  return { children, connectResults, healthStatuses, runtime };
}

async function flushAsyncLifecycle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

describe("ssh tunnel lifecycle", () => {
  let harness: RuntimeHarness;

  beforeEach(() => {
    __resetSshTunnelForTests();
    harness = createHarness();
    __setSshTunnelRuntimeForTests(harness.runtime, {
      portReadyTimeoutMs: 5,
      portPollIntervalMs: 1,
      startupHealthTimeoutMs: 5,
      healthPollIntervalMs: 1,
      connectionReadyDelayMs: 1,
      connectionReadyTimeoutMs: 5,
      connectionPollIntervalMs: 1,
      connectionOverallTimeoutMs: 5,
      reconnectInitialBackoffMs: 1,
      reconnectMaxBackoffMs: 1,
      reconnectMaxAttempts: 1,
    });
  });

  it("starts a tunnel and exposes the local gateway URL", async () => {
    await startSshTunnel(config);

    expect(isSshTunnelActive()).toBe(true);
    expect(getSshTunnelUrl()).toBe("http://127.0.0.1:18642");
    expect(harness.runtime.spawn).toHaveBeenCalledWith(
      "ssh",
      expect.arrayContaining([
        "-N",
        "-L",
        "18642:127.0.0.1:8642",
        "alice@example.test",
      ]),
      expect.objectContaining({ stdio: "ignore", detached: false }),
    );
  });

  it("polls health until the tunnel becomes healthy during startup", async () => {
    __setSshTunnelRuntimeForTests({}, { startupHealthTimeoutMs: 50 });
    harness.healthStatuses.splice(0, harness.healthStatuses.length, 500, 200);

    await startSshTunnel(config);

    expect(harness.runtime.request).toHaveBeenCalledTimes(2);
    expect(isSshTunnelActive()).toBe(true);
    expect(getSshTunnelUrl()).toBe("http://127.0.0.1:18642");
  });

  it("tears down the active child when the port never opens", async () => {
    harness.connectResults.splice(0, harness.connectResults.length, "closed");

    await expect(startSshTunnel(config)).rejects.toThrow(
      "SSH tunnel not ready after 5ms",
    );

    expect(harness.children[0].killed).toBe(true);
    expect(isSshTunnelActive()).toBe(false);
    expect(getSshTunnelUrl()).toBeNull();
  });

  it("tears down the active child when the health check never passes", async () => {
    harness.healthStatuses.splice(0, harness.healthStatuses.length, 500);

    await expect(startSshTunnel(config)).rejects.toThrow(
      "SSH tunnel health check failed after 5ms",
    );

    expect(harness.children[0].killed).toBe(true);
    expect(isSshTunnelActive()).toBe(false);
    expect(getSshTunnelUrl()).toBeNull();
  });

  it("stops a running tunnel and clears active state", async () => {
    await startSshTunnel(config);

    stopSshTunnel();

    expect(harness.children[0].killed).toBe(true);
    expect(isSshTunnelActive()).toBe(false);
    expect(getSshTunnelUrl()).toBeNull();
  });

  it("keeps an active tunnel when the child exits but health still passes", async () => {
    await startSshTunnel(config);
    harness.healthStatuses.push(200);

    harness.children[0].emit("exit", 0, null);
    await flushAsyncLifecycle();

    expect(isSshTunnelActive()).toBe(true);
    expect(getSshTunnelUrl()).toBe("http://127.0.0.1:18642");
  });

  it("clears active state when the child exits and health fails", async () => {
    await startSshTunnel(config);
    harness.healthStatuses.push(500);

    harness.children[0].emit("exit", 1, null);
    await flushAsyncLifecycle();

    expect(isSshTunnelActive()).toBe(false);
    expect(getSshTunnelUrl()).toBeNull();
  });

  it("clears active state when the child errors and health fails", async () => {
    await startSshTunnel(config);
    harness.healthStatuses.push(500);

    harness.children[0].emit("error", new Error("ssh failed"));
    await flushAsyncLifecycle();

    expect(isSshTunnelActive()).toBe(false);
    expect(getSshTunnelUrl()).toBeNull();
  });

  it("reconnects with backoff when the child exits and health fails", async () => {
    await startSshTunnel(config);
    harness.healthStatuses.push(500, 200);

    harness.children[0].emit("exit", 1, null);
    await flushAsyncLifecycle();

    expect(harness.children).toHaveLength(2);
    expect(isSshTunnelActive()).toBe(true);
    expect(getSshTunnelUrl()).toBe("http://127.0.0.1:18642");
  });

  it("reuses an active healthy tunnel instead of spawning another one", async () => {
    await startSshTunnel(config);
    harness.healthStatuses.push(200);

    await ensureSshTunnel(config);

    expect(harness.children).toHaveLength(1);
  });

  it("kills the temporary probe process when connection testing fails", async () => {
    harness.connectResults.splice(0, harness.connectResults.length, "closed");

    await expect(testSshConnection(config)).resolves.toBe(false);

    expect(harness.children[0].killed).toBe(true);
  });
});
