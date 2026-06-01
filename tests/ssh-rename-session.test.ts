import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/main/locale", () => ({
  getAppLocale: () => "en",
}));

// Capture what sshRenameSession hands to the spawned `ssh` process without
// actually opening a connection. The fake child echoes a clean exit so the
// underlying sshExec promise resolves; `exitCode` lets a test drive a failure.
const spawned = vi.hoisted(() => ({
  cmd: "",
  args: [] as string[],
  stdin: "",
  exitCode: 0,
}));

// Only `spawn` is overridden — the rest of child_process (execFileSync etc.)
// is used by modules transitively imported alongside ssh-remote, so spread the
// real module to keep those intact. The override is applied to both the named
// export and `default` because `import { spawn }` of a Node builtin can resolve
// through the CJS default interop.
function fakeSpawn(cmd: string, args: string[]): unknown {
  spawned.cmd = cmd;
  spawned.args = args;
  const handlers: Record<string, (arg?: unknown) => void> = {};
  return {
    stdout: { setEncoding: () => {}, on: () => {} },
    stderr: { setEncoding: () => {}, on: () => {} },
    stdin: {
      end: (data?: string) => {
        spawned.stdin = data ?? "";
        // Resolve once stdin is flushed, mirroring a process that runs and
        // exits with the configured code.
        process.nextTick(() => handlers["close"]?.(spawned.exitCode));
      },
    },
    on: (event: string, cb: (arg?: unknown) => void) => {
      handlers[event] = cb;
    },
    kill: () => {},
  };
}

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<
    Record<string, unknown> & { default?: object }
  >();
  return {
    ...actual,
    spawn: fakeSpawn,
    default: { ...(actual.default ?? actual), spawn: fakeSpawn },
  };
});

import { sshRenameSession } from "../src/main/ssh-remote";
import type { SshConfig } from "../src/main/ssh-tunnel";

const config: SshConfig = {
  host: "example.test",
  port: 22,
  username: "hermes",
  keyPath: "",
  remotePort: 8642,
  localPort: 18642,
};

beforeEach(() => {
  spawned.cmd = "";
  spawned.args = [];
  spawned.stdin = "";
  spawned.exitCode = 0;
});

describe("sshRenameSession", () => {
  it("runs a parameterized UPDATE of the title on the remote database", async () => {
    await sshRenameSession(config, "sess-1", "New title");

    // The remote command is a python3 invocation carrying the rename script.
    const command = spawned.args[spawned.args.length - 1] ?? "";
    expect(spawned.cmd).toBe("ssh");
    expect(command).toContain("python3 -c");
    expect(command).toContain("UPDATE sessions SET title = ?");

    // Params travel as JSON on stdin so the title/id are never interpolated
    // into the shell command (no injection, no quoting hazards).
    const payload = JSON.parse(spawned.stdin || "{}");
    expect(payload).toMatchObject({ sessionId: "sess-1", title: "New title" });
  });

  it("forwards a named profile in the payload", async () => {
    await sshRenameSession(config, "sess-2", "Renamed", "work");
    const payload = JSON.parse(spawned.stdin || "{}");
    expect(payload).toMatchObject({
      profile: "work",
      sessionId: "sess-2",
      title: "Renamed",
    });
  });

  it("is best-effort: a failing SSH process does not throw", async () => {
    spawned.exitCode = 1;
    await expect(
      sshRenameSession(config, "sess-3", "Whatever"),
    ).resolves.toBeUndefined();
  });
});
