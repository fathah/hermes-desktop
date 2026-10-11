// @vitest-environment node
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("child_process")>()),
  spawn: spawnMock,
}));
import {
  sshEnsureApiServerKey,
  sshEnsureDashboardToken,
  sshSetEnvValue,
} from "../src/main/ssh-remote";
import type { SshConfig } from "../src/main/ssh-tunnel";

let directory: string;
let config: SshConfig;
let payloads: Record<string, unknown>[];
let failure = false;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "hermes-env-routing-"));
  const keyPath = join(directory, "key");
  writeFileSync(keyPath, "fixture");
  config = {
    host: "example.test",
    port: 22,
    username: "test",
    keyPath,
    remotePort: 8642,
    localPort: 18642,
  };
  payloads = [];
  failure = false;
  spawnMock.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
      stdin: {
        end: (input: string): void => {
          payloads.push(JSON.parse(input));
          queueMicrotask(() => {
            if (failure)
              child.stderr.write(
                "Could not safely update remote credentials: read failed",
              );
            else
              child.stdout.write(
                JSON.stringify({
                  values: {
                    HERMES_DASHBOARD_SESSION_TOKEN: "stored-dashboard-token",
                    API_SERVER_KEY: "stored-api-key",
                  },
                  changed: true,
                }),
              );
            child.emit("close", failure ? 1 : 0);
          });
        },
      },
    });
    return child;
  });
});
afterEach(() => {
  vi.clearAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

describe("SSH credential writer routing", () => {
  it("sends provider and port updates as stdin data through the shared transaction", async () => {
    const value = "secret-with-'quotes-and-$(literal)";
    await sshSetEnvValue(config, "PROVIDER_KEY", value, "research");
    await sshSetEnvValue(config, "HERMES_DESKTOP_DASHBOARD_PORT", "9119");
    expect(payloads).toEqual([
      {
        path: "~/.hermes/profiles/research/.env",
        operation: "set",
        key: "PROVIDER_KEY",
        value,
      },
      {
        path: "~/.hermes/.env",
        operation: "set",
        key: "HERMES_DESKTOP_DASHBOARD_PORT",
        value: "9119",
      },
    ]);
    for (const call of spawnMock.mock.calls) {
      const command = call[1].at(-1) as string;
      expect(command).toMatch(/^exec \/bin\/sh -c /);
      expect(command).toContain("python3 -c");
      expect(command).not.toContain(value);
    }
  });
  it("provisions API key plus enabled state in one transaction and returns the remote result", async () => {
    await expect(sshEnsureApiServerKey(config, "research")).resolves.toEqual({
      key: "stored-api-key",
      created: true,
    });
    expect(payloads).toEqual([
      { path: "~/.hermes/profiles/research/.env", operation: "ensure-api" },
    ]);
  });
  it("deduplicates simultaneous token requests and uses the remotely chosen token", async () => {
    const result = await Promise.all([
      sshEnsureDashboardToken(config),
      sshEnsureDashboardToken(config),
    ]);
    expect(result).toEqual([
      "stored-dashboard-token",
      "stored-dashboard-token",
    ]);
    expect(payloads).toEqual([
      { path: "~/.hermes/.env", operation: "ensure-dashboard" },
    ]);
  });
  it("propagates persistence failures instead of reporting a successful generated key", async () => {
    failure = true;
    await expect(sshEnsureDashboardToken(config)).rejects.toThrow(
      "read failed",
    );
    await expect(sshEnsureApiServerKey(config)).rejects.toThrow("read failed");
    await expect(sshSetEnvValue(config, "API_KEY", "value")).rejects.toThrow(
      "read failed",
    );
  });
});
