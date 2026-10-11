// @vitest-environment node
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";
import { beforeEach, expect, it, vi } from "vitest";
import type { SshConfig } from "../src/main/ssh-tunnel";

const state = vi.hoisted(() => ({
  ports: [] as (() => void)[],
  health: [] as (() => void)[],
  holdHealth: false,
  spawn: vi.fn(),
}));

vi.mock("fs", async (original) => ({
  ...(await original<typeof import("fs")>()),
  existsSync: () => true,
}));
vi.mock("child_process", async (original) => ({
  ...(await original<typeof import("child_process")>()),
  spawn: state.spawn,
}));
vi.mock("net", async (original) => {
  const actual = await original<typeof import("net")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      createServer: () => ({
        on() {
          return this;
        },
        listen(_port: number, _host: string, ready: () => void) {
          state.ports.push(ready);
        },
        address: () => ({ port: 1234 }),
        close: (closed: () => void) => closed(),
      }),
      connect(_port: number, _host: string, ready: () => void) {
        queueMicrotask(ready);
        return Object.assign(new EventEmitter(), { destroy: vi.fn() });
      },
    },
  };
});
vi.mock("http", async (original) => {
  const actual = await original<typeof import("http")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      request(
        _url: string,
        _options: unknown,
        reply: (response: { statusCode: number; resume: () => void }) => void,
      ) {
        const respond = (): void => reply({ statusCode: 200, resume: vi.fn() });
        return Object.assign(new EventEmitter(), {
          end() {
            if (state.holdHealth) state.health.push(respond);
            else queueMicrotask(respond);
          },
          destroy: vi.fn(),
        });
      },
    },
  };
});

const config: SshConfig = {
  host: "synthetic-host",
  username: "synthetic-user",
  port: 22,
  keyPath: "/synthetic/key",
  localPort: 1234,
  remotePort: 5678,
};

beforeEach(() => {
  vi.resetModules();
  state.ports = [];
  state.health = [];
  state.holdHealth = false;
  state.spawn.mockReset();
  state.spawn.mockImplementation(
    () =>
      Object.assign(new EventEmitter(), {
        pid: 999,
        killed: false,
        kill: vi.fn(),
      }) as ChildProcess,
  );
});

// @lat: [[dashboard-shutdown#Ordinary tunnel stop and restart]]
it("invalidates a pending port selection without spawning and still permits a later restart", async () => {
  const tunnel = await import("../src/main/ssh-tunnel");
  const entering = tunnel.startSshTunnel(config);
  const stopped = expect(entering).rejects.toThrow("superseded");
  tunnel.stopSshTunnel();
  state.ports.shift()!();
  await stopped;
  expect(state.spawn).not.toHaveBeenCalled();

  const restarted = tunnel.startSshTunnel(config);
  state.ports.shift()!();
  await restarted;
  expect(state.spawn).toHaveBeenCalledTimes(1);
  expect(tunnel.isSshTunnelActive()).toBe(true);
  tunnel.stopSshTunnel();
  expect(state.spawn.mock.results[0].value.kill).toHaveBeenCalledWith(
    "SIGTERM",
  );
});

// @lat: [[dashboard-shutdown#Queued tunnel quit admission]]
it("rejects pending, queued and new tunnel starts after quit without creating a child", async () => {
  const tunnel = await import("../src/main/ssh-tunnel");
  const entering = tunnel.startSshTunnel(config);
  const queued = tunnel.ensureSshTunnel({ ...config, remotePort: 6789 });
  const enteredFailure = expect(entering).rejects.toThrow("shutting down");
  const queuedFailure = expect(queued).rejects.toThrow("shutting down");
  tunnel.beginSshTunnelShutdown();
  state.ports.shift()!();
  await Promise.all([enteredFailure, queuedFailure]);
  await expect(tunnel.startSshTunnel(config)).rejects.toThrow("shutting down");
  await expect(tunnel.ensureSshTunnel(config)).rejects.toThrow("shutting down");
  expect(state.spawn).not.toHaveBeenCalled();
  expect(state.ports).toHaveLength(0);
});

// @lat: [[dashboard-shutdown#Tunnel health continuation on quit]]
it("does not admit a late healthy result after quit stops the owned tunnel", async () => {
  const tunnel = await import("../src/main/ssh-tunnel");
  const started = tunnel.startSshTunnel(config);
  state.ports.shift()!();
  await started;
  state.holdHealth = true;
  const entering = tunnel.ensureSshTunnel(config);
  const rejected = expect(entering).rejects.toThrow("shutting down");
  expect(state.health).toHaveLength(1);
  tunnel.beginSshTunnelShutdown();
  state.health.shift()!();
  await rejected;
  expect(state.spawn).toHaveBeenCalledTimes(1);
  expect(state.spawn.mock.results[0].value.kill).toHaveBeenCalledWith(
    "SIGTERM",
  );
  expect(tunnel.isSshTunnelActive()).toBe(false);
});
