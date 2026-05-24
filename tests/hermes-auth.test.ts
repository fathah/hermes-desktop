import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

/**
 * Coverage for the in-app OAuth login feature (`src/main/hermes-auth.ts`):
 *
 *   - provider allowlist (`isOAuthLoginProvider`)
 *   - `runHermesAuthLogin` spawns `hermes auth add <provider> --type
 *     oauth`, streams output, and maps exit code → success/failure
 *   - the single-flight guard rejects a second concurrent login
 *   - `cancelHermesAuthLogin` kills the in-flight subprocess
 */

interface FakeProc extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

const { spawnSpy, fakeProcs } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter: EE } = require("events");
  const fakeProcs: FakeProc[] = [];
  return {
    fakeProcs,
    spawnSpy: vi.fn(() => {
      const proc = new EE() as FakeProc;
      proc.stdout = new EE();
      proc.stderr = new EE();
      proc.kill = vi.fn();
      fakeProcs.push(proc);
      return proc;
    }),
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_PYTHON: "/usr/bin/python3",
  HERMES_REPO: "/tmp/hermes-repo",
  HERMES_HOME: "/tmp/hermes-home",
  hermesCliArgs: (args: string[]) => args,
  getEnhancedPath: () => process.env.PATH || "",
}));

vi.mock("../src/main/process-options", () => ({
  HIDDEN_SUBPROCESS_OPTIONS: {},
}));

vi.mock("../src/main/utils", () => ({
  stripAnsi: (s: string) => s,
}));

// hermes-auth.ts only consumes `spawn` from child_process, so a minimal
// replacement is enough. Both the named export and a `default` are
// provided so the CJS↔ESM interop layer is satisfied.
vi.mock("child_process", () => ({
  spawn: spawnSpy,
  default: { spawn: spawnSpy },
}));

import {
  runHermesAuthLogin,
  cancelHermesAuthLogin,
  isOAuthLoginProvider,
  detectDeviceCode,
  OAUTH_LOGIN_PROVIDERS,
} from "../src/main/hermes-auth";

function lastProc(): FakeProc {
  return fakeProcs[fakeProcs.length - 1];
}

describe("detectDeviceCode", () => {
  // The exact shape the OpenAI Codex CLI prints.
  const codexPrompt = [
    "To continue, follow these steps:",
    "",
    "  1. Open this URL in your browser:",
    "     https://auth.openai.com/codex/device",
    "",
    "  2. Enter this code:",
    "     BVY0-XEPCD",
    "",
    "Waiting for sign-in... (press Ctrl+C to cancel)",
  ].join("\n");

  it("extracts the URL and code from a Codex device prompt", () => {
    expect(detectDeviceCode(codexPrompt)).toEqual({
      url: "https://auth.openai.com/codex/device",
      code: "BVY0-XEPCD",
    });
  });

  it("returns null until both URL and code are present", () => {
    const partial = "  1. Open this URL in your browser:\n     https://auth.openai.com/codex/device\n";
    expect(detectDeviceCode(partial)).toBeNull();
    expect(detectDeviceCode("")).toBeNull();
  });

  it("ignores a non-https URL", () => {
    const insecure = codexPrompt.replace("https://", "http://");
    expect(detectDeviceCode(insecure)).toBeNull();
  });

  it("does not match browser-loopback provider output", () => {
    // Gemini opens its own browser and has no device code — must not
    // trigger the device-code path.
    const gemini =
      "Opening your browser to sign in to Google…\n" +
      "If it does not open automatically, visit:\n" +
      "  https://accounts.google.com/o/oauth2/v2/auth?client_id=x\n";
    expect(detectDeviceCode(gemini)).toBeNull();
  });

  it("does not silently consume a blank line between label and value", () => {
    // A naive `\s*` for indentation would skip across the empty line and
    // wrongly attach the wrong URL/code as the value (fathah's review on
    // PR #280). Horizontal-whitespace-only stops at the linebreak.
    const blankUrlGap = [
      "  1. Open this URL in your browser:",
      "",
      "     https://attacker.example/phish",
      "",
      "  2. Enter this code:",
      "     BVY0-XEPCD",
    ].join("\n");
    expect(detectDeviceCode(blankUrlGap)).toBeNull();

    const blankCodeGap = [
      "  1. Open this URL in your browser:",
      "     https://auth.openai.com/codex/device",
      "",
      "  2. Enter this code:",
      "",
      "     BVY0-XEPCD",
    ].join("\n");
    expect(detectDeviceCode(blankCodeGap)).toBeNull();
  });
});

describe("isOAuthLoginProvider", () => {
  it("accepts the five OAuth-capable providers", () => {
    for (const p of OAUTH_LOGIN_PROVIDERS) {
      expect(isOAuthLoginProvider(p)).toBe(true);
    }
  });

  it("rejects API-key providers and unknown values", () => {
    expect(isOAuthLoginProvider("openrouter")).toBe(false);
    expect(isOAuthLoginProvider("anthropic")).toBe(false);
    expect(isOAuthLoginProvider("kimi-coding")).toBe(false);
    expect(isOAuthLoginProvider("")).toBe(false);
  });
});

describe("runHermesAuthLogin", () => {
  beforeEach(() => {
    spawnSpy.mockClear();
    fakeProcs.length = 0;
  });

  it("refuses an unsupported provider without spawning", async () => {
    const result = await runHermesAuthLogin("openrouter", () => {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unsupported/i);
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("spawns `auth add <provider> --type oauth` and streams output", async () => {
    const chunks: string[] = [];
    const promise = runHermesAuthLogin("google-gemini-cli", (c) =>
      chunks.push(c),
    );

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const args = spawnSpy.mock.calls[0][1] as string[];
    expect(args).toEqual([
      "auth",
      "add",
      "google-gemini-cli",
      "--type",
      "oauth",
    ]);

    const proc = lastProc();
    proc.stdout.emit("data", Buffer.from("Opening browser for sign-in...\n"));
    proc.stderr.emit("data", Buffer.from("waiting for redirect\n"));
    proc.emit("close", 0, null);

    const result = await promise;
    expect(result.success).toBe(true);
    expect(chunks.join("")).toContain("Opening browser");
    expect(chunks.join("")).toContain("waiting for redirect");
  });

  it("passes the profile flag when a named profile is given", async () => {
    const promise = runHermesAuthLogin("xai-oauth", () => {}, "work");
    const args = spawnSpy.mock.calls[0][1] as string[];
    expect(args).toEqual([
      "-p",
      "work",
      "auth",
      "add",
      "xai-oauth",
      "--type",
      "oauth",
    ]);
    lastProc().emit("close", 0, null);
    await promise;
  });

  it("reports failure on a non-zero exit code", async () => {
    const promise = runHermesAuthLogin("qwen-oauth", () => {});
    lastProc().emit("close", 1, null);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/code 1/);
  });

  it("reports cancellation when the process is killed by signal", async () => {
    const promise = runHermesAuthLogin("minimax-oauth", () => {});
    lastProc().emit("close", null, "SIGTERM");
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cancelled/i);
  });

  it("rejects a second concurrent login while one is in flight", async () => {
    const first = runHermesAuthLogin("openai-codex", () => {});
    const second = await runHermesAuthLogin("xai-oauth", () => {});
    expect(second.success).toBe(false);
    expect(second.error).toMatch(/already in progress/i);
    // Only the first login spawned a process.
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    lastProc().emit("close", 0, null);
    await first;
  });
});

describe("cancelHermesAuthLogin", () => {
  beforeEach(() => {
    spawnSpy.mockClear();
    fakeProcs.length = 0;
  });

  it("returns false when no login is running", () => {
    expect(cancelHermesAuthLogin()).toBe(false);
  });

  it("kills the in-flight subprocess and returns true", async () => {
    const promise = runHermesAuthLogin("openai-codex", () => {});
    const proc = lastProc();

    expect(cancelHermesAuthLogin()).toBe(true);
    expect(proc.kill).toHaveBeenCalled();

    // Real kill would fire a close with a signal; emulate so the
    // promise settles and the single-flight slot is released.
    proc.emit("close", null, "SIGTERM");
    await promise;
    expect(cancelHermesAuthLogin()).toBe(false);
  });
});
