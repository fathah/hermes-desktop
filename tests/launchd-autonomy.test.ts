import { describe, it, expect, beforeEach, vi } from "vitest";

const mockWriteFileSync = vi.fn();
const mockExistsSync = vi.fn();
const mockExec = vi.fn((cmd, cb) => {
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

vi.mock("../src/main/utils", () => ({
  getActiveProfileNameSync: () => "test-profile",
  profileHome: (p: string) => `/tmp/hermes-test-home/.hermes/${p}`,
}));

vi.mock("../src/main/cronjobs", () => ({
  listCronJobs: () => [],
}));

vi.mock("../src/main/self-healing", () => ({
  triggerSelfHealing: () => {},
}));

import { manageLaunchAgent } from "../src/main/control-server";
import { runJobHeadless } from "../src/main/scheduler";

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
    expect(mockExec).toHaveBeenCalled();
    expect(mockExec.mock.calls[1][0]).toContain("launchctl bootstrap");

    Object.defineProperty(process, "platform", { value: originalPlatform });
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
