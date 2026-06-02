import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

/**
 * Migration on read: when getApiServerKey() resolves the key from a
 * non-canonical source (config.yaml top-level, or nested
 * api_server.token), copy the value into the canonical .env so future
 * reads — and crucially the gateway's own os.getenv("API_SERVER_KEY")
 * fallback — find it there.
 *
 * Behavior contract:
 *  - Migration writes to .env (idempotent, additive only).
 *  - Original copy in config.yaml is left alone.
 *  - Logged to ~/.hermes/logs/config-fixes.log.
 *  - If .env already has API_SERVER_KEY, the migration is a no-op
 *    (the .env value wins by precedence — the resolver would already
 *    have returned it).
 *  - Per-profile scoped — never copies a default-profile value into a
 *    sibling profile's .env.
 */

const TEST_DIR = join(tmpdir(), `hermes-test-migration-${Date.now()}`);

async function freshConfig(
  home: string,
): Promise<typeof import("../src/main/config")> {
  vi.resetModules();
  process.env.HERMES_HOME = home;
  return await import("../src/main/config");
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  delete process.env.HERMES_HOME;
  vi.resetModules();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("getApiServerKey migration (default profile)", () => {
  it("migrates value from api_server.token to .env when .env is empty", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      ["api_server:", "  token: sk-from-config-token", ""].join("\n"),
    );
    // No .env file at all yet
    const { getApiServerKey } = await freshConfig(TEST_DIR);

    expect(getApiServerKey()).toBe("sk-from-config-token");

    // .env should now exist and contain the key
    const envFile = join(TEST_DIR, ".env");
    expect(existsSync(envFile)).toBe(true);
    const envContent = readFileSync(envFile, "utf-8");
    expect(envContent).toMatch(/^API_SERVER_KEY=sk-from-config-token/m);
  });

  it("migrates from top-level API_SERVER_KEY when .env is empty", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      ["API_SERVER_KEY: sk-legacy-top-level", ""].join("\n"),
    );
    const { getApiServerKey } = await freshConfig(TEST_DIR);

    expect(getApiServerKey()).toBe("sk-legacy-top-level");

    const envContent = readFileSync(join(TEST_DIR, ".env"), "utf-8");
    expect(envContent).toMatch(/^API_SERVER_KEY=sk-legacy-top-level/m);
  });

  it("leaves the original config.yaml entry intact (additive only)", async () => {
    const original = ["api_server:", "  token: sk-keep-this", ""].join("\n");
    writeFileSync(join(TEST_DIR, "config.yaml"), original);
    const { getApiServerKey } = await freshConfig(TEST_DIR);

    getApiServerKey();

    // Original config.yaml unchanged
    expect(readFileSync(join(TEST_DIR, "config.yaml"), "utf-8")).toBe(original);
  });

  it("is idempotent — a second call doesn't re-migrate or duplicate", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      ["api_server:", "  token: sk-idem", ""].join("\n"),
    );
    const { getApiServerKey } = await freshConfig(TEST_DIR);

    getApiServerKey();
    const envAfterFirst = readFileSync(join(TEST_DIR, ".env"), "utf-8");

    // Second call (caches in memory; that's fine — we're checking the
    // file on disk isn't double-written)
    getApiServerKey();
    const envAfterSecond = readFileSync(join(TEST_DIR, ".env"), "utf-8");

    expect(envAfterSecond).toBe(envAfterFirst);
    // Single line for API_SERVER_KEY, not multiple
    const matches = envAfterSecond.match(/^API_SERVER_KEY=/gm) || [];
    expect(matches.length).toBe(1);
  });

  it("does not overwrite an existing .env value (canonical wins)", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      ["api_server:", "  token: sk-from-yaml", ""].join("\n"),
    );
    writeFileSync(join(TEST_DIR, ".env"), "API_SERVER_KEY=sk-already-in-env\n");
    const { getApiServerKey } = await freshConfig(TEST_DIR);

    expect(getApiServerKey()).toBe("sk-already-in-env");

    // .env unchanged
    const envContent = readFileSync(join(TEST_DIR, ".env"), "utf-8");
    expect(envContent).toMatch(/^API_SERVER_KEY=sk-already-in-env/m);
    expect(envContent).not.toMatch(/sk-from-yaml/);
  });

  it("writes a JSONL audit entry to ~/.hermes/logs/config-fixes.log", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      ["api_server:", "  token: sk-audit-trail-test", ""].join("\n"),
    );
    const { getApiServerKey } = await freshConfig(TEST_DIR);

    getApiServerKey();

    const logFile = join(TEST_DIR, "logs", "config-fixes.log");
    expect(existsSync(logFile)).toBe(true);
    const lines = readFileSync(logFile, "utf-8")
      .split("\n")
      .filter((l) => l.trim() !== "");
    expect(lines.length).toBe(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.issueCode).toBe("API_SERVER_KEY_NON_CANONICAL");
    expect(entry.action).toBe("migrate");
    // Default-profile call: getConfigValue("api_server.token", undefined)
    // routes through the same dotted-path read, so the resolver
    // reports the "Profile" source (the profile is just "default"
    // when none is passed).
    expect(entry.from).toMatch(/^apiServerToken(Profile|Default)$/);
    expect(entry.to).toMatch(/\.env$/);
    // Value masked — first 4 + last 4 only
    expect(entry.valueMasked).toBe("sk-a…test");
    // Raw secret never appears in the log
    expect(lines[0]).not.toContain("sk-audit-trail-test");
  });

  it("is a no-op when the key is empty everywhere", async () => {
    writeFileSync(join(TEST_DIR, "config.yaml"), "agent:\n  enabled: true\n");
    const { getApiServerKey } = await freshConfig(TEST_DIR);

    expect(getApiServerKey()).toBe("");
    expect(existsSync(join(TEST_DIR, ".env"))).toBe(false);
  });

  it("does not copy a default-profile config key into a named profile .env", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      ["api_server:", "  token: sk-default-token", ""].join("\n"),
    );
    mkdirSync(join(TEST_DIR, "profiles", "work"), { recursive: true });
    writeFileSync(
      join(TEST_DIR, "profiles", "work", "config.yaml"),
      ["model:", "  provider: auto", ""].join("\n"),
    );
    const { getApiServerKey } = await freshConfig(TEST_DIR);

    expect(getApiServerKey("work")).toBe("sk-default-token");
    expect(existsSync(join(TEST_DIR, "profiles", "work", ".env"))).toBe(false);
    expect(existsSync(join(TEST_DIR, "logs", "config-fixes.log"))).toBe(false);
  });
});
