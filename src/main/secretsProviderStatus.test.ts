import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Direct main-process contract test for secretsProviderStatus(). The renderer
// suite (SecretsProviders.test.tsx) asserts the no-values invariant against a
// MOCKED IPC bridge — it proves the COMPONENT relies on a values-free shape,
// but not that the real main-process function actually produces one. This file
// closes that gap: it calls the REAL secretsProviderStatus and asserts it
// returns only { provider, keys, count } with key NAMES, never values.
//
// Greptile gate, Family 1 (contract-invariant): the function's docstring states
// "values never leave the main process". A test must fail if someone changes
// `Object.keys(resolvedSecrets(...))` to `Object.entries(...)`, adds a `values`
// field, or otherwise leaks a secret value across the IPC boundary.
//
// ISOLATION (the repo's own idiom — see secrets/liveGatewayEnv.test.ts):
// installer.ts binds HERMES_HOME from process.env.HERMES_HOME at module-eval
// time. We pin it to a throwaway home holding a synthetic config.yaml BEFORE
// importing config.ts, so getConfigValue("secrets.provider") reads our value
// via its real read path (no fs mock, no intra-module-call problem). Only the
// cross-module ./secrets is mocked, so resolvedSecrets() returns sentinel keys.

const SENTINEL = "LEAKED_SECRET_VALUE_must_never_cross_ipc";
let FAKE_RESOLVED: Record<string, string> = {};

vi.mock("./secrets", async () => {
  const actual = await vi.importActual<typeof import("./secrets")>("./secrets");
  return { ...actual, resolvedSecrets: () => ({ ...FAKE_RESOLVED }) };
});

let TEST_HOME: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let config: typeof import("./config");

function writeConfig(provider: string): void {
  writeFileSync(
    join(TEST_HOME, "config.yaml"),
    `secrets:\n  provider: ${provider}\n`,
    "utf-8",
  );
}

beforeAll(async () => {
  TEST_HOME = mkdtempSync(join(tmpdir(), "sps-home-"));
  mkdirSync(TEST_HOME, { recursive: true });
  writeConfig("command");
  process.env.HERMES_HOME = TEST_HOME;
  // Import AFTER HERMES_HOME is set so installer.ts binds the test home.
  config = await import("./config");
});

afterAll(() => {
  try {
    rmSync(TEST_HOME, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("secretsProviderStatus — no-values IPC contract", () => {
  it("returns ONLY key names, never any secret value (the core invariant)", () => {
    writeConfig("command");
    FAKE_RESOLVED = {
      ANTHROPIC_API_KEY: SENTINEL,
      OPENROUTER_API_KEY: SENTINEL + "-2",
    };

    const status = config.secretsProviderStatus();

    // Shape: exactly provider/keys/count — no `values`, no extra leak field.
    expect(Object.keys(status).sort()).toEqual(["count", "keys", "provider"]);
    expect(status).not.toHaveProperty("values");

    // keys are NAMES, sorted, present; provider reflects the selector.
    expect(status.keys).toEqual(["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY"]);
    expect(status.count).toBe(2);
    expect(status.provider).toBe("command");

    // Decisive check: serialize the ENTIRE returned object and assert the
    // sentinel appears nowhere. Fails if Object.keys ever becomes
    // Object.entries / Object.values, or a value is smuggled into any field.
    expect(JSON.stringify(status)).not.toContain(SENTINEL);
  });

  it("env provider resolves nothing through the provider layer (empty, no spawn surface)", () => {
    writeConfig("env");
    FAKE_RESOLVED = { SHOULD_NOT_APPEAR: SENTINEL };

    const status = config.secretsProviderStatus();
    expect(status.provider).toBe("env");
    expect(status.keys).toEqual([]);
    expect(status.count).toBe(0);
    expect(JSON.stringify(status)).not.toContain(SENTINEL);
  });

  it("degrades to an empty key list if resolution throws — never propagates the error", async () => {
    writeConfig("command");
    const secrets = await import("./secrets");
    const spy = vi.spyOn(secrets, "resolvedSecrets").mockImplementation(() => {
      throw new Error("vault helper exploded");
    });

    expect(() => config.secretsProviderStatus()).not.toThrow();
    const status = config.secretsProviderStatus();
    expect(status.keys).toEqual([]);
    expect(status.count).toBe(0);
    expect(status.provider).toBe("command");
    spy.mockRestore();
  });
});
