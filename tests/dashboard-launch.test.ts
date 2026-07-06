import { describe, expect, it } from "vitest";
import { buildLocalDashboardCliArgs } from "../src/main/dashboard-launch";

describe("local dashboard launch args", () => {
  it("matches the current upstream desktop dashboard command shape", () => {
    expect(buildLocalDashboardCliArgs(undefined, 9123)).toEqual([
      "dashboard",
      "--isolated",
      "--no-open",
      "--host",
      "127.0.0.1",
      "--port",
      "9123",
    ]);
  });

  it("preserves profile and prebuilt web-dist support without the legacy --tui flag", () => {
    const args = buildLocalDashboardCliArgs("work", 9123, { skipBuild: true });

    expect(args).toEqual([
      "--profile",
      "work",
      "dashboard",
      "--isolated",
      "--no-open",
      "--host",
      "127.0.0.1",
      "--port",
      "9123",
      "--skip-build",
    ]);
    expect(args).not.toContain("--tui");
  });
});
