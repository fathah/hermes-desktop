import { describe, expect, it } from "vitest";
import {
  appLaunchCadenceLabel,
  isAppLaunchScheduleDue,
  validateLaunchScheduleInput,
  validateLaunchTargetInput,
  type AppLaunchSchedule,
  type AppLaunchTarget,
} from "./app-launcher";

const now = new Date(2026, 6, 5, 9, 0, 0);

function target(patch: Partial<AppLaunchTarget> = {}): AppLaunchTarget {
  return {
    id: "target-1",
    label: "Slack",
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    locator: { kind: "macos-app", appPath: "/Applications/Slack.app" },
    ...patch,
  };
}

function schedule(patch: Partial<AppLaunchSchedule> = {}): AppLaunchSchedule {
  return {
    id: "schedule-1",
    label: "Morning apps",
    targetIds: ["target-1"],
    cadence: "daily",
    hour: 9,
    enabled: true,
    runWhenClosed: false,
    createdAt: 1,
    updatedAt: 1,
    lastRunAt: 0,
    ...patch,
  };
}

describe("validateLaunchTargetInput", () => {
  it("accepts user-selected macOS apps and http(s) URLs", () => {
    expect(
      validateLaunchTargetInput({
        label: "Slack",
        locator: { kind: "macos-app", appPath: "/Applications/Slack.app" },
      }),
    ).toBeNull();
    expect(
      validateLaunchTargetInput({
        label: "Status page",
        locator: { kind: "url", url: "https://status.example.com" },
      }),
    ).toBeNull();
  });

  it("rejects missing labels, non-app paths, and non-http URL schemes", () => {
    expect(
      validateLaunchTargetInput({
        label: "",
        locator: { kind: "url", url: "https://example.com" },
      }),
    ).toMatch(/label/i);
    expect(
      validateLaunchTargetInput({
        label: "Slack",
        locator: { kind: "macos-app", appPath: "/Applications/Slack" },
      }),
    ).toMatch(/\.app/i);
    expect(
      validateLaunchTargetInput({
        label: "Slack deep link",
        locator: { kind: "url", url: "slack://open" },
      }),
    ).toMatch(/http/i);
  });
});

describe("validateLaunchScheduleInput", () => {
  it("requires at least one existing enabled target", () => {
    expect(
      validateLaunchScheduleInput(
        { label: "Morning", targetIds: [], cadence: "daily", hour: 9 },
        [target()],
      ),
    ).toMatch(/target/i);
    expect(
      validateLaunchScheduleInput(
        {
          label: "Morning",
          targetIds: ["missing"],
          cadence: "daily",
          hour: 9,
        },
        [target()],
      ),
    ).toMatch(/target/i);
    expect(
      validateLaunchScheduleInput(
        {
          label: "Morning",
          targetIds: ["target-1"],
          cadence: "daily",
          hour: 9,
        },
        [target({ enabled: false })],
      ),
    ).toMatch(/enabled/i);
  });
});

describe("isAppLaunchScheduleDue", () => {
  it("fires once per local period after the configured hour", () => {
    expect(isAppLaunchScheduleDue(schedule(), now)).toBe(true);
    expect(
      isAppLaunchScheduleDue(schedule(), new Date(2026, 6, 5, 8, 59, 0)),
    ).toBe(false);
    expect(
      isAppLaunchScheduleDue(schedule(), new Date(2026, 6, 5, 10, 0, 0)),
    ).toBe(false);
    expect(
      isAppLaunchScheduleDue(
        schedule({ lastRunAt: new Date(2026, 6, 5, 9, 1, 0).getTime() }),
        now,
      ),
    ).toBe(false);
    expect(
      isAppLaunchScheduleDue(
        schedule({ lastRunAt: new Date(2026, 6, 4, 9, 1, 0).getTime() }),
        now,
      ),
    ).toBe(true);
  });

  it("honors weekly, monthly, and disabled schedules", () => {
    expect(isAppLaunchScheduleDue(schedule({ enabled: false }), now)).toBe(
      false,
    );
    expect(isAppLaunchScheduleDue(schedule({ cadence: "weekly" }), now)).toBe(
      false,
    );
    expect(
      isAppLaunchScheduleDue(
        schedule({
          cadence: "monthly",
          lastRunAt: new Date(2026, 6, 1, 9, 0, 0).getTime(),
        }),
        now,
      ),
    ).toBe(false);
    expect(
      isAppLaunchScheduleDue(
        schedule({ cadence: "weekly", lastRunAt: 0 }),
        new Date(2026, 6, 6, 9, 0, 0),
      ),
    ).toBe(true);
    expect(
      isAppLaunchScheduleDue(
        schedule({ cadence: "monthly", lastRunAt: 0 }),
        new Date(2026, 6, 1, 9, 0, 0),
      ),
    ).toBe(true);
  });
});

describe("appLaunchCadenceLabel", () => {
  it("formats schedule cadence labels", () => {
    expect(appLaunchCadenceLabel("daily", 8)).toBe("Daily · 08:00");
    expect(appLaunchCadenceLabel("weekly", 9)).toBe("Weekly · Mon 09:00");
    expect(appLaunchCadenceLabel("monthly", 6)).toBe("Monthly · 1st 06:00");
  });
});
