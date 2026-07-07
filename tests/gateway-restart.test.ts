import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const {
  TEST_HOME,
  TEST_REPO,
  connModeRef,
  healthStatuses,
  aliveGatewayPids,
  spawned,
  spawnErrorRef,
  lifecycleEvents,
  hermesCliArgsSpy,
  sshTunnelStarts,
  engineSha,
} = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");

  return {
    TEST_HOME: path.join(os.tmpdir(), `hermes-gateway-restart-${Date.now()}`),
    TEST_REPO: path.join(os.tmpdir(), `hermes-gateway-repo-${Date.now()}`),
    connModeRef: {
      mode: "local" as "local" | "remote" | "ssh",
      remoteUrl: "",
      apiKey: "",
      ssh: {
        host: "",
        port: 22,
        username: "",
        keyPath: "",
        remotePort: 8642,
        localPort: 18642,
      },
    },
    healthStatuses: [] as number[],
    aliveGatewayPids: new Set<number>(),
    spawned: [] as Array<
      EventEmitter & {
        killed: boolean;
        exitCode: number | null;
        signalCode: NodeJS.Signals | null;
        kill: ReturnType<typeof vi.fn>;
        unref: ReturnType<typeof vi.fn>;
      }
    >,
    spawnErrorRef: { error: null as Error | null },
    lifecycleEvents: [] as string[],
    hermesCliArgsSpy: vi.fn((extra?: string[]) => [
      "/dev/null",
      ...(extra || []),
    ]),
    sshTunnelStarts: [] as unknown[],
    engineSha: "1111111111111111111111111111111111111111",
  };
});

vi.mock("child_process", () => {
  const spawnMock = vi.fn(() => {
    if (spawnErrorRef.error) throw spawnErrorRef.error;
    const id = spawned.length + 1;
    const proc = Object.assign(new EventEmitter(), {
      killed: false,
      exitCode: null,
      signalCode: null as NodeJS.Signals | null,
      kill: vi.fn((signal: NodeJS.Signals = "SIGTERM") => {
        proc.killed = true;
        proc.signalCode = signal;
        lifecycleEvents.push(`kill:${id}`);
        proc.emit("close", null, signal);
        return true;
      }),
      unref: vi.fn(),
    });
    spawned.push(proc);
    lifecycleEvents.push(`spawn:${id}`);
    return proc;
  });
  return {
    default: { spawn: spawnMock },
    spawn: spawnMock,
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
  HERMES_PYTHON: process.execPath,
  HERMES_REPO: TEST_REPO,
  hermesCliArgs: hermesCliArgsSpy,
  getEnhancedPath: () => process.env.PATH || "",
  getInstalledEngineSha: () => Promise.resolve(engineSha),
}));

vi.mock("../src/main/config", () => ({
  getApiServerKey: () => "",
  readEnv: (profile?: string) => ({ TEST_PROFILE_KEY: profile || "default" }),
  getConnectionConfig: () => connModeRef,
  getConfigValue: () => "",
  setConfigValue: vi.fn(),
}));

vi.mock("../src/main/engine-update-state", () => ({
  getEngineCapabilityState: () => ({
    installedSha: engineSha,
    lastVerifiedSha: engineSha,
    lastVerification: null,
    snapshot: {
      status: "ready",
      fetchedAt: "2026-07-07T00:00:00.000Z",
      mode: "local",
      engineSha,
      features: {},
      endpoints: {},
    },
  }),
}));

vi.mock("../src/main/engine-contract-verify", () => ({
  verifyAndRecordEngineContract: vi.fn(),
}));

vi.mock("../src/main/ssh-tunnel", () => ({
  getSshTunnelUrl: () => null,
  isSshTunnelActive: () => false,
  isSshTunnelHealthy: () => Promise.resolve(false),
  startSshTunnel: vi.fn((config: unknown) => {
    sshTunnelStarts.push(config);
    return Promise.resolve();
  }),
}));

vi.mock("../src/main/utils", () => ({
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

vi.mock("../src/main/process-options", () => ({
  HIDDEN_SUBPROCESS_OPTIONS: {},
}));

import {
  getGatewayHealthStatus,
  isGatewayRunning,
  restartGateway,
  setGatewayHealthBroadcaster,
  startGateway,
  startGatewayDetailed,
  startGatewayWithRecovery,
  startHealthPolling,
  stopGateway,
  stopHealthPolling,
} from "../src/main/hermes";
import {
  __resetGatewayProcessForTests,
  __setGatewayProcessRuntimeForTests,
} from "../src/main/hermes/gateway-process";

function profilePidFile(profile = "work"): string {
  return join(TEST_HOME, "profiles", profile, "gateway.pid");
}

function profileLockFile(profile = "work"): string {
  return join(TEST_HOME, "profiles", profile, "gateway.lock");
}

describe("gateway restart recovery", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    stopGateway(undefined, true);
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
    spawned.length = 0;
    spawnErrorRef.error = null;
    lifecycleEvents.length = 0;
    hermesCliArgsSpy.mockClear();
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.endsWith("/health")) {
        const status = healthStatuses.shift() ?? 503;
        return { status, ok: status === 200 } as Response;
      }
      return { status: 404, ok: false } as Response;
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    stopGateway(undefined, true);
    stopGateway("work", true);
    stopGateway("personal", true);
    stopHealthPolling();
    globalThis.fetch = originalFetch;
    rmSync(TEST_HOME, { recursive: true, force: true });
    rmSync(TEST_REPO, { recursive: true, force: true });
  });

  it("does not report an exited tracked child as running", () => {
    expect(startGateway("work")).toBe(true);
    expect(isGatewayRunning("work")).toBe(true);

    spawned[0].exitCode = 1;

    expect(isGatewayRunning("work")).toBe(false);
  });

  it("recognizes current Hermes gateway.lock runtime files", () => {
    const gatewayPid = 424242;
    aliveGatewayPids.add(gatewayPid);
    writeFileSync(
      profileLockFile(),
      JSON.stringify({
        pid: gatewayPid,
        kind: "hermes-gateway",
        argv: ["/tmp/hermes", "gateway", "run"],
      }),
      "utf-8",
    );

    expect(isGatewayRunning("work")).toBe(true);

    aliveGatewayPids.delete(gatewayPid);

    expect(isGatewayRunning("work")).toBe(false);
  });

  it("reports spawn failures without tracking a gateway process", () => {
    spawnErrorRef.error = new Error("spawn boom");

    const result = startGatewayDetailed("work");

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        running: false,
        error: "Failed to start the gateway process: spawn boom",
      }),
    );
    expect(spawned).toHaveLength(0);
    expect(isGatewayRunning("work")).toBe(false);
  });

  it("force-stops an app-started gateway and clears running state", () => {
    expect(startGateway("work")).toBe(true);
    expect(isGatewayRunning("work")).toBe(true);

    stopGateway("work", true);

    expect(spawned[0].killed).toBe(true);
    expect(isGatewayRunning("work")).toBe(false);
  });

  it("waits for the old gateway to stop before starting the replacement", async () => {
    expect(startGateway("work")).toBe(true);
    healthStatuses.push(503, 200);

    await expect(restartGateway("work", 50, 1, 50)).resolves.toBe(true);

    expect(lifecycleEvents).toEqual(["spawn:1", "kill:1", "spawn:2"]);
    expect(hermesCliArgsSpy).toHaveBeenLastCalledWith([
      "--profile",
      "work",
      "gateway",
      "run",
    ]);
  });

  it("restores a live PID entry when the old gateway never stops", async () => {
    const gatewayPid = 424242;
    const pidEntry = JSON.stringify({ pid: gatewayPid, startedAt: 12345 });
    aliveGatewayPids.add(gatewayPid);
    writeFileSync(profilePidFile(), pidEntry, "utf-8");
    healthStatuses.push(...Array(100).fill(200));

    await expect(restartGateway("work", 25, 1, 25)).resolves.toBe(false);

    expect(spawned).toHaveLength(0);
    expect(isGatewayRunning("work")).toBe(true);
    expect(readFileSync(profilePidFile(), "utf-8")).toBe(pidEntry);
  });

  it("deduplicates concurrent restarts for the same profile", async () => {
    expect(startGateway("work")).toBe(true);
    healthStatuses.push(503, 200);

    const first = restartGateway("work", 50, 1, 50);
    const second = restartGateway("work", 50, 1, 50);

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(lifecycleEvents).toEqual(["spawn:1", "kill:1", "spawn:2"]);
  });

  it("serializes restarts for different profiles without reusing the first result", async () => {
    expect(startGateway("work")).toBe(true);
    expect(startGateway("personal")).toBe(true);
    healthStatuses.push(503, 200, 503, 200);

    const first = restartGateway("work", 50, 1, 50);
    const second = restartGateway("personal", 50, 1, 50);

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(hermesCliArgsSpy).toHaveBeenNthCalledWith(3, [
      "--profile",
      "work",
      "gateway",
      "run",
    ]);
    expect(hermesCliArgsSpy).toHaveBeenNthCalledWith(4, [
      "--profile",
      "personal",
      "gateway",
      "run",
    ]);
  });

  it("recovers a stopped local gateway and proves health before returning", async () => {
    healthStatuses.push(503, 200);

    await expect(startGatewayWithRecovery("work", 100, 1, 50)).resolves.toBe(
      true,
    );

    expect(spawned).toHaveLength(1);
    expect(hermesCliArgsSpy).toHaveBeenCalledWith([
      "--profile",
      "work",
      "gateway",
      "run",
    ]);
  });

  it("is a no-op in remote mode", async () => {
    connModeRef.mode = "remote";

    await expect(restartGateway("work")).resolves.toBe(false);
    await expect(startGatewayWithRecovery("work")).resolves.toBe(false);
    expect(spawned).toHaveLength(0);
  });
});

describe("remote gateway supervision", () => {
  let intervalTick: (() => void) | null = null;
  let broadcasts: string[] = [];

  beforeEach(() => {
    __resetGatewayProcessForTests();
    connModeRef.mode = "local";
    connModeRef.remoteUrl = "";
    connModeRef.apiKey = "";
    connModeRef.ssh = {
      host: "",
      port: 22,
      username: "",
      keyPath: "",
      remotePort: 8642,
      localPort: 18642,
    };
    healthStatuses.length = 0;
    sshTunnelStarts.length = 0;
    broadcasts = [];
    intervalTick = null;
    __setGatewayProcessRuntimeForTests({
      gatewayFetch: vi.fn(async () => {
        const status = healthStatuses.shift() ?? 503;
        return { status, ok: status === 200 } as Response;
      }),
      setInterval: ((callback: () => void) => {
        intervalTick = callback;
        return 1 as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval,
      clearInterval: vi.fn() as typeof clearInterval,
      setTimeout: ((callback: () => void) => {
        callback();
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeout: vi.fn() as typeof clearTimeout,
      now: () => 0,
    });
    setGatewayHealthBroadcaster((status) => broadcasts.push(status));
  });

  afterEach(() => {
    stopHealthPolling();
    __resetGatewayProcessForTests();
  });

  async function runTick(): Promise<void> {
    intervalTick?.();
    await Promise.resolve();
    await Promise.resolve();
  }

  it("broadcasts remote URL failures as down", async () => {
    connModeRef.mode = "remote";
    connModeRef.remoteUrl = "http://127.0.0.1:8642";
    healthStatuses.push(503);

    startHealthPolling();
    await runTick();

    expect(getGatewayHealthStatus()).toBe("down");
    expect(broadcasts).toEqual(["down"]);
  });

  it("surfaces SSH failures as recovering and restarts the tunnel", async () => {
    connModeRef.mode = "ssh";
    connModeRef.ssh = {
      host: "remote.example",
      port: 22,
      username: "alice",
      keyPath: "/tmp/id_ed25519",
      remotePort: 8642,
      localPort: 18642,
    };
    healthStatuses.push(503, 503, 503);

    startHealthPolling();
    await runTick();
    await runTick();
    await runTick();

    expect(getGatewayHealthStatus()).toBe("recovering");
    expect(broadcasts).toEqual(["unhealthy", "recovering"]);
    expect(sshTunnelStarts).toEqual([connModeRef.ssh]);
  });
});
