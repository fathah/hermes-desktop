import { EventEmitter } from "events";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PassThrough, Writable } from "stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { remoteConfig, spawnSpy } = vi.hoisted(() => ({
  remoteConfig: { content: "" },
  spawnSpy: vi.fn(),
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    spawn: spawnSpy,
    default: { ...actual, spawn: spawnSpy },
  };
});

vi.mock("../src/main/locale", () => ({
  getAppLocale: () => "en",
}));

import { sshGetModelConfig } from "../src/main/ssh-remote";
import type { SshConfig } from "../src/main/ssh-tunnel";

let testDir: string;
let config: SshConfig;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "hermes-ssh-model-context-"));
  const keyPath = join(testDir, "id_test");
  writeFileSync(keyPath, "test-key");
  config = {
    host: "example.test",
    port: 22,
    username: "hermes",
    keyPath,
    remotePort: 8642,
    localPort: 18642,
  };
  remoteConfig.content = "";
  spawnSpy.mockReset();
  spawnSpy.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: Writable;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();
    child.stdin = new Writable({
      final(callback) {
        queueMicrotask(() => {
          child.stdout.end(remoteConfig.content);
          child.stderr.end();
          child.emit("close", 0);
        });
        callback();
      },
    });
    return child;
  });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("SSH active model context", () => {
  it("reads model.context_length from the selected remote profile", async () => {
    remoteConfig.content = [
      "model:",
      '  provider: "opencode-go"',
      '  default: "deepseek-v4-flash-vision-exp"',
      "  context_length: 1000000",
      "",
    ].join("\n");

    await expect(sshGetModelConfig(config, "work")).resolves.toEqual({
      provider: "opencode-go",
      model: "deepseek-v4-flash-vision-exp",
      baseUrl: "",
      contextLength: 1000000,
    });
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(String(spawnSpy.mock.calls[0]?.[1])).toContain(
      ".hermes/profiles/work/config.yaml",
    );
  });

  it("ignores a missing or invalid remote context length", async () => {
    remoteConfig.content = [
      "model:",
      '  provider: "opencode-go"',
      '  default: "deepseek-v4-flash-vision-exp"',
      '  context_length: "not-a-number"',
      "",
    ].join("\n");

    await expect(sshGetModelConfig(config)).resolves.toEqual({
      provider: "opencode-go",
      model: "deepseek-v4-flash-vision-exp",
      baseUrl: "",
    });
  });
});
