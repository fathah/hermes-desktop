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
// `Object.keys(providerListSafe(...))` to `Object.entries(...)`, adds a `values`
// field, or otherwise leaks a secret value across the IPC boundary.
//
// AIR-017 (display-path vault-only): secretsProviderStatus lists the keys the UI
// renders as "Vault Provided" badges. It MUST derive them from providerListSafe()
// (the vault-only provider list), NOT resolvedSecrets() — which overlays the ENTIRE
// process.env (PATH, HOME, npm_config_*) and would falsely label ~130 env vars as
// vault-provided. So this test mocks providerListSafe (the real producer's
// dependency) and a separate case proves env overlay does not bleed in.
//
// ISOLATION (the repo's own idiom — see secrets/liveGatewayEnv.test.ts):
// installer.ts binds HERMES_HOME from process.env.HERMES_HOME at module-eval
// time. We pin it to a throwaway home holding a synthetic config.yaml BEFORE
// importing config.ts, so getConfigValue("secrets.provider") reads our value
// via its real read path (no fs mock, no intra-module-call problem). Only the
// cross-module ./secrets is mocked, so providerListSafe() returns sentinel keys.

const SENTINEL = "LEAKED_SECRET_VALUE_must_never_cross_ipc";
let FAKE_PROVIDER_LIST: Record<string, string> = {};

vi.mock("./secrets", async () => {
  const actual = await vi.importActual<typeof import("./secrets")>("./secrets");
  return {
    ...actual,
    providerListSafe: () => ({ ...FAKE_PROVIDER_LIST }),
  };
});

let TEST_HOME: string;
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
    FAKE_PROVIDER_LIST = {
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

  it("AIR-017: lists ONLY provider (vault) keys — process.env is NOT overlaid into the badge list", async () => {
    writeConfig("command");
    // The vault resolves exactly these two.
    FAKE_PROVIDER_LIST = {
      VAULT_ONLY_KEY_A: "v1",
      VAULT_ONLY_KEY_B: "v2",
    };
    // A process.env var that resolvedSecrets() WOULD overlay — it must NOT appear,
    // because the display path uses providerListSafe(), not resolvedSecrets().
    process.env.PATH_LIKE_ENV_NOISE_AIR017 = "should-not-show";
    try {
      const status = config.secretsProviderStatus();
      expect(status.keys).toEqual(["VAULT_ONLY_KEY_A", "VAULT_ONLY_KEY_B"]);
      expect(status.count).toBe(2);
      // the env var must be absent — proves no resolvedSecrets() overlay leak
      expect(status.keys).not.toContain("PATH_LIKE_ENV_NOISE_AIR017");
      expect(status.keys.some((k) => k === "PATH" || k === "HOME")).toBe(false);
    } finally {
      delete process.env.PATH_LIKE_ENV_NOISE_AIR017;
    }
  });

  it("env provider resolves nothing through the provider layer (empty, no spawn surface)", () => {
    writeConfig("env");
    FAKE_PROVIDER_LIST = { SHOULD_NOT_APPEAR: SENTINEL };

    const status = config.secretsProviderStatus();
    expect(status.provider).toBe("env");
    expect(status.keys).toEqual([]);
    expect(status.count).toBe(0);
    expect(JSON.stringify(status)).not.toContain(SENTINEL);
  });

  it("degrades to an empty key list if resolution throws — never propagates the error", async () => {
    writeConfig("command");
    const secrets = await import("./secrets");
    const spy = vi.spyOn(secrets, "providerListSafe").mockImplementation(() => {
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
