// @vitest-environment node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";

const root = path.join(import.meta.dirname, "..");
const homes: string[] = [];
function fixture(): string {
  const home = fs.mkdtempSync(path.join(tmpdir(), "hermes-runner-failure-"));
  homes.push(home);
  return home;
}
afterEach(() => {
  for (const home of homes.splice(0))
    fs.rmSync(home, { recursive: true, force: true });
});

describe("acceptance runner failure evidence", () => {
  // @lat: [[compatibility-validation#Acceptance failure handling#Missing child executable]]
  it("writes a failed report for an actual missing Python executable", () => {
    const home = fixture();
    const temporary = path.join(home, "tmp");
    fs.mkdirSync(temporary);
    const output = path.join(home, "result.json");
    const result = spawnSync(
      process.execPath,
      [
        path.join(root, "scripts/verify-agent-compatibility.mjs"),
        `--agent-repo=${home}`,
        `--python=${path.join(home, "missing python")}`,
        `--output=${output}`,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          HOME: home,
          HERMES_HOME: home,
          TMPDIR: temporary,
        },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain("Unhandled 'error' event");
    const report = JSON.parse(fs.readFileSync(output, "utf8"));
    expect(report.passed).toBe(false);
    expect(report.error).toContain("ENOENT");
    expect(report.logs.startsWith(temporary + path.sep)).toBe(true);
  }, 15_000);

  // @lat: [[compatibility-validation#Acceptance failure handling#Existing children after startup failure]]
  it("terminates an already running child after a later spawn failure", async () => {
    const trial = fixture();
    const source = fs.readFileSync(
      path.join(root, "scripts/verify-agent-compatibility.mjs"),
      "utf8",
    );
    // Execute the runner's real process helpers and finally-body against native
    // processes; this needs neither Agent dependencies nor an SSH account.
    const helpers = source.slice(
      source.indexOf("async function until("),
      source.indexOf("async function reachable("),
    );
    const cleanupStart = source.indexOf(
      "  for (const proc of children.reverse())",
    );
    const cleanup = source.slice(
      cleanupStart,
      source.indexOf("\n}", cleanupStart),
    );
    expect(helpers).toContain("function child(");
    expect(cleanup).toContain('proc.kill("SIGTERM")');
    const children: ReturnType<typeof spawn>[] = [];
    const context = vm.createContext({
      fs,
      path,
      trial,
      children,
      spawn,
      env: process.env,
      delay,
    });
    const runner = vm.runInContext(`${helpers}; ({ child, until });`, context);
    const running = runner.child(process.execPath, [
      "-e",
      "setInterval(() => {}, 1000)",
    ]);
    const exited = once(running, "exit");
    await once(running, "spawn");
    try {
      const missing = runner.child(path.join(trial, "absent-sshd"), []);
      // Keep a regression from terminating Vitest itself; the runner's handler
      // must still capture and surface this actual ENOENT through its wait.
      missing.once("error", () => {});
      await expect(
        runner.until(() => false, "sshd startup", 1000),
      ).rejects.toThrow("ENOENT");
    } finally {
      await vm.runInContext(`(async () => { ${cleanup} })()`, context);
      await exited;
    }
    expect(running.exitCode !== null || running.signalCode !== null).toBe(true);
  });

  // @lat: [[compatibility-validation#Acceptance failure handling#Caught renderer console errors]]
  it("rejects a caught console error at the actual packaged completion gate", () => {
    const source = fs.readFileSync(
      path.join(root, "scripts/verify-packaged-app.mjs"),
      "utf8",
    );
    const start = source.indexOf("  assert.deepEqual(pageErrors, []");
    const gate = source.slice(start, source.indexOf("\n}\n\ntry {", start));
    expect(gate).toContain("Main-process fatal error occurred");
    const check = (consoleErrors: string[]): void => {
      vm.runInNewContext(
        `const pageErrors = []; const consoleErrors = ${JSON.stringify(consoleErrors)}; ${gate}`,
        {
          assert,
          mainLog: "",
          report: { checks: [] },
        },
      );
    };
    expect(() => check([])).not.toThrow();
    expect(() => check(["caught renderer failure"])).toThrow(
      "Renderer console errors occurred",
    );
  });
});
