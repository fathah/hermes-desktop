import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock electron desktopCapturer and app
vi.mock("electron", () => {
  const mockThumbnail = {
    toPNG: () => Buffer.from("fake-png-data"),
  };
  return {
    app: {
      isReady: () => true,
    },
    powerMonitor: {
      getSystemIdleTime: () => 0,
    },
    desktopCapturer: {
      getSources: async () => [{ thumbnail: mockThumbnail }],
    },
  };
});

// Mocking dependencies
const mockSpawn = vi.fn();
const mockListCronJobs = vi.fn();
const mockTriggerSelfHealing = vi.fn();
const mockProfileHome = vi.fn(() => "/tmp/hermes-test-profile");
const mockWriteDesktopConfig = vi.fn();
const mockReadDesktopConfig = vi.fn(() => ({}));
const mockMaybeRunHermesAgentUpdateRoutine = vi.fn();
const mockMaybeRunHermesUpstreamWatchRoutine = vi.fn();

vi.mock("child_process", () => {
  const fns = {
    spawn: (...args: unknown[]) => {
      mockSpawn(...args);
      return {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: (event: string, callback: (...args: unknown[]) => void) => {
          if (event === "close") {
            setTimeout(() => callback(0), 10);
          }
        },
      };
    },
  };
  return { ...fns, default: fns };
});

vi.mock("fs", () => {
  const mockWrite = vi.fn();
  const mockEnd = vi.fn();
  const fns = {
    existsSync: (p: string) => !p.endsWith(".lock"),
    mkdirSync: () => {},
    createWriteStream: () => ({
      write: mockWrite,
      end: mockEnd,
    }),
    readFileSync: () => "{}",
    writeFileSync: () => {},
  };
  return { ...fns, default: fns };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: "/tmp/hermes-test-home",
  HERMES_PYTHON: "python",
  hermesCliArgs: () => [],
}));

vi.mock("../src/main/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/main/utils")>();
  return {
    ...actual,
    getActiveProfileNameSync: () => "test-profile",
    profileHome: (p: string) => mockProfileHome(p),
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
  listCronJobs: () => mockListCronJobs(),
}));

vi.mock("../src/main/self-healing", () => ({
  triggerSelfHealing: (...args: unknown[]) => mockTriggerSelfHealing(...args),
}));

vi.mock("../src/main/hermes-agent-updates", () => ({
  maybeRunHermesAgentUpdateRoutine: (
    now: Date,
    profile?: string,
  ): Promise<unknown> => mockMaybeRunHermesAgentUpdateRoutine(now, profile),
}));

vi.mock("../src/main/hermes-upstream-watch", () => ({
  maybeRunHermesUpstreamWatchRoutine: (
    now: Date,
    profile?: string,
  ): Promise<unknown> => mockMaybeRunHermesUpstreamWatchRoutine(now, profile),
}));

vi.mock("../src/main/config", () => ({
  readDesktopConfig: () => mockReadDesktopConfig(),
  writeDesktopConfig: (c: unknown) => mockWriteDesktopConfig(c),
}));

import {
  tickScheduler,
  getSchedulerConfig,
  setSchedulerConfig,
  captureScreenshot,
} from "../src/main/scheduler";

describe("Scheduler Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMaybeRunHermesAgentUpdateRoutine.mockResolvedValue(null);
    mockMaybeRunHermesUpstreamWatchRoutine.mockResolvedValue(null);
  });

  it("should get default scheduler config", () => {
    mockReadDesktopConfig.mockReturnValueOnce({});
    const config = getSchedulerConfig();
    expect(config.enabled).toBe(true);
    expect(config.tickIntervalMs).toBe(10000);
  });

  it("should save scheduler config to desktop.json", () => {
    mockReadDesktopConfig.mockReturnValueOnce({});
    setSchedulerConfig({ enabled: false, tickIntervalMs: 5000 });
    expect(mockWriteDesktopConfig).toHaveBeenCalledWith({
      schedulerEnabled: false,
      schedulerIntervalMs: 5000,
    });
  });

  it("should trigger due jobs when tickScheduler runs", async () => {
    const mockJobs = [
      {
        id: "upstream-watch-job-1",
        name: "Job 1",
        enabled: true,
        state: "idle",
        next_run_at: new Date(Date.now() - 5000).toISOString(), // 5s ago (due)
      },
      {
        id: "job-2",
        name: "Job 2",
        enabled: false, // disabled
        state: "idle",
        next_run_at: new Date(Date.now() - 5000).toISOString(),
      },
      {
        id: "job-3",
        name: "Job 3",
        enabled: true,
        state: "idle",
        next_run_at: new Date(Date.now() + 5000).toISOString(), // 5s in future (not due)
      },
    ];
    mockListCronJobs.mockResolvedValueOnce(mockJobs);

    await tickScheduler("test-profile");

    // job-1 should be triggered
    expect(mockSpawn).toHaveBeenCalled();
  });

  it("checks the managed Hermes Agent update routine on scheduler ticks", async () => {
    mockListCronJobs.mockResolvedValueOnce([]);

    await tickScheduler("test-profile");

    expect(mockMaybeRunHermesAgentUpdateRoutine).toHaveBeenCalledWith(
      expect.any(Date),
      "test-profile",
    );
  });

  it("checks upstream watch without blocking due cron jobs", async () => {
    mockMaybeRunHermesUpstreamWatchRoutine.mockImplementationOnce(
      () => new Promise(() => {}),
    );
    mockListCronJobs.mockResolvedValueOnce([
      {
        id: "job-1",
        name: "Job 1",
        enabled: true,
        state: "idle",
        next_run_at: new Date(Date.now() - 5000).toISOString(),
      },
    ]);

    await tickScheduler("test-profile");

    expect(mockMaybeRunHermesUpstreamWatchRoutine).toHaveBeenCalledWith(
      expect.any(Date),
      "test-profile",
    );
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
  });

  describe("captureScreenshot", () => {
    it("should capture screen and return PNG path", async () => {
      const path = await captureScreenshot("job-123", "test-profile");
      expect(path).toContain("routine-job-123-");
      expect(path).toContain("-error.png");
    });
  });
});
