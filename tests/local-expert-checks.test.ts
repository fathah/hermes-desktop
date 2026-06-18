import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";

const { TEST_HOME } = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const os = require("os");
  const path = require("path");
  const fs = require("fs");
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "local-expert-checks-test-")),
  );
  return { TEST_HOME: path.join(base, "hermes") };
});

vi.mock("../src/main/utils", async () => {
  const actual =
    await vi.importActual<typeof import("../src/main/utils")>(
      "../src/main/utils",
    );
  return {
    ...actual,
    profileHome: () => TEST_HOME,
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
  HERMES_REPO: join(TEST_HOME, "hermes-agent"),
  HERMES_PYTHON: "/usr/bin/python3",
  hermesCliArgs: (a: string[]) => a,
  getEnhancedPath: () => "",
}));

const execFileMock = vi.fn();

import {
  enableLocalExpertChecks,
  MACOS_LOCAL_EXPERT_CHECKS,
  runLocalExpertChecksWithExecFile,
} from "../src/main/local-experts/macos-checks";

beforeEach(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
  mkdirSync(TEST_HOME, { recursive: true });
  execFileMock.mockReset();
});

describe("local expert Mac checks", () => {
  it("defines only fixed read-only checks", () => {
    expect(MACOS_LOCAL_EXPERT_CHECKS.every((check) => check.readOnly)).toBe(
      true,
    );
    expect(
      MACOS_LOCAL_EXPERT_CHECKS.every((check) =>
        check.command.startsWith("/usr/"),
      ),
    ).toBe(true);
    expect(
      MACOS_LOCAL_EXPERT_CHECKS.some(
        (check) => check.id === "filevault-status",
      ),
    ).toBe(true);
  });

  it("requires explicit enablement before running checks", async () => {
    const result = await runLocalExpertChecksWithExecFile(
      "macos",
      execFileMock,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("not enabled");
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("records capability risk on enablement and runs timeout-bound checks", async () => {
    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      callback(null, { stdout: "enabled\n", stderr: "" });
    });

    const enabled = enableLocalExpertChecks("macos");
    const result = await runLocalExpertChecksWithExecFile(
      "macos",
      execFileMock,
    );

    expect(enabled.ok).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(MACOS_LOCAL_EXPERT_CHECKS.length);
    expect(execFileMock).toHaveBeenCalledWith(
      "/usr/bin/sw_vers",
      ["-productVersion"],
      expect.objectContaining({ shell: false, timeout: expect.any(Number) }),
      expect.any(Function),
    );

    const registry = JSON.parse(
      readFileSync(
        join(TEST_HOME, "sps-agent", "capability-risk-report.json"),
        "utf-8",
      ),
    );
    expect(registry.reports[0]).toMatchObject({
      kind: "local-expert-check",
      name: "Mac Expert read-only checks",
      status: "warning",
      reviewState: "unreviewed",
    });
  });
});
