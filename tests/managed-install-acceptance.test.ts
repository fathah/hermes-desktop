// @vitest-environment node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import vm from "node:vm";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const script = join(root, "scripts/verify-managed-install.mjs");

describe("actual managed installer acceptance boundary", () => {
  // @lat: [[native-release-acceptance#Managed Agent provisioning#Managed installation requires CI]]
  it("refuses non-CI execution before creating an installation", () => {
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_ACTIONS: "false", CI: "false" },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "restricted to disposable GitHub Actions runners",
    );
  });

  // @lat: [[native-release-acceptance#Managed Agent provisioning#Managed installation stays in a fresh owned tree]]
  it.each([
    "outside-root",
    ...(process.platform === "win32" ? [] : ["symlink-root"]),
    "outside-report",
    "populated-root",
  ])("refuses %s without invoking the installer", (scenario) => {
    const runner = mkdtempSync(join(tmpdir(), "hermes-managed-boundary-"));
    const outside = mkdtempSync(join(tmpdir(), "hermes-managed-outside-"));
    try {
      let owned = join(runner, "install");
      let output = join(owned, "result.json");
      let expected = "owned-root must remain inside its owned root";
      if (scenario === "outside-root") owned = outside;
      if (scenario === "symlink-root") symlinkSync(outside, owned, "dir");
      if (scenario === "outside-report") {
        output = join(outside, "result.json");
        expected = "output must remain inside its owned root";
      }
      if (scenario === "populated-root") {
        mkdirSync(owned);
        writeFileSync(join(owned, "existing.txt"), "existing state");
        expected = "Fresh managed installation requires an empty owned root";
      }
      const result = spawnSync(
        process.execPath,
        [script, `--owned-root=${owned}`, `--output=${output}`],
        {
          encoding: "utf8",
          timeout: 10000,
          env: {
            ...process.env,
            GITHUB_ACTIONS: "true",
            CI: "true",
            RUNNER_TEMP: runner,
            // A broken guard must still never reach a network installer in this test.
            PATH: "",
          },
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(expected);
      expect(readdirSync(outside)).toEqual([]);
      expect(existsSync(output)).toBe(false);
      if (scenario === "populated-root") {
        expect(readdirSync(owned)).toEqual(["existing.txt"]);
        expect(readFileSync(join(owned, "existing.txt"), "utf8")).toBe(
          "existing state",
        );
      }
    } finally {
      rmSync(runner, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

// @lat: [[native-release-acceptance#Managed Agent provisioning#Timed-out installer descendants are stopped]]
it.skipIf(process.platform === "win32")(
  "awaits termination of a descendant that ignores SIGTERM after its parent exits",
  async () => {
    const trial = mkdtempSync(join(tmpdir(), "hermes-managed-timeout-"));
    const parentPidFile = join(trial, "parent.pid");
    const childPidFile = join(trial, "child.pid");
    const parent = join(trial, "parent.cjs");
    writeFileSync(
      parent,
      `const {spawn} = require('node:child_process');
const fs = require('node:fs');
fs.writeFileSync(process.argv[2], String(process.pid));
process.on('SIGTERM', () => process.exit(0));
spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)", process.argv[3]], {stdio:'ignore'});
setInterval(() => {}, 1000);
`,
    );
    const source = readFileSync(script, "utf8");
    const helpers = source.slice(
      source.indexOf("function installerGroupAlive("),
      source.indexOf("function execute("),
    );
    const report: {
      installer?: { timedOut: boolean };
      installerCleanup?: {
        processGroup: number;
        stopped: boolean;
        forced: boolean;
      };
      installerCleanupError?: string;
    } = {};
    const context = vm.createContext({
      assert,
      fs: { openSync, closeSync },
      spawn,
      spawnSync,
      process,
      delay,
      setTimeout,
      clearTimeout,
      env: process.env,
      home: trial,
      logPath: join(trial, "installer.log"),
      report,
    });
    let pending: Promise<{ error?: Error }> | undefined;
    try {
      const runner = vm.runInContext(`${helpers}; ({ install });`, context);
      pending = runner
        .install(process.execPath, [parent, parentPidFile, childPidFile], 2000)
        .then(
          () => ({}),
          (error: Error) => ({ error }),
        );
      const deadline = Date.now() + 1800;
      while (!existsSync(childPidFile) && Date.now() < deadline)
        await delay(20);
      expect(existsSync(childPidFile)).toBe(true);
      const child = Number(readFileSync(childPidFile, "utf8"));
      expect(() => process.kill(child, 0)).not.toThrow();
      const result = await pending;
      expect(result.error?.message).toContain("25 minute deadline");
      expect(report.installer?.timedOut).toBe(true);
      expect(report.installerCleanupError).toBeUndefined();
      expect(report.installerCleanup?.forced).toBe(true);
      expect(report.installerCleanup?.stopped).toBe(true);
      expect(() =>
        process.kill(-report.installerCleanup!.processGroup, 0),
      ).toThrow();
      expect(() => process.kill(child, 0)).toThrow();
    } finally {
      for (const file of [parentPidFile, childPidFile]) {
        if (!existsSync(file)) continue;
        const pid = Number(readFileSync(file, "utf8"));
        try {
          process.kill(file === parentPidFile ? -pid : pid, "SIGKILL");
        } catch {
          /* Already stopped. */
        }
      }
      await pending;
      rmSync(trial, { recursive: true, force: true });
    }
  },
  15000,
);

// @lat: [[native-release-acceptance#Managed Agent provisioning#Managed CI requires production provisioning]]
it("requires actual managed provisioning and evidence on native Windows and Linux", () => {
  const workflow = load(
    readFileSync(
      join(root, ".github/workflows/native-release-acceptance.yml"),
      "utf8",
    ),
  ) as {
    permissions: Record<string, string>;
    jobs: {
      managed_agent: {
        needs: string;
        "timeout-minutes": number;
        strategy: { matrix: { include: Array<{ runner: string }> } };
        steps: Array<{
          name?: string;
          uses?: string;
          if?: string;
          run?: string;
          with?: Record<string, string>;
        }>;
      };
    };
  };
  expect(workflow.permissions).toEqual({ contents: "read", actions: "read" });
  const job = workflow.jobs.managed_agent;
  expect(job.needs).toBe("validate");
  expect(job["timeout-minutes"]).toBe(35);
  expect(job.strategy.matrix.include.map(({ runner }) => runner)).toEqual([
    "windows-2025",
    "ubuntu-24.04",
  ]);
  expect(
    job.steps.find(({ uses }) => uses === "actions/checkout@v4")?.with?.ref,
  ).toBe("${{ github.sha }}");
  const execution = job.steps.find(({ run }) =>
    run?.includes("scripts/verify-managed-install.mjs"),
  )?.run;
  expect(execution).toContain('--owned-root="$RUNNER_TEMP/managed-agent"');
  expect(execution).toContain(
    '--output="$RUNNER_TEMP/managed-agent/result.json"',
  );
  const evidence = job.steps.find(
    ({ uses }) => uses === "actions/upload-artifact@v4",
  );
  expect(evidence?.if).toBe("always()");
  expect(evidence?.with?.path).toContain("/managed-agent/result.json");
  expect(evidence?.with?.path).toContain("/managed-agent/installer.log");
});
