// @vitest-environment node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.join(import.meta.dirname, "../scripts/verify-packaged-app.mjs"),
  "utf8",
);
const helpers = source.slice(
  source.indexOf("async function bounded("),
  source.indexOf("async function screenshot("),
);
function runner(report: Record<string, unknown> = { passed: true }): {
  bounded: (
    promise: Promise<unknown>,
    timeout: number,
    label: string,
  ) => Promise<unknown>;
  stopOwnedProcesses: (
    children: unknown[],
    timeout: number,
  ) => Promise<Array<{ exited: boolean }>>;
  validateBackendProbe: (
    probe: {
      route: string;
      credential: string;
      status: number;
      contentType: string;
    },
    body: string,
  ) => void;
  recordCleanupFailure: (error: Error) => void;
} {
  return vm.runInNewContext(
    `${helpers}; ({ bounded, stopOwnedProcesses, validateBackendProbe, recordCleanupFailure })`,
    {
      assert,
      delay,
      setTimeout,
      clearTimeout,
      report,
      trial: "/owned/trial",
      safeText: String,
    },
  );
}

describe("packaged SSH acceptance gates", () => {
  // @lat: [[compatibility-validation#Acceptance failure handling#Fresh protected backend probes]]
  it("requires the fresh-store status and complete authenticated JSON before UI connection", () => {
    const { validateBackendProbe } = runner();
    const probe = {
      route: "/api/sessions?limit=1",
      credential: "fixture",
      status: 503,
      contentType: "application/json",
    };
    expect(() =>
      validateBackendProbe(probe, '{"error":"not initialized"}'),
    ).not.toThrow();
    expect(() =>
      validateBackendProbe({ ...probe, status: 200 }, "{}"),
    ).toThrow();
    expect(() => validateBackendProbe(probe, "<html>error</html>")).toThrow();
    expect(() => validateBackendProbe(probe, '{"partial":')).toThrow();
    expect(() =>
      validateBackendProbe(
        { ...probe, route: "/api/profiles", status: 200 },
        '{"profiles":[]}',
      ),
    ).not.toThrow();
    expect(() =>
      validateBackendProbe(
        {
          ...probe,
          route: "/api/profiles",
          credential: "invalid",
          status: 401,
        },
        "{}",
      ),
    ).not.toThrow();
    expect(() =>
      validateBackendProbe(
        {
          ...probe,
          route: "/api/profiles",
          credential: "invalid",
          status: 200,
        },
        "{}",
      ),
    ).toThrow();
  });

  // @lat: [[compatibility-validation#Acceptance failure handling#Bounded owned process cleanup]]
  it("bounds a hung close and waits for an actual owned child to exit after signals", async () => {
    const { bounded, stopOwnedProcesses } = runner();
    await expect(
      bounded(new Promise(() => {}), 10, "hung close"),
    ).rejects.toThrow("Timed out: hung close");
    const child = spawn(
      process.execPath,
      [
        "-e",
        "process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)",
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    try {
      await once(child.stdout!, "data");
      const [result] = await stopOwnedProcesses([child], 100);
      expect(result.exited).toBe(true);
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }
  });

  // @lat: [[compatibility-validation#Acceptance failure handling#Cleanup failure evidence]]
  it("fails surviving cleanup without replacing an original test failure", async () => {
    const report: Record<string, unknown> = { passed: true };
    const api = runner(report);
    const [survivor] = await api.stopOwnedProcesses(
      [{ pid: 123, exitCode: null, signalCode: null, kill: () => true }],
      1,
    );
    expect(survivor.exited).toBe(false);
    api.recordCleanupFailure(new Error("owned process survived"));
    expect(report.passed).toBe(false);
    expect(report.stage).toBe("fixture cleanup");
    const failed: Record<string, unknown> = {
      passed: false,
      stage: "clarify",
      error: "original failure",
    };
    runner(failed).recordCleanupFailure(new Error("cleanup also failed"));
    expect(failed.error).toBe("original failure");
    expect(failed.stage).toBe("clarify");
    expect(failed.cleanupErrors).toHaveLength(1);
  });
});
