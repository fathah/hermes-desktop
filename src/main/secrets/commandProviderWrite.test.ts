import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock config so the write helpers read deterministic commands.
const configValues: Record<string, string> = {};
vi.mock("../config", () => ({
  getConfigValue: (key: string) => configValues[key] ?? "",
}));

// Spy on execFileSync so we can assert HOW the helper is invoked (the value
// must arrive on stdin, never in argv or the command string).
const execCalls: Array<{
  file: string;
  args: string[];
  opts: { env?: Record<string, string>; input?: string };
}> = [];
let execImpl: () => string = () => "";
vi.mock("child_process", () => {
  const execFileSync = (file: string, args: string[], opts: never): string => {
    execCalls.push({ file, args, opts });
    return execImpl();
  };
  return { execFileSync, default: { execFileSync } };
});

import {
  commandWriteSecret,
  commandDeleteSecret,
  hasWriteHelper,
  hasDeleteHelper,
} from "./commandProviderWrite";

beforeEach(() => {
  for (const k of Object.keys(configValues)) delete configValues[k];
  execCalls.length = 0;
  execImpl = () => "";
});
afterEach(() => vi.restoreAllMocks());

describe("commandProviderWrite — security invariants", () => {
  it("write feeds the VALUE on stdin, never in argv or the command string", () => {
    configValues["secrets.command_write"] =
      'keepassxc-cli add -p ~/v.kdbx "$HERMES_SECRET_KEY"';
    const SECRET = "sk-super-secret-value-1234";
    const r = commandWriteSecret("OPENROUTER_API_KEY", SECRET);
    expect(r.ok).toBe(true);
    const call = execCalls[0];
    // value is on stdin (input), NOT in argv, NOT in the command string.
    expect(call.opts.input).toBe(SECRET);
    expect(JSON.stringify(call.args)).not.toContain(SECRET);
    expect(call.file).toBe("/bin/sh");
    // key NAME travels as inert env data, never interpolated into the command.
    expect(call.opts.env?.HERMES_SECRET_KEY).toBe("OPENROUTER_API_KEY");
    expect(JSON.stringify(call.args)).not.toContain("OPENROUTER_API_KEY");
  });

  it("a hostile key NAME is REJECTED before exec (no injection, no \\n in logs)", () => {
    configValues["secrets.command_write"] = "writer";
    const evil = '"; rm -rf ~; echo "';
    const r = commandWriteSecret(evil, "v");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("bad-key");
    expect(execCalls).toHaveLength(0);
    // a newline-bearing name (dotenv-injection / log-injection vector) is rejected too
    const r2 = commandWriteSecret("X\nOPENROUTER_API_KEY=attacker", "v");
    expect(r2.ok).toBe(false);
    expect(r2.error).toBe("bad-key");
    expect(execCalls).toHaveLength(0);
  });

  it("delete passes the key NAME via env and feeds NO stdin", () => {
    configValues["secrets.command_delete"] = "deleter";
    const r = commandDeleteSecret("OLD_KEY");
    expect(r.ok).toBe(true);
    const call = execCalls[0];
    expect(call.opts.env?.HERMES_SECRET_KEY).toBe("OLD_KEY");
    expect(call.opts.input).toBeUndefined();
  });

  it("a failed write returns a coarse, secret-free error", () => {
    configValues["secrets.command_write"] = "writer";
    execImpl = () => {
      const e = new Error("boom: sk-leak") as Error & { status: number };
      e.status = 1;
      throw e;
    };
    const r = commandWriteSecret("K", "sk-leak");
    expect(r.ok).toBe(false);
    // error reason must NOT echo the value or raw message.
    expect(r.error).toBe("exit-1");
    expect(JSON.stringify(r)).not.toContain("sk-leak");
  });

  it("no write helper configured → write refuses (read-only by default)", () => {
    const r = commandWriteSecret("K", "v");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("no-write-helper");
    expect(execCalls).toHaveLength(0);
  });

  it("no delete helper configured → delete refuses", () => {
    const r = commandDeleteSecret("K");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("no-delete-helper");
    expect(execCalls).toHaveLength(0);
  });

  it("capability probes reflect whether helpers are configured", () => {
    expect(hasWriteHelper()).toBe(false);
    expect(hasDeleteHelper()).toBe(false);
    configValues["secrets.command_write"] = "w";
    configValues["secrets.command_delete"] = "d";
    expect(hasWriteHelper()).toBe(true);
    expect(hasDeleteHelper()).toBe(true);
  });

  it("a malformed key (whitespace / non-identifier) is rejected before any exec", () => {
    configValues["secrets.command_write"] = "writer";
    expect(commandWriteSecret("   ", "v").error).toBe("bad-key");
    expect(commandWriteSecret("has space", "v").error).toBe("bad-key");
    expect(commandWriteSecret("1leading-digit", "v").error).toBe("bad-key");
    expect(execCalls).toHaveLength(0);
  });
});
