import { EventEmitter } from "events";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "child_process";

const {
  TEST_HOME,
  TEST_REPO,
  connModeRef,
  hermesCliArgsSpy,
  installedEngineShaRef,
  engineCapabilityStateRef,
  portResolutionRef,
  verifyEngineContractMock,
} = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");

  return {
    TEST_HOME: path.join(os.tmpdir(), `hermes-gateway-process-${Date.now()}`),
    TEST_REPO: path.join(
      os.tmpdir(),
      `hermes-gateway-process-repo-${Date.now()}`,
    ),
    connModeRef: { mode: "local" as "local" | "remote" | "ssh" },
    installedEngineShaRef: {
      value: "1111111111111111111111111111111111111111" as string | null,
    },
    engineCapabilityStateRef: {
      value: {
        installedSha: "1111111111111111111111111111111111111111",
        lastVerifiedSha: "1111111111111111111111111111111111111111",
        lastVerification: null,
        snapshot: {
          status: "ready" as const,
          fetchedAt: "2026-07-07T00:00:00.000Z",
          mode: "local" as const,
          engineSha: "1111111111111111111111111111111111111111",
          features: {},
          endpoints: {},
        },
      },
    },
    hermesCliArgsSpy: vi.fn((extra?: string[]) => [
      "/dev/null",
      ...(extra || []),
    ]),
    verifyEngineContractMock: vi.fn().mockResolvedValue({
      checkedAt: "2026-07-07T00:00:00.000Z",
      status: "passed",
      findings: [],
    }),
    portResolutionRef: {
      value: {
        port: 18642,
        profile: undefined as string | undefined,
        relocated: false,
      } as {
        port: number;
        profile: string | undefined;
        relocated: boolean;
        previousPort?: number;
        reason?: string;
        nextAction?: string;
      },
    },
  };
});

vi.mock("../installer", () => ({
  HERMES_HOME: TEST_HOME,
  HERMES_PYTHON: process.execPath,
  HERMES_REPO: TEST_REPO,
  hermesCliArgs: hermesCliArgsSpy,
  getEnhancedPath: () => process.env.PATH || "",
  getInstalledEngineSha: () => Promise.resolve(installedEngineShaRef.value),
}));

vi.mock("../config", () => ({
  getConnectionConfig: () => ({ mode: connModeRef.mode }),
  getApiServerKey: () => "",
  readEnv: (profile?: string) => ({ TEST_PROFILE_KEY: profile || "default" }),
}));

vi.mock("../engine-update-state", () => ({
  getEngineCapabilityState: () => engineCapabilityStateRef.value,
}));

vi.mock("../engine-contract-verify", () => ({
  verifyAndRecordEngineContract: verifyEngineContractMock,
}));

vi.mock("../ssh-tunnel", () => ({
  getSshTunnelUrl: () => null,
  startSshTunnel: vi.fn(),
}));

vi.mock("../utils", () => ({
  pidIsAliveAs: () => false,
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

vi.mock("../gateway-ports", () => ({
  getProfilePort: () => portResolutionRef.value.port,
  resolveProfilePort: () => portResolutionRef.value,
}));

vi.mock("../process-options", () => ({
  HIDDEN_SUBPROCESS_OPTIONS: {},
}));

vi.mock("../log", () => ({
  formatLogError: (err: unknown) =>
    err instanceof Error ? err.message : String(err),
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
  rotateGatewayStderrIfLarge: vi.fn(),
}));

import {
  __resetGatewayProcessForTests,
  __setGatewayProcessRuntimeForTests,
  isGatewayRunning,
  restartGateway,
  setGatewayReadyNotifier,
  startGateway,
  startGatewayDetailed,
  startGatewayWithRecovery,
  startHealthPolling,
  verifyGatewayEngineContractBeforeReady,
  type GatewayProcessRuntime,
} from "./gateway-process";

class FakeChildProcess extends EventEmitter {
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  unref = vi.fn();
  kill = vi.fn((signal: NodeJS.Signals = "SIGTERM") => {
    this.killed = true;
    this.signalCode = signal;
    this.emit("close", null, signal);
    return true;
  });

  crash(code = 1): void {
    this.exitCode = code;
    this.emit("close", code, null);
  }
}

interface RuntimeHarness {
  children: FakeChildProcess[];
  healthStatuses: number[];
  lifecycleEvents: string[];
  readyProfiles: Array<string | undefined>;
  runtime: Partial<GatewayProcessRuntime>;
}

function createHarness(): RuntimeHarness {
  const children: FakeChildProcess[] = [];
  const healthStatuses: number[] = [];
  const lifecycleEvents: string[] = [];
  const readyProfiles: Array<string | undefined> = [];
  let now = 0;

  const runtime: Partial<GatewayProcessRuntime> = {
    now: () => now,
    setTimeout: ((callback: (...args: unknown[]) => void, ms?: number) => {
      now += Number(ms ?? 0);
      callback();
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
    clearTimeout: vi.fn() as typeof clearTimeout,
    setInterval: vi.fn(
      () => 1 as unknown as ReturnType<typeof setInterval>,
    ) as unknown as typeof setInterval,
    clearInterval: vi.fn() as typeof clearInterval,
    spawn: vi.fn(() => {
      const id = children.length + 1;
      const child = new FakeChildProcess();
      const originalKill = child.kill;
      child.kill = vi.fn((signal: NodeJS.Signals = "SIGTERM") => {
        lifecycleEvents.push(`kill:${id}`);
        return originalKill(signal);
      });
      children.push(child);
      lifecycleEvents.push(`spawn:${id}`);
      return child as unknown as ChildProcess;
    }) as unknown as GatewayProcessRuntime["spawn"],
    gatewayFetch: vi.fn(async () => {
      now += 10;
      const status = healthStatuses.shift() ?? 503;
      return { status } as Response;
    }) as unknown as GatewayProcessRuntime["gatewayFetch"],
  };

  return { children, healthStatuses, lifecycleEvents, readyProfiles, runtime };
}

describe("gateway process lifecycle", () => {
  let harness: RuntimeHarness;

  beforeEach(() => {
    __resetGatewayProcessForTests();
    mkdirSync(TEST_HOME, { recursive: true });
    mkdirSync(join(TEST_HOME, "profiles", "work"), { recursive: true });
    mkdirSync(TEST_REPO, { recursive: true });
    connModeRef.mode = "local";
    installedEngineShaRef.value = "1111111111111111111111111111111111111111";
    engineCapabilityStateRef.value = {
      installedSha: "1111111111111111111111111111111111111111",
      lastVerifiedSha: "1111111111111111111111111111111111111111",
      lastVerification: null,
      snapshot: {
        status: "ready",
        fetchedAt: "2026-07-07T00:00:00.000Z",
        mode: "local",
        engineSha: "1111111111111111111111111111111111111111",
        features: {},
        endpoints: {},
      },
    };
    verifyEngineContractMock.mockClear();
    verifyEngineContractMock.mockResolvedValue({
      checkedAt: "2026-07-07T00:00:00.000Z",
      status: "passed",
      findings: [],
    });
    portResolutionRef.value = {
      port: 18642,
      profile: undefined,
      relocated: false,
    };
    hermesCliArgsSpy.mockClear();
    harness = createHarness();
    __setGatewayProcessRuntimeForTests(harness.runtime);
    setGatewayReadyNotifier((profile) => {
      harness.readyProfiles.push(profile);
    });
  });

  afterEach(() => {
    __resetGatewayProcessForTests();
    rmSync(TEST_HOME, { recursive: true, force: true });
    rmSync(TEST_REPO, { recursive: true, force: true });
  });

  it("starts a local gateway and proves health before reporting recovery", async () => {
    harness.healthStatuses.push(200);

    await expect(startGatewayWithRecovery("work", 5, 1, 5, 1)).resolves.toBe(
      true,
    );

    expect(harness.children).toHaveLength(1);
    expect(isGatewayRunning("work")).toBe(true);
    expect(harness.readyProfiles).toEqual(["work"]);
    expect(hermesCliArgsSpy).toHaveBeenCalledWith([
      "--profile",
      "work",
      "gateway",
      "run",
    ]);
  });

  it("polls gateway health every 10 seconds", () => {
    startHealthPolling();

    expect(harness.runtime.setInterval).toHaveBeenCalledWith(
      expect.any(Function),
      10000,
    );
  });

  it("returns named-profile port relocation details from start", () => {
    portResolutionRef.value = {
      port: 18643,
      profile: "work",
      relocated: true,
      previousPort: 8642,
      reason: "configured port conflicts with another profile",
      nextAction: "Restart the work gateway so it binds to port 18643.",
    };

    expect(startGatewayDetailed("work")).toMatchObject({
      success: true,
      running: true,
      port: 18643,
      portRelocation: {
        profile: "work",
        oldPort: 8642,
        newPort: 18643,
        nextAction: "Restart the work gateway so it binds to port 18643.",
      },
    });
  });

  it("verifies a changed engine SHA before recovery reports ready", async () => {
    installedEngineShaRef.value = "2222222222222222222222222222222222222222";
    engineCapabilityStateRef.value = {
      ...engineCapabilityStateRef.value,
      installedSha: "1111111111111111111111111111111111111111",
      lastVerifiedSha: "1111111111111111111111111111111111111111",
    };
    harness.healthStatuses.push(200);

    await expect(startGatewayWithRecovery("work", 5, 1, 5, 1)).resolves.toBe(
      true,
    );

    expect(verifyEngineContractMock).toHaveBeenCalledWith(
      "work",
      expect.objectContaining({ getCapabilityState: expect.any(Function) }),
    );
    const options = verifyEngineContractMock.mock.calls[0][1];
    expect(options.getCapabilityState("work").snapshot.status).toBe("unknown");
    expect(harness.readyProfiles).toEqual(["work"]);
  });

  it("blocks ready state and stops the gateway when changed engine verification is broken", async () => {
    installedEngineShaRef.value = "2222222222222222222222222222222222222222";
    engineCapabilityStateRef.value = {
      ...engineCapabilityStateRef.value,
      installedSha: "1111111111111111111111111111111111111111",
      lastVerifiedSha: "1111111111111111111111111111111111111111",
    };
    verifyEngineContractMock.mockResolvedValue({
      checkedAt: "2026-07-07T00:00:00.000Z",
      status: "broken",
      findings: [
        {
          entryId: "gateway",
          kind: "cli",
          value: "gateway",
          tier: "fail",
          verdict: "broken",
          detail: "Top-level command gateway is missing.",
        },
      ],
    });
    harness.healthStatuses.push(200);

    await expect(startGatewayWithRecovery("work", 5, 1, 5, 1)).resolves.toBe(
      false,
    );

    expect(verifyEngineContractMock).toHaveBeenCalledOnce();
    expect(harness.readyProfiles).toEqual([]);
    expect(harness.children[0].killed).toBe(true);
  });

  it("treats an unreadable installed engine SHA as unknown rather than broken", async () => {
    installedEngineShaRef.value = null;

    const result = await verifyGatewayEngineContractBeforeReady("work");

    expect(result).toMatchObject({
      ready: true,
      status: "unknown",
    });
    expect(verifyEngineContractMock).not.toHaveBeenCalled();
  });

  it("cleans up spawned children when gateway health never becomes ready", async () => {
    await expect(startGatewayWithRecovery("work", 5, 1, 5, 1)).resolves.toBe(
      false,
    );

    expect(harness.children).toHaveLength(2);
    expect(harness.children.every((child) => child.killed)).toBe(true);
    expect(isGatewayRunning("work")).toBe(false);
    expect(harness.readyProfiles).toEqual([]);
  });

  it("restarts by stopping the old child before starting the replacement", async () => {
    expect(startGateway("work")).toBe(true);
    harness.healthStatuses.push(503, 200);

    await expect(restartGateway("work", 5, 1, 5)).resolves.toBe(true);

    expect(harness.lifecycleEvents).toEqual(["spawn:1", "kill:1", "spawn:2"]);
    expect(harness.children[0].killed).toBe(true);
    expect(harness.children[1].killed).toBe(false);
    expect(isGatewayRunning("work")).toBe(true);
  });

  it("clears crashed child state so recovery can spawn a fresh gateway", async () => {
    expect(startGateway("work")).toBe(true);

    harness.children[0].crash(1);

    expect(isGatewayRunning("work")).toBe(false);

    harness.healthStatuses.push(200);

    await expect(startGatewayWithRecovery("work", 5, 1, 5, 1)).resolves.toBe(
      true,
    );

    expect(harness.children).toHaveLength(2);
    expect(harness.lifecycleEvents).toEqual(["spawn:1", "spawn:2"]);
    expect(isGatewayRunning("work")).toBe(true);
  });
});
