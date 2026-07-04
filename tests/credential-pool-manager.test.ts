import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

const { mockExecFileSync, mockSecrets } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn((_: string, args?: string[]) => {
    const commandIndex =
      args?.findIndex((arg) => arg === "set-secret" || arg === "get-secret") ??
      -1;
    const command = commandIndex >= 0 ? args?.[commandIndex] : "";
    const profile =
      commandIndex >= 0 ? (args?.[commandIndex + 1] ?? "default") : "default";
    const key = commandIndex >= 0 ? (args?.[commandIndex + 2] ?? "") : "";
    const mapKey = `${profile}:${key}`;
    if (command === "set-secret") {
      mockSecrets.set(mapKey, args?.[commandIndex + 3] ?? "");
      return Buffer.from("ok");
    }
    if (command === "get-secret") {
      return Buffer.from(`${mockSecrets.get(mapKey) ?? ""}\n`);
    }
    return Buffer.from("ok");
  }),
  mockSecrets: new Map<string, string>(),
}));

let encryptionAvailable = true;
let failNextEncrypt = false;
const safeStorageMock = {
  isEncryptionAvailable: () => encryptionAvailable,
  encryptString: (secret: string) => {
    if (failNextEncrypt) {
      failNextEncrypt = false;
      throw new Error("keychain unavailable");
    }
    return Buffer.from(`encrypted:${secret}`, "utf-8");
  },
  decryptString: (buffer: Buffer) => {
    const value = buffer.toString("utf-8");
    if (!value.startsWith("encrypted:")) {
      throw new Error("Decryption failed");
    }
    return value.slice("encrypted:".length);
  },
};

vi.mock("child_process", () => {
  const fns = {
    execFileSync: mockExecFileSync,
  };
  return { ...fns, default: fns };
});

type ConfigModule = typeof import("../src/main/config");
type CredentialPoolManagerCtor =
  typeof import("../src/main/config/credential-pool-manager").CredentialPoolManager;

const TEST_DIR = join(
  tmpdir(),
  `hermes-test-cred-manager-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
);

async function freshConfig(home: string): Promise<{
  addCredentialPoolEntry: ConfigModule["addCredentialPoolEntry"];
  getCredentialPool: ConfigModule["getCredentialPool"];
  readEnv: ConfigModule["readEnv"];
  CredentialPoolManager: CredentialPoolManagerCtor;
}> {
  vi.resetModules();
  process.env.HERMES_HOME = home;
  (
    globalThis as typeof globalThis & {
      mockSafeStorage?: typeof safeStorageMock;
    }
  ).mockSafeStorage = safeStorageMock;
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
    mockExecFileSync.mockClear();
    mockSecrets.clear();
    encryptionAvailable = true;
    failNextEncrypt = false;
    mkdirSync(TEST_DIR, { recursive: true });
    // Write a base config.yaml so profilePaths doesn't throw
    writeFileSync(
      join(TEST_DIR, "config.yaml"),
      "platform_toolsets:\n  cli: []\n",
    );
  });

  afterEach(() => {
    delete process.env.HERMES_HOME;
    delete (
      globalThis as typeof globalThis & {
        mockSafeStorage?: typeof safeStorageMock;
      }
    ).mockSafeStorage;
    vi.resetModules();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("selects next key based on priority and updates env", async () => {
    const { addCredentialPoolEntry, CredentialPoolManager, readEnv } =
      await freshConfig(TEST_DIR);

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
    const { addCredentialPoolEntry, CredentialPoolManager, readEnv } =
      await freshConfig(TEST_DIR);

    addCredentialPoolEntry("openai", "key-first", "First", "default");
    addCredentialPoolEntry("openai", "key-second", "Second", "default");

    // Mark the first key on cooldown for 5 mins
    CredentialPoolManager.markKeyCooldown(
      "openai",
      "key-first",
      300000,
      "default",
    );

    const selected = CredentialPoolManager.rotateKey("openai", "default");
    expect(selected).toBe("key-second");

    const env = readEnv("default");
    expect(env.OPENAI_API_KEY).toBe("key-second");
  });

  it("falls back to clearing cooldown on oldest key if all keys are on cooldown", async () => {
    const { addCredentialPoolEntry, CredentialPoolManager } =
      await freshConfig(TEST_DIR);

    addCredentialPoolEntry("openai", "key-first", "First", "default");
    addCredentialPoolEntry("openai", "key-second", "Second", "default");

    // Both on cooldown (different times)
    CredentialPoolManager.markKeyCooldown(
      "openai",
      "key-first",
      50000,
      "default",
    );
    CredentialPoolManager.markKeyCooldown(
      "openai",
      "key-second",
      100000,
      "default",
    );

    // Should clear and select key-first since its cooldown is older/earlier
    const selected = CredentialPoolManager.rotateKey("openai", "default");
    expect(selected).toBe("key-first");
  });

  it("returns null and leaves request counts untouched if the active env write fails", async () => {
    const { addCredentialPoolEntry, CredentialPoolManager, getCredentialPool } =
      await freshConfig(TEST_DIR);
    addCredentialPoolEntry("openai", "key-first", "First", "default");
    const before = getCredentialPool("default").openai[0].request_count;
    failNextEncrypt = true;

    const selected = CredentialPoolManager.rotateKey("openai", "default");
    expect(selected).toBeNull();
    const pool = getCredentialPool("default").openai;
    expect(pool[0].request_count).toBe(before);
  });
});
