import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

const TEST_DIR = join(
  tmpdir(),
  `hermes-test-cred-manager-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
);

async function freshConfig(
  home: string,
): Promise<{
  addCredentialPoolEntry: any;
  getCredentialPool: any;
  readEnv: any;
  CredentialPoolManager: any;
}> {
  vi.resetModules();
  process.env.HERMES_HOME = home;
  const config = await import("../src/main/config");
  const manager = await import("../src/main/config/credential-pool-manager");
  return {
    addCredentialPoolEntry: config.addCredentialPoolEntry,
    getCredentialPool: config.getCredentialPool,
    readEnv: config.readEnv,
    CredentialPoolManager: manager.CredentialPoolManager,
  };
}

describe("CredentialPoolManager", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    // Write a base config.yaml so profilePaths doesn't throw
    writeFileSync(join(TEST_DIR, "config.yaml"), "platform_toolsets:\n  cli: []\n");
  });

  afterEach(() => {
    delete process.env.HERMES_HOME;
    vi.resetModules();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("selects next key based on priority and updates env", async () => {
    const { addCredentialPoolEntry, CredentialPoolManager, readEnv } = await freshConfig(TEST_DIR);

    addCredentialPoolEntry("openai", "key-first", "First", "default");
    addCredentialPoolEntry("openai", "key-second", "Second", "default");

    // Default priorities should be 0 and 1
    const selected = CredentialPoolManager.rotateKey("openai", "default");
    expect(selected).toBe("key-first");

    // Env file should be updated
    const env = readEnv("default");
    expect(env.OPENAI_API_KEY).toBe("key-first");
  });

  it("gating on cooldown filters out keys", async () => {
    const { addCredentialPoolEntry, CredentialPoolManager, readEnv } = await freshConfig(TEST_DIR);

    addCredentialPoolEntry("openai", "key-first", "First", "default");
    addCredentialPoolEntry("openai", "key-second", "Second", "default");

    // Mark the first key on cooldown for 5 mins
    CredentialPoolManager.markKeyCooldown("openai", "key-first", 300000, "default");

    const selected = CredentialPoolManager.rotateKey("openai", "default");
    expect(selected).toBe("key-second");

    const env = readEnv("default");
    expect(env.OPENAI_API_KEY).toBe("key-second");
  });

  it("falls back to clearing cooldown on oldest key if all keys are on cooldown", async () => {
    const { addCredentialPoolEntry, CredentialPoolManager } = await freshConfig(TEST_DIR);

    addCredentialPoolEntry("openai", "key-first", "First", "default");
    addCredentialPoolEntry("openai", "key-second", "Second", "default");

    // Both on cooldown (different times)
    CredentialPoolManager.markKeyCooldown("openai", "key-first", 50000, "default");
    CredentialPoolManager.markKeyCooldown("openai", "key-second", 100000, "default");

    // Should clear and select key-first since its cooldown is older/earlier
    const selected = CredentialPoolManager.rotateKey("openai", "default");
    expect(selected).toBe("key-first");
  });
});
