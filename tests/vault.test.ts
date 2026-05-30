import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createHmac, scryptSync } from "crypto";

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

describe("vault encryption", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-vault-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("encrypts credentials at rest (not plaintext in vault.db)", async () => {
    const { keychain, service } = await loadVaultModules();
    keychain.initVaultWithPassword("test-password-123");
    service.addCredential("default", "openai", "work key", "sk-test-secret-value-here");

    const dbPath = join(testHome, "desktop", "vault.db");
    expect(existsSync(dbPath)).toBe(true);
    const raw = readFileSync(dbPath);
    expect(raw.includes(Buffer.from("sk-test-secret-value-here"))).toBe(false);

    const creds = service.getCredentials("default");
    expect(creds).toHaveLength(1);
    expect(creds[0].maskedValue).toMatch(/••••/);
    expect(creds[0].provider).toBe("openai");
  });

  it("activates profile by writing .env from vault", async () => {
    const { keychain, service } = await loadVaultModules();
    keychain.initVaultWithPassword("test-password-123");
    service.addCredential(
      "default",
      "openai",
      "primary",
      "sk-activation-test-key-12345",
    );

    service.activateProfile("default");

    const envContent = readFileSync(join(testHome, ".env"), "utf-8");
    expect(envContent).toContain("OPENAI_API_KEY=sk-activation-test-key-12345");
    expect(envContent).toContain("Managed by Hermes Workspace");
  });

  it("migrates plaintext .env into vault", async () => {
    const { keychain, service } = await loadVaultModules();
    keychain.initVaultWithPassword("test-password-123");

    const envContent = "OPENAI_API_KEY=sk-migrated\nDEEPSEEK_API_KEY=ds-key\n";
    const count = service.migratePlaintextEnv("default", envContent);
    expect(count).toBe(2);

    service.activateProfile("default");
    const written = readFileSync(join(testHome, ".env"), "utf-8");
    expect(written).toContain("OPENAI_API_KEY=sk-migrated");
    expect(written).toContain("DEEPSEEK_API_KEY=ds-key");
  });

  it("deletes credentials from vault", async () => {
    const { keychain, service } = await loadVaultModules();
    keychain.initVaultWithPassword("test-password-123");
    const { id } = service.addCredential("default", "anthropic", "x", "sk-del");
    service.removeCredential(id);
    expect(service.getCredentials("default")).toHaveLength(0);
  });

  it("copies credentials between profiles", async () => {
    const { keychain, service } = await loadVaultModules();
    keychain.initVaultWithPassword("test-password-123");
    service.addCredential("source", "openai", "work", "sk-copy-source-key");
    service.addCredential("source", "firecrawl", "web", "fc-copy-key");

    const count = service.copyProfileSecrets("source", "target");
    expect(count).toBe(2);

    const targetCreds = service.getCredentials("target");
    expect(targetCreds).toHaveLength(2);
    expect(targetCreds.map((c) => c.provider).sort()).toEqual([
      "firecrawl",
      "openai",
    ]);
  });

  it("unlocks password vault after simulated restart", async () => {
    const { keychain, service } = await loadVaultModules();
    keychain.initVaultWithPassword("test-password-123");
    service.addCredential("default", "openai", "work", "sk-restart-secret-key");

    keychain.wipeMasterKeyFromMemory();
    service.shutdownVault();

    expect(keychain.isVaultLocked()).toBe(true);
    expect(() => keychain.initMasterKey()).toThrow(/locked/i);

    service.initVault();
    expect(keychain.isVaultLocked()).toBe(true);

    keychain.initVaultWithPassword("test-password-123");
    service.initVault();

    const creds = service.getCredentials("default");
    expect(creds).toHaveLength(1);
    expect(creds[0].provider).toBe("openai");
  });

  it("stores password verifier derived from scrypt key, not public salt", async () => {
    const { keychain } = await loadVaultModules();
    const password = "test-password-123";
    keychain.initVaultWithPassword(password);

    const envelopePath = join(testHome, "desktop", "master.key.enc");
    const envelope = JSON.parse(readFileSync(envelopePath, "utf-8")) as {
      salt: string;
      verifierValue: string;
    };
    const salt = Buffer.from(envelope.salt, "base64");
    const key = scryptSync(password, salt, 32);
    const stored = Buffer.from(envelope.verifierValue, "base64");
    const saltKeyed = createHmac("sha256", salt)
      .update("hermes-vault-password-verifier-v1")
      .digest();
    const keyKeyed = createHmac("sha256", key)
      .update("hermes-vault-password-verifier-v1")
      .digest();

    expect(saltKeyed.equals(stored)).toBe(false);
    expect(keyKeyed.equals(stored)).toBe(true);
  });

  it("rejects wrong password after simulated restart", async () => {
    const { keychain } = await loadVaultModules();
    keychain.initVaultWithPassword("correct-password-123");
    keychain.wipeMasterKeyFromMemory();

    expect(() => keychain.initVaultWithPassword("wrong-password")).toThrow(
      /Invalid master password/i,
    );
  });
});
