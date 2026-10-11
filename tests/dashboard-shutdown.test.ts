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
      const server = http.createServer((req, res) => res.end('{}'));
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
  startDashboard,
  stopAllDashboards,
  stopDashboard,
} from "../src/main/dashboard";

beforeEach(() => {
  state.home = mkdtempSync(join(tmpdir(), "hermes-shutdown-"));
  state.active = "default";
});
afterEach(async () => {
  state.active = "default";
  stopAllDashboards();
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

// @lat: [[dashboard-shutdown#All managed profiles]]
it("stops default and named dashboard processes after changing the active profile", async () => {
  const primary = await start();
  state.active = "work";
  const work = await start();
  const other = await start("other");
  stopAllDashboards();
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
  expect(stopDashboard()).toBe(true);
  await vi.waitFor(() =>
    expect(work.exitCode !== null || work.signalCode !== null).toBe(true),
  );
  expect(primary.killed).toBe(false);
  expect(stopDashboard("default")).toBe(true);
  await vi.waitFor(() =>
    expect(primary.exitCode !== null || primary.signalCode !== null).toBe(true),
  );
  expect(() => {
    stopAllDashboards();
    stopAllDashboards();
  }).not.toThrow();
});
