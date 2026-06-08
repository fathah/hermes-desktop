import { describe, it, expect, beforeEach, vi } from "vitest";
import { join } from "path";

const mockWriteFileSync = vi.fn();
const mockExistsSync = vi.fn();
const mockExec = vi.fn((cmd, cb) => {
  if (typeof cb === "function") cb(null, "success", "");
});
const mockUnlinkSync = vi.fn();

const filesInMemory = new Map<string, string>();

vi.mock("fs", () => {
  const fns = {
    existsSync: (p: string) => {
      if (filesInMemory.has(p)) return true;
      return mockExistsSync(p);
    },
    mkdirSync: () => {},
    writeFileSync: (p: string, content: string, options?: unknown) => {
      filesInMemory.set(p, content);
      mockWriteFileSync(p, content, options);
    },
    unlinkSync: (p: string) => {
      filesInMemory.delete(p);
      mockUnlinkSync(p);
    },
    chmodSync: () => {},
    createWriteStream: () => ({
      write: () => {},
      end: () => {},
    }),
    readFileSync: () => "{}",
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

  it("should prevent duplicate runs of same job if lockfile exists", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });

    const lockPath = join("/tmp", "hermes-routine-job-123.lock");

    // Simulate lockfile exists
    mockExistsSync.mockImplementation((p: string) => {
      if (p === lockPath) return true;
      if (p.includes("Library/LaunchAgents") || p.includes(".hermes"))
        return true;
      return false;
    });

    const success = await runJobHeadless(
      "job-123",
      "Test Task",
      "test-profile",
    );
    expect(success).toBe(false);
    expect(mockWriteFileSync).not.toHaveBeenCalledWith(
      lockPath,
      expect.any(String),
    );

    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("should create lockfile on run and clean it up on completion", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });

    const lockPath = join("/tmp", "hermes-routine-job-999.lock");
    mockExistsSync.mockImplementation((p: string) => {
      if (p === lockPath) return false;
      if (p.includes("Library/LaunchAgents") || p.includes(".hermes"))
        return true;
      return false;
    });

    const successPromise = runJobHeadless(
      "job-999",
      "Test Task",
      "test-profile",
    );

    // Should write lockfile
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      lockPath,
      String(process.pid),
      "utf-8",
    );

    const success = await successPromise;
    expect(success).toBe(true);

    // Should remove lockfile
    expect(mockUnlinkSync).toHaveBeenCalledWith(lockPath);

    Object.defineProperty(process, "platform", { value: originalPlatform });
  });
});
