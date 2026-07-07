import { describe, it, expect, beforeEach, vi } from "vitest";
import vm from "node:vm";
import { join } from "path";

const mockWriteFileSync = vi.fn();
const mockExistsSync = vi.fn();
const mockExec = vi.fn((cmd, cb) => {
  if (typeof cb === "function") cb(null, "success", "");
});
const mockExecFile = vi.fn((_file, _args, _opts, cb) => {
  if (typeof cb === "function") cb(null, "success", "");
});
const mockUnlinkSync = vi.fn();

const filesInMemory = new Map<string, string>();

// Phase 1.2 — the routine lock is now a JSON record at <HERMES_HOME>/locks/<id>.lock
// rather than a bare-PID file in /tmp. These two knobs let a test stand in a lock
// (live, dead, or stale) without knowing the exact resolved path.
let lockExists = false;
let lockContent = "{}";

vi.mock("fs", () => {
  const fns = {
    existsSync: (p: string) => {
      if (p.endsWith(".lock")) return lockExists;
      if (filesInMemory.has(p)) return true;
      return mockExistsSync(p);
    },
    mkdirSync: () => {},
    writeFileSync: (p: string, content: string, options?: unknown) => {
      if (p.endsWith(".lock")) {
        lockExists = true;
        lockContent = content;
      }
      filesInMemory.set(p, content);
      mockWriteFileSync(p, content, options);
    },
    unlinkSync: (p: string) => {
      if (p.endsWith(".lock")) lockExists = false;
      filesInMemory.delete(p);
      mockUnlinkSync(p);
    },
    chmodSync: () => {},
    createWriteStream: () => ({
      write: () => {},
      end: () => {},
    }),
    readFileSync: (p: string) => {
      if (p.endsWith(".lock")) return lockContent;
      return filesInMemory.get(p) ?? "{}";
    },
  };
  return { ...fns, default: fns };
});

vi.mock("child_process", () => {
  const mockSpawn = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: (event: string, callback: (...args: unknown[]) => void) => {
      if (event === "close") {
        setTimeout(() => callback(0), 10);
      }
    },
  };
  const fns = {
    exec: (...args: unknown[]) => {
      const cb = args[args.length - 1];
      mockExec(...args);
      if (typeof cb === "function") {
        (cb as (...args: unknown[]) => void)(null, "success", "");
      }
    },
    execFile: (...args: unknown[]) => {
      const cb = args[args.length - 1];
      mockExecFile(...args);
      if (typeof cb === "function") {
        (cb as (...args: unknown[]) => void)(null, "success", "");
      }
    },
    spawn: () => mockSpawn,
  };
  return { ...fns, default: fns };
});

vi.mock("os", () => {
  const fns = {
    homedir: () => "/tmp/hermes-test-home",
  };
  return { ...fns, default: fns };
});

vi.mock("electron", () => {
  return {
    app: {
      isReady: () => true,
    },
    desktopCapturer: {
      getSources: async () => [],
    },
  };
});

const mockReadDesktopConfig = vi.fn(() => ({}));
const mockWriteDesktopConfig = vi.fn();
vi.mock("../src/main/config", () => ({
  readDesktopConfig: () => mockReadDesktopConfig(),
  writeDesktopConfig: (c: unknown) => mockWriteDesktopConfig(c),
}));

vi.mock("../src/main/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/main/utils")>();
  return {
    ...actual,
    getActiveProfileNameSync: () => "test-profile",
    profileHome: (p: string) => `/tmp/hermes-test-home/.hermes/${p}`,
  };
});

vi.mock("../src/main/learning-proposals", () => ({
  createLearningProposal: vi.fn(),
}));

vi.mock("../src/main/skills", () => ({
  listInstalledSkills: vi.fn(() => []),
  getSkillContent: vi.fn(() => ""),
}));

vi.mock("../src/main/cronjobs", () => ({
  listCronJobs: () => [],
}));

vi.mock("../src/main/self-healing", () => ({
  triggerSelfHealing: () => {},
}));

import {
  manageLaunchAgent,
  renderCronScript,
} from "../src/main/control-server";
import { runJobHeadless } from "../src/main/scheduler";

interface CronHarnessOptions {
  controlServerUp?: boolean;
  gatewayHealthOk?: boolean;
  hermesInstalled?: boolean;
  desktopConfig?: Record<string, unknown>;
  existingGatewayState?: Record<string, unknown>;
  configYaml?: string;
}

function runRenderedCronScript(options: CronHarnessOptions = {}): {
  files: Map<string, string>;
  spawns: Array<{
    command: string;
    args: string[];
    options: Record<string, unknown>;
  }>;
  spawnSyncCalls: Array<{ command: string; args: string[] }>;
  statePath: string;
} {
  const home = "/tmp/hermes-cron-harness";
  const hermesHome = join(home, ".hermes");
  const hermesRepo = join(hermesHome, "hermes-agent");
  const pythonPath = join(hermesRepo, "venv", "bin", "python");
  const desktopJsonPath = join(hermesHome, "desktop.json");
  const profile = String(options.desktopConfig?.activeProfile ?? "default");
  const profileHome =
    profile === "default" ? hermesHome : join(hermesHome, "profiles", profile);
  const statePath = join(profileHome, "closed-app-gateway.json");
  const files = new Map<string, string>();
  const dirs = new Set<string>([home, hermesHome, profileHome]);
  const spawns: Array<{
    command: string;
    args: string[];
    options: Record<string, unknown>;
  }> = [];
  const spawnSyncCalls: Array<{ command: string; args: string[] }> = [];

  files.set(
    desktopJsonPath,
    JSON.stringify(options.desktopConfig ?? { connectionMode: "local" }),
  );
  if (options.existingGatewayState) {
    files.set(statePath, JSON.stringify(options.existingGatewayState));
  }
  if (options.configYaml) {
    files.set(join(profileHome, "config.yaml"), options.configYaml);
  }

  const fsStub = {
    existsSync: (path: string) => {
      if (path === "/usr/bin/curl") return true;
      if (files.has(path) || dirs.has(path)) return true;
      if (options.hermesInstalled === false) return false;
      return path === hermesRepo || path === pythonPath;
    },
    mkdirSync: (path: string) => {
      dirs.add(path);
    },
    readFileSync: (path: string) => files.get(path) ?? "{}",
    writeFileSync: (path: string, content: string) => {
      files.set(path, content);
    },
    appendFileSync: (path: string, content: string) => {
      files.set(path, `${files.get(path) ?? ""}${content}`);
    },
    openSync: () => 7,
    closeSync: () => {},
    unlinkSync: (path: string) => {
      files.delete(path);
    },
  };
  const childProcessStub = {
    spawnSync: (command: string, args: string[]) => {
      spawnSyncCalls.push({ command, args });
      const url = args[args.length - 1] ?? "";
      if (url.endsWith("/state")) {
        return { status: options.controlServerUp ? 0 : 7 };
      }
      if (url.endsWith("/health")) {
        return { status: options.gatewayHealthOk ? 0 : 7 };
      }
      return { status: 0 };
    },
    spawn: (
      command: string,
      args: string[],
      spawnOptions: Record<string, unknown>,
    ) => {
      spawns.push({ command, args, options: spawnOptions });
      return { pid: 4242, unref: vi.fn() };
    },
  };

  const context = {
    require: (id: string) => {
      if (id === "fs") return fsStub;
      if (id === "path") return { join };
      if (id === "child_process") return childProcessStub;
      if (id === "os") return { homedir: () => home };
      throw new Error(`Unexpected require: ${id}`);
    },
    process: {
      env: {},
      platform: "darwin",
    },
    console,
    Date,
  };
  const script = renderCronScript().replace(/^#!.*\n/, "");
  vm.runInNewContext(script, context, { filename: "hermes-cron.js" });

  return { files, spawns, spawnSyncCalls, statePath };
}

describe("launchd Daemon & File-based Single Flight Locking", () => {
  beforeEach(() => {
    filesInMemory.clear();
    vi.clearAllMocks();
    lockExists = false;
    lockContent = "{}";
    mockExistsSync.mockImplementation((p: string) => {
      // Mock plist directory and standard paths exists
      if (p.includes("Library/LaunchAgents") || p.includes(".hermes")) {
        return true;
      }
      return false;
    });
  });

  it("should generate macOS LaunchAgent plist and trigger bootstrap", () => {
    // Only test if on darwin, otherwise skip or mock process.platform
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });

    manageLaunchAgent(true);

    expect(mockWriteFileSync).toHaveBeenCalled();
    const plistPath = mockWriteFileSync.mock.calls[0][0];
    const plistContent = mockWriteFileSync.mock.calls[0][1];

    expect(plistPath).toContain(
      "/tmp/hermes-test-home/Library/LaunchAgents/com.nousresearch.hermes-scheduler.plist",
    );
    expect(plistContent).toContain(
      "<string>com.nousresearch.hermes-scheduler</string>",
    );
    expect(plistContent).toContain("<key>StartInterval</key>");
    expect(mockExec).not.toHaveBeenCalled();
    expect(mockExecFile).toHaveBeenCalledWith(
      "launchctl",
      ["bootout", `gui/${process.getuid?.() ?? 0}`, plistPath],
      expect.objectContaining({ shell: false }),
      expect.any(Function),
    );
    expect(mockExecFile).toHaveBeenCalledWith(
      "launchctl",
      ["bootstrap", `gui/${process.getuid?.() ?? 0}`, plistPath],
      expect.objectContaining({ shell: false }),
      expect.any(Function),
    );

    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("generated cron helper handles app launch schedules without shell interpolation", () => {
    const script = renderCronScript();

    expect(script).toContain("app-launcher.json");
    expect(script).toContain("runWhenClosed");
    expect(script).toContain("spawnSync('/usr/bin/open', args");
    expect(script).toContain("shell: false");
    expect(script).not.toContain("open ${");
  });

  it("generated cron helper keeps the gateway alive without fighting the open desktop app", () => {
    const script = renderCronScript();

    expect(script).toContain("closed-app-gateway.json");
    expect(script).toContain("desktopControlStateAvailable()");
    expect(script).toContain("managed-by-desktop");
    expect(script).toContain("/health");
    expect(script).toContain("gateway', 'run'");
    expect(script).toContain("API_SERVER_PORT");
    expect(script).toContain("spawn(pythonPath, runArgs");
    expect(script).toContain("waiting-for-restart");
    expect(script).toContain("lastOutageMs");
    expect(script).toContain("shell: false");
  });

  it("generated cron helper restarts the local gateway when the desktop is closed and health is down", () => {
    const result = runRenderedCronScript({
      gatewayHealthOk: false,
      desktopConfig: { connectionMode: "local" },
    });

    const state = JSON.parse(result.files.get(result.statePath) ?? "{}");
    expect(state).toMatchObject({
      status: "restarted",
      port: 8642,
      lastRestartPid: 4242,
    });
    expect(state.outageStartedAt).toBeTruthy();
    expect(result.spawns).toHaveLength(1);
    expect(result.spawns[0].command).toContain(
      ".hermes/hermes-agent/venv/bin/python",
    );
    expect(result.spawns[0].args).toEqual([
      join("/tmp/hermes-cron-harness/.hermes/hermes-agent", "hermes"),
      "gateway",
      "run",
    ]);
    expect(result.spawns[0].options).toMatchObject({
      cwd: "/tmp/hermes-cron-harness/.hermes/hermes-agent",
      detached: true,
      shell: false,
    });
    expect(result.spawns[0].options.env).toMatchObject({
      HERMES_HOME: "/tmp/hermes-cron-harness/.hermes",
      API_SERVER_ENABLED: "true",
      API_SERVER_PORT: "8642",
      FAZM_HEADLESS: "1",
    });
  });

  it("generated cron helper records desktop ownership instead of double-managing the gateway", () => {
    const result = runRenderedCronScript({
      controlServerUp: true,
      desktopConfig: {
        connectionMode: "local",
        controlServerPort: 17345,
        controlServerToken: "test-token",
      },
    });

    const state = JSON.parse(result.files.get(result.statePath) ?? "{}");
    expect(state).toMatchObject({ status: "managed-by-desktop" });
    expect(result.spawns).toEqual([]);
    expect(
      result.spawnSyncCalls.some((call) => call.args.includes("/state")),
    ).toBe(false);
    expect(
      result.spawnSyncCalls.some((call) =>
        call.args.includes("http://127.0.0.1:17345/state"),
      ),
    ).toBe(true);
  });

  it("generated cron helper preserves closed-app outage duration after health recovers", () => {
    const result = runRenderedCronScript({
      gatewayHealthOk: true,
      existingGatewayState: {
        status: "waiting-for-restart",
        outageStartedAt: "2000-01-01T00:00:00.000Z",
      },
      configYaml: "api_server:\n  port: 9765\n",
    });

    const state = JSON.parse(result.files.get(result.statePath) ?? "{}");
    expect(state).toMatchObject({
      status: "healthy",
      port: 9765,
      outageStartedAt: null,
    });
    expect(state.lastOutageMs).toBeGreaterThan(0);
    expect(result.spawns).toEqual([]);
  });

  it("should prevent duplicate runs when a live lock is held", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });

    // A lock owned by THIS process (definitely alive) with a fresh timestamp must
    // block — that is the single-flight guarantee.
    lockExists = true;
    lockContent = JSON.stringify({ pid: process.pid, startedAt: Date.now() });

    const success = await runJobHeadless(
      "job-123",
      "Test Task",
      "test-profile",
    );
    expect(success).toBe(false);
    // It must NOT overwrite the live lock.
    const wroteALock = mockWriteFileSync.mock.calls.some(([p]) =>
      String(p).endsWith("job-123.lock"),
    );
    expect(wroteALock).toBe(false);

    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("should self-heal: steal a dead-owner lock and run the job", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });

    // A lock left by a process that no longer exists (crash) must be stolen rather
    // than wedging the job forever — the core 1.2 fix.
    lockExists = true;
    lockContent = JSON.stringify({ pid: 999999, startedAt: Date.now() });

    const success = await runJobHeadless(
      "job-456",
      "Test Task",
      "test-profile",
    );
    expect(success).toBe(true);
    // It re-takes the lock with a fresh JSON record.
    const wroteLock = mockWriteFileSync.mock.calls.find(([p]) =>
      String(p).endsWith("job-456.lock"),
    );
    expect(wroteLock).toBeDefined();
    expect(String(wroteLock?.[1])).toContain(`"pid":${process.pid}`);

    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("should create a JSON lockfile on run and clean it up on completion", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });

    lockExists = false;

    const successPromise = runJobHeadless(
      "job-999",
      "Test Task",
      "test-profile",
    );

    // Writes a JSON record (pid + startedAt) to <id>.lock, not a bare PID.
    const lockWrite = mockWriteFileSync.mock.calls.find(([p]) =>
      String(p).endsWith("job-999.lock"),
    );
    expect(lockWrite).toBeDefined();
    expect(String(lockWrite?.[0])).toContain("locks");
    expect(String(lockWrite?.[1])).toContain(`"pid":${process.pid}`);

    const success = await successPromise;
    expect(success).toBe(true);

    // Cleans up its lock on completion.
    const unlinked = mockUnlinkSync.mock.calls.some(([p]) =>
      String(p).endsWith("job-999.lock"),
    );
    expect(unlinked).toBe(true);

    Object.defineProperty(process, "platform", { value: originalPlatform });
  });
});
