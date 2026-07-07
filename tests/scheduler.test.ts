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
const mockMaybeRunDesktopUpdateRoutine = vi.fn();
const mockMaybeRunAppLaunchSchedules = vi.fn();
const mockEnsureOwnerCriticalCronJobs = vi.fn();
const mockEnsureOwnerMobileWorkspaceSkill = vi.fn();
const mockSpsIngestInbox = vi.fn();
const mockSpsLintWiki = vi.fn();
const mockCreateVaultProposal = vi.fn();
const mockListVaultProposals = vi.fn();

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

vi.mock("../src/main/desktop-update-routine", () => ({
  maybeRunDesktopUpdateRoutine: (now: Date): Promise<unknown> =>
    mockMaybeRunDesktopUpdateRoutine(now),
}));

vi.mock("../src/main/app-launcher", () => ({
  maybeRunAppLaunchSchedules: (now: Date, profile?: string): Promise<unknown> =>
    mockMaybeRunAppLaunchSchedules(now, profile),
}));

vi.mock("../src/main/owner-routines", () => ({
  ensureOwnerCriticalCronJobs: (profile?: string): Promise<unknown> =>
    mockEnsureOwnerCriticalCronJobs(profile),
}));

vi.mock("../src/main/mobile-workspace-skill", () => ({
  ensureOwnerMobileWorkspaceSkill: (profile?: string): unknown =>
    mockEnsureOwnerMobileWorkspaceSkill(profile),
}));

vi.mock("../src/main/sps-agent", () => ({
  spsIngestInbox: (profile?: string): Promise<unknown> =>
    mockSpsIngestInbox(profile),
  spsLintWiki: (
    profile?: string,
    opts?: { staleDays?: number },
  ): Promise<unknown> => mockSpsLintWiki(profile, opts),
}));

vi.mock("../src/main/vault-review-queue", () => ({
  createVaultProposal: (input: unknown, profile?: string): Promise<unknown> =>
    mockCreateVaultProposal(input, profile),
  listVaultProposals: (profile?: string): Promise<unknown> =>
    mockListVaultProposals(profile),
}));

vi.mock("../src/main/config", () => ({
  readDesktopConfig: () => mockReadDesktopConfig(),
  writeDesktopConfig: (c: unknown) => mockWriteDesktopConfig(c),
  getSpsAutomationPrefs: (profile?: string) => {
    const data = mockReadDesktopConfig();
    const map = (data as Record<string, unknown>).spsAutomationByProfile as
      | Record<string, unknown>
      | undefined;
    const prefs = map?.[profile || "test-profile"] as
      | Record<string, unknown>
      | undefined;
    return {
      autoApply: prefs?.autoApply === true,
      ingestIntervalMin:
        typeof prefs?.ingestIntervalMin === "number"
          ? prefs.ingestIntervalMin
          : 0,
      lintIntervalMin:
        typeof prefs?.lintIntervalMin === "number" ? prefs.lintIntervalMin : 0,
    };
  },
}));

// The nag engine is its own unit (see scheduler-nag.test.ts); stub it here so
// the scheduler tick test doesn't pull in note-index / better-sqlite3.
vi.mock("../src/main/nag-engine", () => ({
  nagTick: vi.fn(async () => {}),
}));

import {
  tickScheduler,
  getSchedulerConfig,
  setSchedulerConfig,
  captureScreenshot,
  __resetSpsAutomationSchedulerForTests,
} from "../src/main/scheduler";

describe("Scheduler Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetSpsAutomationSchedulerForTests();
    mockReadDesktopConfig.mockReturnValue({});
    mockListCronJobs.mockResolvedValue([]);
    mockMaybeRunHermesAgentUpdateRoutine.mockResolvedValue(null);
    mockMaybeRunHermesUpstreamWatchRoutine.mockResolvedValue(null);
    mockMaybeRunDesktopUpdateRoutine.mockResolvedValue(null);
    mockMaybeRunAppLaunchSchedules.mockResolvedValue([]);
    mockEnsureOwnerCriticalCronJobs.mockResolvedValue({
      created: [],
      existing: [],
      failed: [],
    });
    mockEnsureOwnerMobileWorkspaceSkill.mockReturnValue({
      created: false,
      existing: true,
      path: "/tmp/hermes-test-profile/skills/workspace/sps-workspace-mobile",
    });
    mockSpsIngestInbox.mockResolvedValue({
      ok: true,
      captureCount: 0,
      changeset: {
        summary: "Nothing to file",
        pages: [],
        captures: [],
        memory: [],
      },
    });
    mockSpsLintWiki.mockResolvedValue({
      ok: true,
      findings: [],
      mechanical: { orphans: [], brokenLinks: [], stale: [] },
      pagesScanned: 0,
      pagesDropped: 0,
    });
    mockCreateVaultProposal.mockResolvedValue({ id: "vp-1" });
    mockListVaultProposals.mockResolvedValue([]);
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

  it("checks the Desktop update routine on scheduler ticks", async () => {
    mockListCronJobs.mockResolvedValueOnce([]);

    await tickScheduler("test-profile");

    expect(mockMaybeRunDesktopUpdateRoutine).toHaveBeenCalledWith(
      expect.any(Date),
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

  it("checks app launch schedules on scheduler ticks", async () => {
    mockListCronJobs.mockResolvedValueOnce([]);

    await tickScheduler("test-profile");

    expect(mockMaybeRunAppLaunchSchedules).toHaveBeenCalledWith(
      expect.any(Date),
      "test-profile",
    );
  });

  it("bootstraps the owner mobile workspace skill on scheduler ticks", async () => {
    mockListCronJobs.mockResolvedValueOnce([]);

    await tickScheduler("test-profile");

    expect(mockEnsureOwnerMobileWorkspaceSkill).toHaveBeenCalledWith(
      "test-profile",
    );
  });

  it("runs scheduler-owned SPS ingest when enabled and due", async () => {
    mockReadDesktopConfig.mockReturnValue({
      spsAutomationByProfile: {
        "test-profile": {
          autoApply: true,
          ingestIntervalMin: 15,
          lintIntervalMin: 0,
        },
      },
    });
    mockSpsIngestInbox.mockResolvedValueOnce({
      ok: true,
      captureCount: 1,
      changeset: {
        summary: "Filed capture",
        pages: [
          {
            op: "create",
            pageId: "source-note",
            title: "Source Note",
            markdown: "# Source Note",
          },
        ],
        captures: [{ id: "cap-1", status: "processed" }],
        memory: ["Remember this"],
      },
    });

    await tickScheduler("test-profile");

    expect(mockSpsIngestInbox).toHaveBeenCalledWith("test-profile");
    await vi.waitFor(() => expect(mockCreateVaultProposal).toHaveBeenCalled());
    expect(mockCreateVaultProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "inbox",
        title: "Scheduled inbox ingest",
        summary: "Filed capture",
        operations: expect.arrayContaining([
          expect.objectContaining({
            kind: "upsert-page",
            pageId: "source-note",
          }),
          expect.objectContaining({
            kind: "mark-capture",
            captureId: "cap-1",
          }),
          expect.objectContaining({ kind: "add-memory" }),
        ]),
      }),
      "test-profile",
    );
  });

  it("does not run scheduled SPS ingest when interval or auto-apply is disabled", async () => {
    mockReadDesktopConfig.mockReturnValue({
      spsAutomationByProfile: {
        "test-profile": {
          autoApply: false,
          ingestIntervalMin: 15,
          lintIntervalMin: 0,
        },
      },
    });

    await tickScheduler("test-profile");

    expect(mockSpsIngestInbox).not.toHaveBeenCalled();

    mockReadDesktopConfig.mockReturnValue({
      spsAutomationByProfile: {
        "test-profile": {
          autoApply: true,
          ingestIntervalMin: 0,
          lintIntervalMin: 0,
        },
      },
    });

    await tickScheduler("test-profile");

    expect(mockSpsIngestInbox).not.toHaveBeenCalled();
  });

  it("throttles scheduled SPS ingest between ticks", async () => {
    mockReadDesktopConfig.mockReturnValue({
      spsAutomationByProfile: {
        "test-profile": {
          autoApply: true,
          ingestIntervalMin: 15,
          lintIntervalMin: 0,
        },
      },
    });

    await tickScheduler("test-profile");
    await tickScheduler("test-profile");

    expect(mockSpsIngestInbox).toHaveBeenCalledTimes(1);
  });

  it("skips scheduled SPS ingest when an inbox proposal is already pending", async () => {
    mockReadDesktopConfig.mockReturnValue({
      spsAutomationByProfile: {
        "test-profile": {
          autoApply: true,
          ingestIntervalMin: 15,
          lintIntervalMin: 0,
        },
      },
    });
    mockListVaultProposals.mockResolvedValueOnce([
      { id: "vp-existing", status: "pending", source: "inbox" },
    ]);

    await tickScheduler("test-profile");

    expect(mockSpsIngestInbox).not.toHaveBeenCalled();
    expect(mockCreateVaultProposal).not.toHaveBeenCalled();
  });

  it("prevents double-runs while scheduled SPS ingest is still active", async () => {
    __resetSpsAutomationSchedulerForTests();
    mockReadDesktopConfig.mockReturnValue({
      spsAutomationByProfile: {
        "test-profile": {
          autoApply: true,
          ingestIntervalMin: 0.001,
          lintIntervalMin: 0,
        },
      },
    });
    let resolveIngest:
      | ((value: {
          ok: boolean;
          captureCount: number;
          changeset: {
            summary: string;
            pages: unknown[];
            captures: unknown[];
            memory: unknown[];
          };
        }) => void)
      | null = null;
    const pending = new Promise<{
      ok: boolean;
      captureCount: number;
      changeset: {
        summary: string;
        pages: unknown[];
        captures: unknown[];
        memory: unknown[];
      };
    }>((resolve) => {
      resolveIngest = resolve;
    });
    mockSpsIngestInbox.mockReturnValue(pending);

    await tickScheduler("test-profile");
    await new Promise((resolve) => setTimeout(resolve, 80));
    await tickScheduler("test-profile");

    expect(mockSpsIngestInbox).toHaveBeenCalledTimes(1);
    resolveIngest?.({
      ok: true,
      captureCount: 0,
      changeset: {
        summary: "Nothing to file",
        pages: [],
        captures: [],
        memory: [],
      },
    });
    await pending;
  });

  it("runs scheduler-owned SPS lint and queues reviewable fixes", async () => {
    mockReadDesktopConfig.mockReturnValue({
      spsAutomationByProfile: {
        "test-profile": {
          autoApply: false,
          ingestIntervalMin: 0,
          lintIntervalMin: 60,
        },
      },
    });
    mockSpsLintWiki.mockResolvedValueOnce({
      ok: true,
      findings: [{ kind: "stale", page: "old.md", note: "Needs update" }],
      changeset: {
        summary: "Refresh stale note",
        pages: [
          {
            op: "update",
            pageId: "old",
            title: "Old",
            markdown: "# Old\n\nUpdated.",
          },
        ],
        captures: [],
        memory: [],
      },
      mechanical: { orphans: [], brokenLinks: [], stale: [] },
      pagesScanned: 1,
      pagesDropped: 0,
    });

    await tickScheduler("test-profile");

    expect(mockSpsLintWiki).toHaveBeenCalledWith("test-profile", {
      staleDays: 30,
    });
    await vi.waitFor(() => expect(mockCreateVaultProposal).toHaveBeenCalled());
    expect(mockCreateVaultProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "health",
        title: "Scheduled vault health fixes",
        summary: "Refresh stale note",
        operations: [
          expect.objectContaining({ kind: "upsert-page", pageId: "old" }),
        ],
      }),
      "test-profile",
    );
  });

  describe("captureScreenshot", () => {
    it("should capture screen and return PNG path", async () => {
      const path = await captureScreenshot("job-123", "test-profile");
      expect(path).toContain("routine-job-123-");
      expect(path).toContain("-error.png");
    });
  });
});
