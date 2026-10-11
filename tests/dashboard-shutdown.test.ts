// @vitest-environment node
import { type ChildProcess } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  active: "default",
  home: "",
  children: [] as ChildProcess[],
  ignoresTerm: false,
  responseDelay: 0,
}));
vi.mock("../src/main/config", () => ({
  getConnectionConfig: () => ({ mode: "local" }),
  getActiveConnection: () => ({ connectionId: "local" }),
}));
vi.mock("../src/main/installer", () => ({
  get HERMES_HOME() {
    return state.home;
  },
  get HERMES_REPO() {
    return state.home;
  },
  HERMES_PYTHON: process.execPath,
  getEnhancedPath: () => process.env.PATH,
  hermesCliArgs: (args: string[]) => args,
}));
vi.mock("../src/main/utils", async (original) => ({
  ...(await original<typeof import("../src/main/utils")>()),
  getActiveProfileNameSync: () => state.active,
}));
vi.mock("../src/main/hermes-agent-compat", () => ({
  ensureLocalDashboardCompatibility: () => ({ ok: true }),
}));
vi.mock("../src/main/ssh-tunnel", () => ({}));
vi.mock("../src/main/ssh-remote", () => ({}));
vi.mock("../src/main/remote-oauth", () => ({}));
vi.mock("child_process", async (original) => {
  const actual = await original<typeof import("child_process")>();
  return {
    ...actual,
    spawn: (_command: string, args: string[]) => {
      const port = Number(args[args.indexOf("--port") + 1]);
      const child = actual.spawn(
        process.execPath,
        [
          "-e",
          `
      const http = require('http');
      if (${state.ignoresTerm}) process.on('SIGTERM', () => {});
      const server = http.createServer((req, res) => setTimeout(() => res.end('{}'), ${state.responseDelay}));
      server.on('upgrade', (req, socket) => {
        socket.on('error', () => {});
        socket.write('HTTP/1.1 101 Switching Protocols\\r\\nConnection: Upgrade\\r\\nUpgrade: websocket\\r\\n\\r\\n');
      });
      server.listen(${port}, '127.0.0.1');
    `,
        ],
        { stdio: "ignore" },
      );
      state.children.push(child);
      return child;
    },
  };
});
import {
  beginDashboardShutdown,
  startDashboard,
  stopAllDashboards,
  stopDashboard,
} from "../src/main/dashboard";

beforeEach(() => {
  state.home = mkdtempSync(join(tmpdir(), "hermes-shutdown-"));
  state.active = "default";
  state.ignoresTerm = false;
  state.responseDelay = 0;
});
afterEach(async () => {
  state.active = "default";
  await stopAllDashboards();
  await Promise.all(
    state.children.splice(0).map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null)
            return resolve();
          child.once("exit", () => resolve());
          child.kill();
        }),
    ),
  );
  rmSync(state.home, { recursive: true, force: true });
});

async function start(profile?: string): Promise<ChildProcess> {
  expect(await startDashboard(profile)).toMatchObject({ running: true });
  return state.children.at(-1)!;
}

// @lat: [[dashboard-shutdown#Same-profile launch ownership]]
it("shares a pending same-profile launch so both callers own one child", async () => {
  const [first, second] = await Promise.all([
    startDashboard("shared"),
    startDashboard("shared"),
  ]);
  expect(first.running).toBe(true);
  expect(second.running).toBe(true);
  expect(first.connection?.pid).toBe(second.connection?.pid);
  expect(state.children).toHaveLength(1);
});

// @lat: [[dashboard-shutdown#All managed profiles]]
it("stops default and named dashboard processes after changing the active profile", async () => {
  const primary = await start();
  state.active = "work";
  const work = await start();
  const other = await start("other");
  await stopAllDashboards();
  await vi.waitFor(
    () => {
      for (const child of [primary, work, other]) {
        expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      }
    },
    { timeout: 2000 },
  );
});

// @lat: [[dashboard-shutdown#Explicit and implicit targets]]
it("keeps single-profile stop semantics and makes repeated shutdown harmless", async () => {
  const primary = await start("default");
  state.active = "work";
  const work = await start();
  expect(await stopDashboard()).toBe(true);
  await vi.waitFor(() =>
    expect(work.exitCode !== null || work.signalCode !== null).toBe(true),
  );
  expect(primary.killed).toBe(false);
  expect(await stopDashboard("default")).toBe(true);
  await vi.waitFor(() =>
    expect(primary.exitCode !== null || primary.signalCode !== null).toBe(true),
  );
  await expect(stopAllDashboards()).resolves.toBeUndefined();
  await expect(stopAllDashboards()).resolves.toBeUndefined();
});

// @lat: [[dashboard-shutdown#Confirmed forced termination]]
it.skipIf(process.platform === "win32")(
  "awaits SIGKILL for a real dashboard that ignores SIGTERM, including an already admitted stop",
  async () => {
    state.ignoresTerm = true;
    const child = await start("stubborn");
    const stopped = stopDashboard("stubborn");
    let repeatedComplete = false;
    const repeated = stopDashboard("stubborn").then((success) => {
      repeatedComplete = true;
      return success;
    });
    let shutdownComplete = false;
    const shutdown = stopAllDashboards().then(() => {
      shutdownComplete = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(shutdownComplete).toBe(false);
    expect(repeatedComplete).toBe(false);
    expect(child.killed).toBe(true);
    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBeNull();
    expect(await stopped).toBe(true);
    expect(await repeated).toBe(true);
    await shutdown;
    expect(child.signalCode).toBe("SIGKILL");
  },
  5000,
);

// @lat: [[dashboard-shutdown#Quit launch admission]]
it("blocks new and pre-port launches during quit and drains a started child's readiness", async () => {
  state.ignoresTerm = true;
  const running = await start("running");
  state.responseDelay = 2000;
  const entering = startDashboard("entering");
  await vi.waitFor(() => expect(state.children).toHaveLength(2));
  const beforePort = startDashboard("before-port");
  beginDashboardShutdown();
  const shutdown = stopAllDashboards();
  await expect(startDashboard("during-quit")).resolves.toMatchObject({
    running: false,
    error: expect.stringContaining("shutting down"),
  });
  await expect(beforePort).resolves.toMatchObject({ running: false });
  await expect(entering).resolves.toMatchObject({ running: false });
  await shutdown;
  expect(state.children).toHaveLength(2);
  for (const child of state.children)
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  expect(running.exitCode !== null || running.signalCode !== null).toBe(true);
}, 8000);
