import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

/**
 * invalidateSecretsCache (vault polish V2) — the exported hook that drops the
 * `env:*` and `apiServerKey:*` cache entries so a vault rotation /
 * secrets-add is picked up on the NEXT lookup instead of after the 5s TTL.
 */

const TEST_DIR = join(tmpdir(), `hermes-test-secrets-invalidate-${Date.now()}`);

async function freshConfig(
  home: string,
): Promise<typeof import("../src/main/config")> {
  vi.resetModules();
  process.env.HERMES_HOME = home;
  return await import("../src/main/config");
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  delete process.env.API_SERVER_KEY;
  writeFileSync(join(TEST_DIR, "config.yaml"), "agent:\n  enabled: true\n");
  // Silence the overlay debug line in test output.
  vi.spyOn(console, "debug").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.HERMES_HOME;
  delete process.env.API_SERVER_KEY;
  vi.restoreAllMocks();
  vi.resetModules();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("invalidateSecretsCache", () => {
  it("clears the apiServerKey cache so a rotated key resolves immediately", async () => {
    writeFileSync(
      join(TEST_DIR, ".env"),
      "API_SERVER_KEY=synthetic-old-marker\n",
    );
    const { getApiServerKey, invalidateSecretsCache } =
      await freshConfig(TEST_DIR);

    expect(getApiServerKey()).toBe("synthetic-old-marker");

    // Rotate the key on disk. The cached value must still be served (proves
    // the cache is live), then invalidation must surface the new value.
    writeFileSync(
      join(TEST_DIR, ".env"),
      "API_SERVER_KEY=synthetic-new-marker\n",
    );
    expect(getApiServerKey()).toBe("synthetic-old-marker");

    invalidateSecretsCache();
    expect(getApiServerKey()).toBe("synthetic-new-marker");
  });

  it("clears the env cache so readEnv re-parses the .env file", async () => {
    writeFileSync(join(TEST_DIR, ".env"), "SYNTHETIC_MARKER=one\n");
    const { readEnv, invalidateSecretsCache } = await freshConfig(TEST_DIR);

    expect(readEnv().SYNTHETIC_MARKER).toBe("one");

    writeFileSync(join(TEST_DIR, ".env"), "SYNTHETIC_MARKER=two\n");
    expect(readEnv().SYNTHETIC_MARKER).toBe("one"); // still cached

    invalidateSecretsCache();
    expect(readEnv().SYNTHETIC_MARKER).toBe("two");
  });
});
