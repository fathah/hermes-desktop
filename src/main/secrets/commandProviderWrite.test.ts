import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// Mock config so the write helpers read deterministic commands.
const configValues: Record<string, string> = {};
vi.mock("../config", () => ({
  getConfigValue: (key: string) => configValues[key] ?? "",
}));

// Mock `spawn` so we can assert HOW the helper is invoked (the value must
// arrive on stdin, never in argv or the command string). The real code uses
// spawn("/bin/sh", ["-c", command], { env, stdio }) and writes the value to
// child.stdin, so the fake child captures stdin writes and lets each test drive
// the exit code/signal.
interface SpawnCall {
  file: string;
  args: string[];
  opts: { env?: Record<string, string> };
  stdinData: string;
  stdinEnded: boolean;
}
const spawnCalls: SpawnCall[] = [];
// How the current test wants the spawned child to terminate.
let exitPlan: { code: number | null; signal: NodeJS.Signals | null } = {
  code: 0,
  signal: null,
};
// If true, emit "error" (helper-not-found) instead of a normal close.
let emitSpawnError = false;

vi.mock("child_process", () => {
  const spawn = (
    file: string,
    args: string[],
    opts: { env?: Record<string, string> },
  ): EventEmitter => {
    const rec: SpawnCall = {
      file,
      args,
      opts,
      stdinData: "",
      stdinEnded: false,
    };
    spawnCalls.push(rec);

    const child = new EventEmitter() as EventEmitter & {
      stdin: EventEmitter & {
        write: (d: string) => void;
        end: () => void;
      };
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: (sig?: NodeJS.Signals) => void;
    };
    const stdin = new EventEmitter() as EventEmitter & {
      write: (d: string) => void;
      end: () => void;
    };
    stdin.write = (d: string) => {
      rec.stdinData += d;
    };
    stdin.end = () => {
      rec.stdinEnded = true;
      // Drive termination on the next tick, after the caller wired listeners.
      setImmediate(() => {
        if (emitSpawnError) {
          child.emit("error", new Error("spawn ENOENT"));
        } else {
          child.emit("close", exitPlan.code, exitPlan.signal);
        }
      });
    };
    child.stdin = stdin;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    return child;
  };
  return { spawn, default: { spawn } };
});

import {
  commandWriteSecret,
  commandDeleteSecret,
  hasWriteHelper,
  hasDeleteHelper,
} from "./commandProviderWrite";

beforeEach(() => {
  for (const k of Object.keys(configValues)) delete configValues[k];
  spawnCalls.length = 0;
  exitPlan = { code: 0, signal: null };
  emitSpawnError = false;
});
afterEach(() => vi.restoreAllMocks());

describe("commandProviderWrite — security invariants", () => {
  it("write feeds the VALUE on stdin, never in argv or the command string", async () => {
    configValues["secrets.command_write"] =
      'keepassxc-cli add -p ~/v.kdbx "$HERMES_SECRET_KEY"';
    const SECRET = "sk-super-secret-value-1234";
    const r = await commandWriteSecret("OPENROUTER_API_KEY", SECRET);
    expect(r.ok).toBe(true);
    const call = spawnCalls[0];
    // value is on stdin, NOT in argv, NOT in the command string.
    expect(call.stdinData).toBe(SECRET);
    expect(call.stdinEnded).toBe(true);
    expect(JSON.stringify(call.args)).not.toContain(SECRET);
    expect(call.file).toBe("/bin/sh");
    // key NAME travels as inert env data, never interpolated into the command.
    expect(call.opts.env?.HERMES_SECRET_KEY).toBe("OPENROUTER_API_KEY");
    expect(JSON.stringify(call.args)).not.toContain("OPENROUTER_API_KEY");
  });

  it("a hostile key NAME is REJECTED before exec (no injection, no \\n in logs)", async () => {
    configValues["secrets.command_write"] = "writer";
    const evil = '"; rm -rf ~; echo "';
    const r = await commandWriteSecret(evil, "v");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("bad-key");
    expect(spawnCalls).toHaveLength(0);
    // a newline-bearing name (dotenv-injection / log-injection vector) is rejected too
    const r2 = await commandWriteSecret("X\nOPENROUTER_API_KEY=attacker", "v");
    expect(r2.ok).toBe(false);
    expect(r2.error).toBe("bad-key");
    expect(spawnCalls).toHaveLength(0);
  });

  it("delete passes the key NAME via env and writes NO value on stdin", async () => {
    configValues["secrets.command_delete"] = "deleter";
    const r = await commandDeleteSecret("OLD_KEY");
    expect(r.ok).toBe(true);
    const call = spawnCalls[0];
    expect(call.opts.env?.HERMES_SECRET_KEY).toBe("OLD_KEY");
    // delete writes nothing to stdin (just closes it).
    expect(call.stdinData).toBe("");
    expect(call.stdinEnded).toBe(true);
  });

  it("a failed write returns a coarse, secret-free error", async () => {
    configValues["secrets.command_write"] = "writer";
    exitPlan = { code: 1, signal: null };
    const r = await commandWriteSecret("K", "sk-leak");
    expect(r.ok).toBe(false);
    // error reason must NOT echo the value or raw message.
    expect(r.error).toBe("exit-1");
    expect(JSON.stringify(r)).not.toContain("sk-leak");
  });

  it("a timeout (SIGTERM) is reported as a coarse 'timeout' reason", async () => {
    configValues["secrets.command_write"] = "writer";
    exitPlan = { code: null, signal: "SIGTERM" };
    const r = await commandWriteSecret("K", "v");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("timeout");
  });

  it("a missing helper binary surfaces as helper-not-found", async () => {
    configValues["secrets.command_write"] = "writer";
    emitSpawnError = true;
    const r = await commandWriteSecret("K", "v");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("helper-not-found");
  });

  it("no write helper configured → write refuses (read-only by default)", async () => {
    const r = await commandWriteSecret("K", "v");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("no-write-helper");
    expect(spawnCalls).toHaveLength(0);
  });

  it("no delete helper configured → delete refuses", async () => {
    const r = await commandDeleteSecret("K");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("no-delete-helper");
    expect(spawnCalls).toHaveLength(0);
  });

  it("capability probes reflect whether helpers are configured", () => {
    expect(hasWriteHelper()).toBe(false);
    expect(hasDeleteHelper()).toBe(false);
    configValues["secrets.command_write"] = "w";
    configValues["secrets.command_delete"] = "d";
    expect(hasWriteHelper()).toBe(true);
    expect(hasDeleteHelper()).toBe(true);
  });

  it("a malformed key (whitespace / non-identifier) is rejected before any exec", async () => {
    configValues["secrets.command_write"] = "writer";
    expect((await commandWriteSecret("   ", "v")).error).toBe("bad-key");
    expect((await commandWriteSecret("has space", "v")).error).toBe("bad-key");
    expect((await commandWriteSecret("1leading-digit", "v")).error).toBe(
      "bad-key",
    );
    expect(spawnCalls).toHaveLength(0);
  });
});
