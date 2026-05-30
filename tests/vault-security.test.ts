import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let testHome: string;

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
  },
}));

async function loadVaultModules(): Promise<{
  keychain: typeof import("../src/main/vault/keychain");
  service: typeof import("../src/main/vault/service");
}> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  const keychain = await import("../src/main/vault/keychain");
  const service = await import("../src/main/vault/service");
  return { keychain, service };
}

describe("vault security boundaries", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-vault-security-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("lists masked credentials without needing to unlock and decrypt every secret", async () => {
    const { keychain, service } = await loadVaultModules();
    keychain.initVaultWithPassword("test-password-123");
    service.addCredential("default", "openai", "work", "sk-test-secret-value");
    keychain.wipeMasterKeyFromMemory();
    service.shutdownVault();

    const creds = service.getCredentials("default");

    expect(creds).toEqual([
      {
        id: expect.any(String),
        provider: "openai",
        label: "work",
        maskedValue: "••••alue",
      },
    ]);
  });

  it("creates private vault database and key files", async () => {
    const { keychain, service } = await loadVaultModules();
    keychain.initVaultWithPassword("test-password-123");
    service.addCredential("default", "openai", "work", "sk-test-secret-value");

    const dbPath = join(testHome, "desktop", "vault.db");
    const keyPath = join(testHome, "desktop", "master.key.enc");

    expect(existsSync(dbPath)).toBe(true);
    expect(existsSync(keyPath)).toBe(true);
    if (process.platform !== "win32") {
      expect(statSync(dbPath).mode & 0o777).toBe(0o600);
      expect(statSync(keyPath).mode & 0o777).toBe(0o600);
    }
  });

  it("preserves original env keys for migration round trips", async () => {
    const { keychain, service } = await loadVaultModules();
    keychain.initVaultWithPassword("test-password-123");
    service.migratePlaintextEnv("default", "API_SERVER_KEY=server-key\n");
    service.activateProfile("default");

    const env = join(testHome, ".env");
    expect(existsSync(env)).toBe(true);
    expect(await import("fs").then((fs) => fs.readFileSync(env, "utf-8"))).toContain(
      "API_SERVER_KEY=server-key",
    );
  });
});
