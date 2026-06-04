import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONFIG_HEALTH_UPDATED_EVENT,
  ConfigHealthBanner,
} from "./ConfigHealthBanner";

vi.mock("./useI18n", () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, number>) =>
      vars?.count !== undefined ? `${key}:${vars.count}` : key,
  }),
}));

function report(
  issues: Array<{ severity: "error" | "warning" | "info" }>,
  profile = "default",
): {
  ranAt: number;
  profile: string;
  issues: Array<{ severity: "error" | "warning" | "info" }>;
  summary: { errors: number; warnings: number; infos: number };
} {
  return {
    ranAt: Date.now(),
    profile,
    issues,
    summary: {
      errors: issues.filter((issue) => issue.severity === "error").length,
      warnings: issues.filter((issue) => issue.severity === "warning").length,
      infos: issues.filter((issue) => issue.severity === "info").length,
    },
  };
}

describe("ConfigHealthBanner", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getConfigHealth: vi
          .fn()
          .mockResolvedValue(report([{ severity: "warning" }])),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("hides when Settings publishes a clean config-health report", async () => {
    render(<ConfigHealthBanner profile="default" />);

    expect(await screen.findByTestId("config-health-banner")).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(CONFIG_HEALTH_UPDATED_EVENT, {
          detail: report([], "default"),
        }),
      );
    });

    expect(screen.queryByTestId("config-health-banner")).toBeNull();
  });

  it("ignores config-health updates for another profile", async () => {
    render(<ConfigHealthBanner profile="default" />);

    expect(await screen.findByTestId("config-health-banner")).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(CONFIG_HEALTH_UPDATED_EVENT, {
          detail: report([], "other-profile"),
        }),
      );
    });

    expect(screen.getByTestId("config-health-banner")).toBeTruthy();
  });
});
