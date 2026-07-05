import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const {
  TEST_HOME,
  execFileMock,
  openExternalMock,
  showOpenDialogMock,
  appendAuditLogMock,
  connectionModeRef,
} = vi.hoisted(() => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  return {
    TEST_HOME: fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "app-launcher-test-")),
    ),
    execFileMock: vi.fn(),
    openExternalMock: vi.fn(),
    showOpenDialogMock: vi.fn(),
    appendAuditLogMock: vi.fn(),
    connectionModeRef: { mode: "local" as "local" | "remote" | "ssh" },
  };
});

vi.mock("child_process", () => ({
  execFile: execFileMock,
  default: { execFile: execFileMock },
}));

vi.mock("electron", () => ({
  shell: {
    openExternal: openExternalMock,
  },
  dialog: {
    showOpenDialog: showOpenDialogMock,
  },
}));

vi.mock("../src/main/utils", () => ({
  profileHome: (profile?: string) => join(TEST_HOME, profile || "default"),
}));

vi.mock("../src/main/audit-log", () => ({
  appendAuditLog: appendAuditLogMock,
}));

vi.mock("../src/main/config", () => ({
  getConnectionConfig: () => ({ mode: connectionModeRef.mode }),
}));

import {
  addMacApplicationTarget,
  addUrlLaunchTarget,
  createAppLaunchSchedule,
  listAppLaunchSchedules,
  listAppLaunchTargets,
  maybeRunAppLaunchSchedules,
  pickMacApplicationTarget,
  runAppLaunchTarget,
} from "../src/main/app-launcher";

describe("app launcher main service", () => {
  beforeEach(() => {
    connectionModeRef.mode = "local";
    execFileMock.mockReset();
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: string[],
        _opts: unknown,
        callback: (err: Error | null) => void,
      ) => callback(null),
    );
    openExternalMock.mockReset();
    openExternalMock.mockResolvedValue(undefined);
    showOpenDialogMock.mockReset();
    showOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [] });
    appendAuditLogMock.mockReset();
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("launches a reviewed macOS app with /usr/bin/open and shell:false", async () => {
    const added = addMacApplicationTarget({
      label: "Slack",
      appPath: "/Applications/Slack.app",
      bundleId: "com.tinyspeck.slackmacgap",
    });
    expect(added.ok).toBe(true);
    const target = added.item!;

    const result = await runAppLaunchTarget(target.id);

    expect(result.ok).toBe(true);
    expect(execFileMock).toHaveBeenCalledWith(
      "/usr/bin/open",
      ["-b", "com.tinyspeck.slackmacgap"],
      expect.objectContaining({ shell: false }),
      expect.any(Function),
    );
    expect(openExternalMock).not.toHaveBeenCalled();
    expect(appendAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "app-launch.run.manual",
        command: "macos-app:Slack",
      }),
    );
  });

  it("adds macOS app targets only through the native picker", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });
    showOpenDialogMock.mockResolvedValueOnce({
      canceled: false,
      filePaths: ["/Applications/Calendar.app"],
    });

    const result = await pickMacApplicationTarget();

    expect(result.ok).toBe(true);
    expect(result.item?.label).toBe("Calendar");
    expect(result.item?.locator).toMatchObject({
      kind: "macos-app",
      appPath: "/Applications/Calendar.app",
    });
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("launches allowed URL targets through shell.openExternal", async () => {
    const added = addUrlLaunchTarget({
      label: "Status",
      url: "https://status.example.com/#details",
    });
    expect(added.ok).toBe(true);
    const target = added.item!;

    const result = await runAppLaunchTarget(target.id);

    expect(result.ok).toBe(true);
    expect(openExternalMock).toHaveBeenCalledWith("https://status.example.com/");
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("rejects unsafe URL targets before they can be launched", async () => {
    const added = addUrlLaunchTarget({
      label: "Slack deep link",
      url: "slack://open",
    });

    expect(added.ok).toBe(false);
    expect(listAppLaunchTargets()).toEqual([]);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(openExternalMock).not.toHaveBeenCalled();
  });

  it("refuses local launches in remote and SSH connection modes", async () => {
    const added = addUrlLaunchTarget({
      label: "Status",
      url: "https://status.example.com/",
    });
    connectionModeRef.mode = "remote";

    const result = await runAppLaunchTarget(added.item!.id);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/local mode/i);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(openExternalMock).not.toHaveBeenCalled();
  });

  it("runs enabled schedules once per local period", async () => {
    const added = addUrlLaunchTarget({
      label: "Dashboard",
      url: "https://example.com/dashboard",
    });
    const scheduled = createAppLaunchSchedule({
      label: "Morning dashboard",
      targetIds: [added.item!.id],
      cadence: "daily",
      hour: 9,
      runWhenClosed: false,
    });
    expect(scheduled.ok).toBe(true);

    await maybeRunAppLaunchSchedules(new Date(2026, 6, 5, 9, 0, 0));
    await maybeRunAppLaunchSchedules(new Date(2026, 6, 5, 9, 5, 0));

    expect(openExternalMock).toHaveBeenCalledTimes(1);
    const [schedule] = listAppLaunchSchedules();
    expect(schedule.lastRunAt).toBeGreaterThan(0);
    expect(schedule.lastStatus).toBe("ok");
  });

  it("marks missed launch windows as skipped instead of catching up", async () => {
    const added = addUrlLaunchTarget({
      label: "Dashboard",
      url: "https://example.com/dashboard",
    });
    const scheduled = createAppLaunchSchedule({
      label: "Morning dashboard",
      targetIds: [added.item!.id],
      cadence: "daily",
      hour: 9,
      runWhenClosed: false,
    });
    expect(scheduled.ok).toBe(true);

    await maybeRunAppLaunchSchedules(new Date(2026, 6, 5, 10, 0, 0));

    expect(openExternalMock).not.toHaveBeenCalled();
    const [schedule] = listAppLaunchSchedules();
    expect(schedule.lastStatus).toBe("skipped");
    expect(schedule.lastError).toContain("Scheduled hour passed");
  });

  it("persists failed launch status and error", async () => {
    execFileMock.mockImplementationOnce(
      (
        _file: string,
        _args: string[],
        _opts: unknown,
        callback: (err: Error | null) => void,
      ) => callback(new Error("open failed")),
    );
    const added = addMacApplicationTarget({
      label: "Broken",
      appPath: "/Applications/Broken.app",
    });

    const result = await runAppLaunchTarget(added.item!.id);

    expect(result.ok).toBe(false);
    const [target] = listAppLaunchTargets();
    expect(target.lastStatus).toBe("failed");
    expect(target.lastError).toContain("open failed");
  });
});
