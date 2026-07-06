import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

/**
 * getApiServerKey × secrets provider (hardening pass H2).
 *
 * The secrets provider's enumerable map is overlaid BENEATH the `.env` view at
 * the top of getApiServerKey — process.env > .env > provider — so a
 * `command`-provider user with API_SERVER_KEY in their vault stops getting 401s
 * from claw3d.ts / mcp-servers.ts / index.ts, while the default env provider's
 * behavior is byte-for-byte unchanged.
 *
 * These tests run the REAL chain (config.yaml → getSecretsProvider →
 * CommandSecretsProvider → /bin/sh) against a temp HERMES_HOME, with a
 * synthetic `echo` helper standing in for the vault.
 */

const TEST_DIR = join(tmpdir(), `hermes-test-secrets-key-${Date.now()}`);
const itPosix = process.platform === "win32" ? it.skip : it;
const ORIGINAL_API_SERVER_KEY = process.env.API_SERVER_KEY;

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
});

afterEach(() => {
  delete process.env.HERMES_HOME;
  if (ORIGINAL_API_SERVER_KEY === undefined) delete process.env.API_SERVER_KEY;
  else process.env.API_SERVER_KEY = ORIGINAL_API_SERVER_KEY;
  vi.resetModules();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("getApiServerKey secrets-provider overlay", () => {
  itPosix(
    "resolves a vault-stored key via the command provider when .env is empty",
    async () => {
      writeFileSync(
        join(TEST_DIR, "config.yaml"),
        [
          "secrets:",
          "  provider: command",
          "  command: echo API_SERVER_KEY=from-vault",
          "",
        ].join("\n"),
      );
      // No .env file at all — previously this returned "" and consumers 401'd.
      const { getApiServerKey } = await freshConfig(TEST_DIR);

      expect(getApiServerKey()).toBe("from-vault");

      // The vault value must NOT be migrated (written) to .env: it resolves as
      // the canonical envProfile arm, and secrets never land on disk.
      expect(existsSync(join(TEST_DIR, ".env"))).toBe(false);
    },
  );

  it("env-provider no-regression: .env value wins and nothing changes", async () => {
    // No secrets.* config → default env provider (its list() IS the .env map).
    writeFileSync(join(TEST_DIR, "config.yaml"), "agent:\n  enabled: true\n");
    writeFileSync(join(TEST_DIR, ".env"), "API_SERVER_KEY=from-dotenv\n");
    const { getApiServerKey } = await freshConfig(TEST_DIR);

    expect(getApiServerKey()).toBe("from-dotenv");
  });

  itPosix(
    ".env wins over the command provider when both have the key",
    async () => {
      writeFileSync(
        join(TEST_DIR, "config.yaml"),
        [
          "secrets:",
          "  provider: command",
          "  command: echo API_SERVER_KEY=from-vault",
          "",
        ].join("\n"),
      );
      writeFileSync(join(TEST_DIR, ".env"), "API_SERVER_KEY=from-dotenv\n");
      const { getApiServerKey } = await freshConfig(TEST_DIR);

      expect(getApiServerKey()).toBe("from-dotenv");
    },
  );

  itPosix("process.env wins over the command provider", async () => {
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      [
        "secrets:",
        "  provider: command",
        "  command: echo API_SERVER_KEY=from-vault",
        "",
      ].join("\n"),
    );
    process.env.API_SERVER_KEY = "from-process-env";
    const { getApiServerKey } = await freshConfig(TEST_DIR);

    expect(getApiServerKey()).toBe("from-process-env");
  });
});
