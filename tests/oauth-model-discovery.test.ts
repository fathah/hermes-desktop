import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Coverage for OAuth/subscription-provider model discovery.
 *
 * These providers have no static-key `/v1/models` endpoint, so the
 * desktop asks hermes-agent's `provider_model_ids` via a short Python
 * call. When that's unavailable it falls back to a curated list mirrored
 * from the agent. Both paths are exercised here with a mocked
 * `child_process.execFile`.
 */

const { execFileSpy, behavior } = vi.hoisted(() => {
  const behavior: { err: Error | null; stdout: string } = {
    err: null,
    stdout: "",
  };
  return {
    behavior,
    execFileSpy: vi.fn(
      (
        _file: unknown,
        _args: unknown,
        _opts: unknown,
        cb: (e: Error | null, out: string, errOut: string) => void,
      ) => {
        cb(behavior.err, behavior.stdout, "");
      },
    ),
  };
});

vi.mock("child_process", () => ({
  execFile: execFileSpy,
  default: { execFile: execFileSpy },
}));

vi.mock("../src/main/installer", () => ({
  expectedEnvKeyForModel: () => "",
  HERMES_PYTHON: "/usr/bin/python3",
  HERMES_REPO: "/tmp/hermes-repo",
  HERMES_HOME: "/tmp/hermes-home",
  getEnhancedPath: () => process.env.PATH || "",
}));

vi.mock("../src/main/config", () => ({
  readEnv: () => ({}),
}));

import {
  discoverProviderModels,
  _clearCache,
} from "../src/main/model-discovery";

describe("OAuth provider model discovery", () => {
  beforeEach(() => {
    _clearCache();
    execFileSpy.mockClear();
    behavior.err = null;
    behavior.stdout = "";
  });

  it("returns the live provider_model_ids list for an OAuth provider", async () => {
    behavior.stdout = '["gpt-5.5", "gpt-5.3-codex", "gpt-5.2-codex"]';
    const result = await discoverProviderModels(
      "openai-codex",
      undefined,
      undefined,
      undefined,
    );
    expect(result.status).toBe("ok");
    // sorted + de-duped
    expect(result.models).toEqual([
      "gpt-5.2-codex",
      "gpt-5.3-codex",
      "gpt-5.5",
    ]);
    // the python call carried the provider as the snippet's argv
    const call = execFileSpy.mock.calls[0];
    expect((call[1] as string[])[(call[1] as string[]).length - 1]).toBe(
      "openai-codex",
    );
  });

  it("falls back to the curated list when the Python call fails", async () => {
    behavior.err = new Error("python: command not found");
    const result = await discoverProviderModels(
      "openai-codex",
      undefined,
      undefined,
      undefined,
    );
    expect(result.status).toBe("ok");
    expect(result.models).toContain("gpt-5.3-codex");
    expect(result.models.length).toBeGreaterThan(0);
  });

  it("falls back when stdout is not a JSON array", async () => {
    behavior.stdout = "Traceback (most recent call last):\n  ImportError";
    const result = await discoverProviderModels(
      "xai-oauth",
      undefined,
      undefined,
      undefined,
    );
    expect(result.models).toContain("grok-4.3");
  });

  it("falls back when the live list comes back empty", async () => {
    behavior.stdout = "[]";
    const result = await discoverProviderModels(
      "google-gemini-cli",
      undefined,
      undefined,
      undefined,
    );
    expect(result.models).toContain("gemini-3-pro-preview");
  });

  it("caches the result so a second call skips the Python spawn", async () => {
    behavior.stdout = '["gpt-5.5"]';
    const first = await discoverProviderModels(
      "openai-codex",
      undefined,
      undefined,
      undefined,
    );
    expect(first.cached).toBe(false);
    const second = await discoverProviderModels(
      "openai-codex",
      undefined,
      undefined,
      undefined,
    );
    expect(second.cached).toBe(true);
    expect(second.models).toEqual(["gpt-5.5"]);
    expect(execFileSpy).toHaveBeenCalledTimes(1);
  });
});
