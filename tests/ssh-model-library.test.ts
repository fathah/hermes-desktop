import { EventEmitter } from "events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PassThrough, Writable } from "stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { remoteFile, spawnSpy } = vi.hoisted(() => ({
  remoteFile: { content: "" },
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

import { sshAddModel } from "../src/main/ssh-remote";
import type { SshConfig } from "../src/main/ssh-tunnel";

let testDir: string;
let config: SshConfig;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "hermes-ssh-model-library-"));
  const keyPath = join(testDir, "id_test");
  mkdirSync(testDir, { recursive: true });
  writeFileSync(keyPath, "test-key");
  config = {
    host: "example.test",
    port: 22,
    username: "hermes",
    keyPath,
    remotePort: 8642,
    localPort: 18642,
  };
  remoteFile.content = "";
  spawnSpy.mockReset();
  spawnSpy.mockImplementation((_command: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: Writable;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();
    const remoteCommand = args.at(-1) ?? "";
    let stdin = "";
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        stdin += chunk.toString();
        callback();
      },
      final(callback) {
        queueMicrotask(() => {
          if (remoteCommand.includes('cat > "$file"')) {
            remoteFile.content = stdin;
          } else if (remoteCommand.includes('cat -- "$p"')) {
            child.stdout.write(remoteFile.content);
          }
          child.stdout.end();
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

describe("legacy SSH model library", () => {
  // @lat: [[provider-setup#Provider setup#Models live under each provider (OpenCode-style)#Transport-consistent attachment identity]]
  it("keeps the same custom model id on different endpoints", async () => {
    remoteFile.content = JSON.stringify([
      {
        id: "endpoint-a",
        name: "Endpoint A",
        provider: "custom",
        model: "shared-model",
        baseUrl: "https://a.example/v1",
        createdAt: 1,
      },
    ]);

    const added = await sshAddModel(
      config,
      "Endpoint B",
      "custom",
      "shared-model",
      "https://b.example/v1",
    );

    expect(added.baseUrl).toBe("https://b.example/v1");
    expect(JSON.parse(remoteFile.content)).toHaveLength(2);
  });

  it("deduplicates equivalent endpoint URLs", async () => {
    remoteFile.content = JSON.stringify([
      {
        id: "endpoint-a",
        name: "Endpoint A",
        provider: "custom",
        model: "shared-model",
        baseUrl: "HTTPS://A.EXAMPLE/v1/",
        createdAt: 1,
      },
    ]);

    const added = await sshAddModel(
      config,
      "Endpoint A duplicate",
      "custom",
      "shared-model",
      "https://a.example/v1",
    );

    expect(added.id).toBe("endpoint-a");
    expect(JSON.parse(remoteFile.content)).toHaveLength(1);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps endpoints whose URL paths differ only by case", async () => {
    remoteFile.content = JSON.stringify([
      {
        id: "tenant-a",
        name: "Tenant A",
        provider: "custom",
        model: "shared-model",
        baseUrl: "https://api.example/v1/TenantA",
        createdAt: 1,
      },
    ]);

    const added = await sshAddModel(
      config,
      "tenant a lowercase",
      "custom",
      "shared-model",
      "https://API.EXAMPLE/v1/tenanta",
    );

    expect(added.baseUrl).toBe("https://API.EXAMPLE/v1/tenanta");
    expect(JSON.parse(remoteFile.content)).toHaveLength(2);
  });
});
