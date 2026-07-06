import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
const {
  TEST_HOME,
  TEST_REPO,
  connModeRef,
  healthStatuses,
  aliveGatewayPids,
  restartScript,
  hermesCliArgsSpy,
} = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");

  const script =
    "const fs=require('fs'),path=require('path');" +
    "fs.writeFileSync(path.join(process.env.HERMES_HOME,'restart-env.json')," +
    "JSON.stringify({api:process.env.API_SERVER_ENABLED,key:process.env.TEST_PROFILE_KEY}))";

  return {
    TEST_HOME: path.join(os.tmpdir(), `hermes-gateway-restart-${Date.now()}`),
    TEST_REPO: path.join(os.tmpdir(), `hermes-gateway-repo-${Date.now()}`),
    connModeRef: { mode: "local" as "local" | "remote" | "ssh" },
    healthStatuses: [] as number[],
    aliveGatewayPids: new Set<number>(),
    restartScript: script,
    hermesCliArgsSpy: vi.fn(),
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
  HERMES_PYTHON: process.execPath,
  HERMES_REPO: TEST_REPO,
  hermesCliArgs: hermesCliArgsSpy,
  getEnhancedPath: () => process.env.PATH || "",
}));

vi.mock("../src/main/config", () => ({
  getModelConfig: () => ({ model: "test-model", provider: "openrouter" }),
  getApiServerKey: () => "",
  readEnv: (profile?: string) => ({ TEST_PROFILE_KEY: profile || "default" }),
  getConnectionConfig: () => ({ mode: connModeRef.mode }),
  getConfigValue: () => "",
  setConfigValue: vi.fn(),
}));

vi.mock("../src/main/ssh-tunnel", () => ({
  getSshTunnelUrl: () => null,
  isSshTunnelActive: () => false,
  isSshTunnelHealthy: () => Promise.resolve(false),
  startSshTunnel: () => Promise.resolve(),
}));

vi.mock("../src/main/utils", () => ({
  stripAnsi: (s: string) => s,
  pidIsAliveAs: (pid: number) => aliveGatewayPids.has(pid),
  getActiveProfileNameSync: () => "default",
  normalizeProfileName: (profile?: string) =>
    !profile || profile === "default" ? undefined : profile,
  profileHome: (profile?: string) =>
    profile ? join(TEST_HOME, "profiles", profile) : TEST_HOME,
  profilePaths: (profile?: string) => {
    const home = profile ? join(TEST_HOME, "profiles", profile) : TEST_HOME;
    return {
      home,
      configFile: join(home, "config.yaml"),
      envFile: join(home, ".env"),
      authFile: join(home, "auth.json"),
    };
  },
}));

vi.mock("../src/main/models", () => ({
  readModels: () => [],
}));

vi.mock("../src/main/process-options", () => ({
  HIDDEN_SUBPROCESS_OPTIONS: {},
}));

vi.mock("http", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require("events");
  const request = vi.fn(
    (
      _url: string,
      _options: Record<string, unknown>,
      callback: (res: { statusCode: number; resume: () => void }) => void,
    ) => {
      const req = new EventEmitter() as InstanceType<typeof EventEmitter> & {
        destroy: () => void;
        end: () => void;
      };
      req.destroy = vi.fn();
      req.end = (): void => {
        queueMicrotask(() => {
          callback({
            statusCode: healthStatuses.shift() ?? 503,
            resume: vi.fn(),
          });
        });
      };
      return req;
    },
  );
  return { default: { request }, request };
});

import {
  isGatewayHealthy,
  isGatewayRunning,
  restartGateway,
  restartGatewayViaCli,
  startGateway,
  startGatewayWithRecovery,
  stopGateway,
  stopHealthPolling,
} from "../src/main/hermes";

function profilePidFile(profile = "work"): string {
  return join(TEST_HOME, "profiles", profile, "gateway.pid");
}

async function waitForProcessExit(
  pid: number,
  timeoutMs = 1000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

async function waitForFile(
  filePath: string,
  timeoutMs = 1000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(filePath)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

describe("restartGatewayViaCli", () => {
  beforeEach(() => {
    stopGateway(true);
    stopGateway("work", true);
    stopGateway("personal", true);
    stopHealthPolling();
    mkdirSync(TEST_HOME, { recursive: true });
    mkdirSync(join(TEST_HOME, "profiles", "work"), { recursive: true });
    mkdirSync(join(TEST_HOME, "profiles", "personal"), { recursive: true });
    mkdirSync(TEST_REPO, { recursive: true });
    connModeRef.mode = "local";
    healthStatuses.length = 0;
    aliveGatewayPids.clear();
    hermesCliArgsSpy.mockReset();
    hermesCliArgsSpy.mockImplementation(() => ["-e", restartScript]);
  });

  afterEach(async () => {
    stopGateway(true);
    stopGateway("work", true);
    stopGateway("personal", true);
    stopHealthPolling();
    await new Promise((resolve) => setTimeout(resolve, 50));
    rmSync(TEST_HOME, { recursive: true, force: true });
    rmSync(TEST_REPO, { recursive: true, force: true });
  });

  it("uses the hermes gateway restart command with the profile env", async () => {
    healthStatuses.push(503, ...Array(20).fill(200));

    await expect(restartGatewayViaCli("work", 50, 1)).resolves.toBe(true);

    expect(hermesCliArgsSpy).toHaveBeenCalledWith([
      "--profile",
      "work",
      "gateway",
      "restart",
    ]);
    expect(await waitForFile(join(TEST_HOME, "restart-env.json"))).toBe(true);
    expect(
      JSON.parse(readFileSync(join(TEST_HOME, "restart-env.json"), "utf-8")),
    ).toEqual({
      api: "true",
      key: "work",
    });
  });

  it("treats a long-running restart process as success once health is ready", async () => {
    const pidFile = join(TEST_HOME, "long-running-restart.pid");
    const longRunningRestartScript =
      "const fs=require('fs');" +
      `fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));` +
      "setInterval(() => {}, 1000);";

    hermesCliArgsSpy.mockImplementation(() => ["-e", longRunningRestartScript]);
    healthStatuses.push(200, 503, 200);

    await expect(restartGatewayViaCli("work", 50, 1)).resolves.toBe(true);

    expect(isGatewayRunning("work")).toBe(true);
    expect(hermesCliArgsSpy).toHaveBeenCalledWith([
      "--profile",
      "work",
      "gateway",
      "restart",
    ]);

    expect(await waitForFile(pidFile)).toBe(true);
    const spawnedPid = Number(readFileSync(pidFile, "utf-8"));
    stopGateway("work", true);
    expect(await waitForProcessExit(spawnedPid, 3000)).toBe(true);
  });

  it("times out and stops a long-running restart process when health stays down", async () => {
    const pidFile = join(TEST_HOME, "unhealthy-restart.pid");
    const unhealthyRestartScript =
      "const fs=require('fs');" +
      `fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));` +
      "setInterval(() => {}, 1000);";

    hermesCliArgsSpy.mockImplementation(() => ["-e", unhealthyRestartScript]);

    const restart = restartGatewayViaCli("work", 500, 10);
    expect(await waitForFile(pidFile)).toBe(true);
    await expect(restart).resolves.toBe(false);

    const spawnedPid = Number(readFileSync(pidFile, "utf-8"));
    expect(await waitForProcessExit(spawnedPid, 3000)).toBe(true);
    expect(hermesCliArgsSpy).toHaveBeenCalledWith([
      "--profile",
      "work",
      "gateway",
      "restart",
    ]);
  });

  it("does not report success when the restart command exits but health stays down", async () => {
    await expect(restartGatewayViaCli("work", 5, 1)).resolves.toBe(false);

    expect(hermesCliArgsSpy).toHaveBeenCalledWith([
      "--profile",
      "work",
      "gateway",
      "restart",
    ]);
  });

  it("resolves false instead of rejecting when restart setup throws", async () => {
    hermesCliArgsSpy.mockImplementation(() => {
      throw new Error("boom");
    });

    await expect(restartGatewayViaCli("work", 5, 1)).resolves.toBe(false);
  });

  it("treats a throwing health probe as unhealthy", async () => {
    connModeRef.mode = "ssh";

    await expect(isGatewayHealthy()).resolves.toBe(false);
  });

  it("deduplicates concurrent restart requests", async () => {
    healthStatuses.push(503, 200, 503, 503, 503, 200, 200, 200);

    const first = restartGatewayViaCli("work", 50, 1);
    const second = restartGatewayViaCli("work", 50, 1);

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(hermesCliArgsSpy).toHaveBeenCalledTimes(1);
  });

  it("uses the native restart path only after the old gateway stops", async () => {
    hermesCliArgsSpy.mockImplementation(() => ["-e", "process.exit(0)"]);
    healthStatuses.push(503, 200);

    await expect(restartGateway("work", 50, 1)).resolves.toBe(true);

    expect(hermesCliArgsSpy).toHaveBeenCalledTimes(1);
    expect(hermesCliArgsSpy).toHaveBeenCalledWith([
      "--profile",
      "work",
      "gateway",
    ]);
  });

  it("does not report native restart success when the old gateway never stops", async () => {
    const gatewayPid = 424242;
    aliveGatewayPids.add(gatewayPid);
    writeFileSync(profilePidFile(), String(gatewayPid), "utf-8");
    hermesCliArgsSpy.mockImplementation(() => ["-e", "process.exit(0)"]);

    healthStatuses.push(...Array(100).fill(200));

    await expect(restartGateway("work", 25, 1, 25)).resolves.toBe(false);

    expect(hermesCliArgsSpy).not.toHaveBeenCalled();
    expect(isGatewayRunning("work")).toBe(true);
    expect(readFileSync(profilePidFile(), "utf-8")).toBe(String(gatewayPid));
  });

  it("serializes restart requests for different profiles instead of reusing the first result", async () => {
    const first = restartGatewayViaCli("work", 5, 1);
    const second = restartGatewayViaCli("personal", 5, 1);

    await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
    expect(hermesCliArgsSpy).toHaveBeenCalledTimes(2);
  });

  it("deduplicates queued restarts for the same profile", async () => {
    hermesCliArgsSpy
      .mockImplementationOnce(() => {
        throw new Error("first failed");
      })
      .mockImplementation(() => ["-e", "process.exit(0)"]);
    healthStatuses.push(503, 200, 503, 503, 503, 200, 200, 200);

    const first = restartGatewayViaCli("work", 50, 1);
    const second = restartGatewayViaCli("personal", 50, 1);
    const third = restartGatewayViaCli("personal", 50, 1);

    await expect(Promise.all([first, second, third])).resolves.toEqual([
      false,
      true,
      true,
    ]);
    expect(hermesCliArgsSpy).toHaveBeenCalledTimes(2);
  });

  it("still runs a queued different-profile restart after the in-flight restart setup fails", async () => {
    hermesCliArgsSpy
      .mockImplementationOnce(() => {
        throw new Error("first failed");
      })
      .mockImplementation(() => ["-e", "process.exit(0)"]);
    healthStatuses.push(503, 200, 503, 503, 503, 200, 200, 200);

    const first = restartGatewayViaCli("work", 5, 1);
    const second = restartGatewayViaCli("personal", 50, 1);

    await expect(Promise.all([first, second])).resolves.toEqual([false, true]);
    expect(hermesCliArgsSpy).toHaveBeenCalledTimes(2);
  });

  it("keeps an existing tracked gateway when CLI restart setup fails", async () => {
    const pidFile = join(TEST_HOME, "tracked-gateway.pid");
    const startScript =
      "const fs=require('fs');" +
      `fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));` +
      "setInterval(() => {}, 1000);";

    hermesCliArgsSpy
      .mockImplementationOnce(() => ["-e", startScript])
      .mockImplementationOnce(() => {
        throw new Error("restart unavailable");
      });

    expect(startGateway("work")).toBe(true);
    expect(isGatewayRunning("work")).toBe(true);
    expect(await waitForFile(pidFile)).toBe(true);

    await expect(restartGatewayViaCli("work", 5, 1)).resolves.toBe(false);

    expect(isGatewayRunning("work")).toBe(true);
    stopGateway("work", true);
    stopGateway("work", true);

    const spawnedPid = Number(readFileSync(pidFile, "utf-8"));
    expect(await waitForProcessExit(spawnedPid, 3000)).toBe(true);
    expect(hermesCliArgsSpy).toHaveBeenNthCalledWith(1, [
      "--profile",
      "work",
      "gateway",
    ]);
    expect(hermesCliArgsSpy).toHaveBeenNthCalledWith(2, [
      "--profile",
      "work",
      "gateway",
      "restart",
    ]);
  });

  it("does not restore a tracked gateway that exited during a failed CLI restart", async () => {
    const pidFile = join(TEST_HOME, "tracked-gateway-exit.pid");
    const startScript =
      "const fs=require('fs');" +
      `fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));` +
      "setInterval(() => {}, 1000);";
    const restartScript =
      "const fs=require('fs');" +
      `const pid=Number(fs.readFileSync(${JSON.stringify(pidFile)},'utf-8'));` +
      "try{process.kill(pid,'SIGTERM')}catch{};" +
      "const done=Date.now()+1000;" +
      "function wait(){try{process.kill(pid,0);if(Date.now()<done)return setTimeout(wait,25)}catch{};process.exit(1)};" +
      "wait();";

    hermesCliArgsSpy
      .mockImplementationOnce(() => ["-e", startScript])
      .mockImplementationOnce(() => ["-e", restartScript]);

    expect(startGateway("work")).toBe(true);
    expect(await waitForFile(pidFile)).toBe(true);

    const spawnedPid = Number(readFileSync(pidFile, "utf-8"));
    await expect(restartGatewayViaCli("work", 2000, 25)).resolves.toBe(false);

    expect(await waitForProcessExit(spawnedPid, 3000)).toBe(true);
    expect(isGatewayRunning("work")).toBe(false);
    expect(hermesCliArgsSpy).toHaveBeenNthCalledWith(1, [
      "--profile",
      "work",
      "gateway",
    ]);
    expect(hermesCliArgsSpy).toHaveBeenNthCalledWith(2, [
      "--profile",
      "work",
      "gateway",
      "restart",
    ]);
  });

  it("falls back to a native restart when a normal start does not become healthy", async () => {
    hermesCliArgsSpy.mockImplementation(() => ["-e", "process.exit(0)"]);
    healthStatuses.push(503, 503, 200);

    await expect(
      startGatewayWithRecovery("work", 5, 50, 15000, 250),
    ).resolves.toBe(true);

    expect(hermesCliArgsSpy).toHaveBeenNthCalledWith(1, [
      "--profile",
      "work",
      "gateway",
    ]);
    expect(hermesCliArgsSpy).toHaveBeenNthCalledWith(2, [
      "--profile",
      "work",
      "gateway",
    ]);
  });

  it("preserves the tracked PID entry when recovery cannot stop the gateway", async () => {
    const gatewayPid = 2147483647;
    aliveGatewayPids.add(gatewayPid);
    writeFileSync(profilePidFile(), String(gatewayPid), "utf-8");
    healthStatuses.push(503, ...Array(100).fill(200));

    await expect(
      startGatewayWithRecovery("work", 50, 75, 15000, 25, 25),
    ).resolves.toBe(false);

    expect(isGatewayRunning("work")).toBe(true);
    expect(readFileSync(profilePidFile(), "utf-8")).toBe(String(gatewayPid));
    expect(hermesCliArgsSpy).not.toHaveBeenCalled();
  });

  it("stops a spawned gateway before native restart recovery", async () => {
    const pidFile = join(TEST_HOME, "spawned-gateway.pid");
    const startScript =
      "const fs=require('fs');" +
      `fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));` +
      "setInterval(() => {}, 1000);";

    hermesCliArgsSpy
      .mockImplementationOnce(() => ["-e", startScript])
      .mockImplementationOnce(() => {
        throw new Error("restart unavailable");
      });

    await expect(startGatewayWithRecovery("work", 1000, 25)).resolves.toBe(
      false,
    );

    const spawnedPid = Number(readFileSync(pidFile, "utf-8"));
    const exited = await waitForProcessExit(spawnedPid);
    if (!exited) {
      try {
        process.kill(spawnedPid, "SIGTERM");
      } catch {
        // already gone
      }
    }

    expect(exited).toBe(true);
    expect(hermesCliArgsSpy).toHaveBeenNthCalledWith(1, [
      "--profile",
      "work",
      "gateway",
    ]);
    expect(hermesCliArgsSpy).toHaveBeenNthCalledWith(2, [
      "--profile",
      "work",
      "gateway",
    ]);
  });
});
