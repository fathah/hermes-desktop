import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "path";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";

const TEST_DIR = join(
  tmpdir(),
  `hermes-test-desktop-update-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
);
const ORIGINAL_TZ = process.env.TZ;

async function freshConfig(
  home: string,
): Promise<typeof import("../src/main/config")> {
  vi.resetModules();
  process.env.HERMES_HOME = home;
  return await import("../src/main/config");
}

beforeEach(() => {
  process.env.TZ = "America/New_York";
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (ORIGINAL_TZ === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = ORIGINAL_TZ;
  }
  delete process.env.HERMES_HOME;
  vi.resetModules();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("Desktop update routine state", () => {
  it("defaults to a daily 4 AM local check with auto-download off", async () => {
    const { getDesktopUpdateRoutine } = await freshConfig(TEST_DIR);

    const state = getDesktopUpdateRoutine(new Date("2026-06-20T07:00:00.000Z"));

    expect(state.enabled).toBe(true);
    expect(state.autoDownload).toBe(false);
    expect(state.timezone).toBe("America/New_York");
    expect(state.schedule).toBe("0 4 * * *");
    expect(state.nextCheckAt).toBe("2026-06-20T08:00:00.000Z");
    expect(state.lastResult).toBeNull();
  });

  it("persists settings and the latest check result", async () => {
    const {
      getDesktopUpdateRoutine,
      setDesktopUpdateRoutine,
      recordDesktopUpdateRoutineResult,
    } = await freshConfig(TEST_DIR);

    setDesktopUpdateRoutine({ autoDownload: true });
    recordDesktopUpdateRoutineResult({
      checkedAt: "2026-06-20T23:05:00.000Z",
      status: "available",
      message: "Hermes Desktop update available.",
      phase: "check",
      reason: "update-available",
      version: "0.5.6",
      releaseNotes: "Adds Capture PDFs.",
    });

    const state = getDesktopUpdateRoutine(new Date("2026-06-20T23:10:00.000Z"));
    expect(state.autoDownload).toBe(true);
    expect(state.lastCheckedAt).toBe("2026-06-20T23:05:00.000Z");
    expect(state.lastResult?.status).toBe("available");
    expect(state.lastResult?.version).toBe("0.5.6");
    expect(state.nextCheckAt).toBe("2026-06-21T08:00:00.000Z");
  });

  it("decides due status by local calendar day", async () => {
    const { isDesktopUpdateRoutineDue } = await freshConfig(TEST_DIR);

    expect(
      isDesktopUpdateRoutineDue(
        { enabled: true, lastCheckedAt: null },
        new Date("2026-06-20T07:50:00.000Z"),
      ),
    ).toBe(false);
    expect(
      isDesktopUpdateRoutineDue(
        { enabled: true, lastCheckedAt: null },
        new Date("2026-06-20T08:05:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isDesktopUpdateRoutineDue(
        { enabled: true, lastCheckedAt: "2026-06-20T08:05:00.000Z" },
        new Date("2026-06-20T23:00:00.000Z"),
      ),
    ).toBe(false);
    expect(
      isDesktopUpdateRoutineDue(
        { enabled: true, lastCheckedAt: "2026-06-20T08:05:00.000Z" },
        new Date("2026-06-21T08:05:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isDesktopUpdateRoutineDue(
        { enabled: false, lastCheckedAt: null },
        new Date("2026-06-20T08:05:00.000Z"),
      ),
    ).toBe(false);
  });
});

describe("Desktop update check runner", () => {
  it("records an available update without downloading by default", async () => {
    process.env.HERMES_HOME = TEST_DIR;
    const { runDesktopUpdateCheck } =
      await import("../src/main/desktop-update-routine");
    const checkForUpdates = vi.fn().mockResolvedValue({
      updateInfo: { version: "0.5.6", releaseNotes: "Adds Capture PDFs." },
    });
    const downloadUpdate = vi.fn();

    const result = await runDesktopUpdateCheck({
      now: new Date("2026-06-20T08:05:00.000Z"),
      deps: {
        isPackaged: true,
        isPortable: false,
        platform: "darwin",
        checkForUpdates,
        downloadUpdate,
      },
    });

    expect(result.status).toBe("available");
    expect(result.version).toBe("0.5.6");
    expect(result.releaseNotes).toContain("Adds Capture PDFs.");
    expect(downloadUpdate).not.toHaveBeenCalled();
  });

  it("downloads when auto-download is enabled", async () => {
    process.env.HERMES_HOME = TEST_DIR;
    const { runDesktopUpdateCheck } =
      await import("../src/main/desktop-update-routine");
    const downloadUpdate = vi.fn().mockResolvedValue(undefined);

    const result = await runDesktopUpdateCheck({
      now: new Date("2026-06-20T08:05:00.000Z"),
      autoDownload: true,
      deps: {
        isPackaged: true,
        isPortable: false,
        platform: "darwin",
        checkForUpdates: vi.fn().mockResolvedValue({
          updateInfo: { version: "0.5.6", releaseNotes: "Adds Capture PDFs." },
        }),
        downloadUpdate,
      },
    });

    expect(result.status).toBe("downloaded");
    expect(result.phase).toBe("download");
    expect(downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("skips unsupported updater contexts", async () => {
    process.env.HERMES_HOME = TEST_DIR;
    const { runDesktopUpdateCheck } =
      await import("../src/main/desktop-update-routine");
    const checkForUpdates = vi.fn();

    const result = await runDesktopUpdateCheck({
      now: new Date("2026-06-20T08:05:00.000Z"),
      deps: {
        isPackaged: false,
        isPortable: false,
        platform: "darwin",
        checkForUpdates,
      },
    });

    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("dev-mode");
    expect(checkForUpdates).not.toHaveBeenCalled();
  });
});
