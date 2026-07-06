import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { redactSensitiveData, timingSafeTokenEqual } from "./security";
import { join } from "path";
import { existsSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";

// Mock Electron safeStorage module before importing config
const safeStorageMock = {
  isEncryptionAvailable: () => true,
  encryptString: (str: string) => {
    return Buffer.from("encrypted:" + str, "utf-8");
  },
  decryptString: (buf: Buffer) => {
    const val = buf.toString("utf-8");
    if (!val.startsWith("encrypted:")) {
      throw new Error("Decryption failed");
    }
    return val.replace("encrypted:", "");
  },
};

type SecureStorageTestGlobal = typeof globalThis & {
  mockSafeStorage?: typeof safeStorageMock;
};

vi.mock("electron", () => ({
  safeStorage: safeStorageMock,
}));

const TEST_DIR = join(tmpdir(), `hermes-test-security-${Date.now()}`);

async function freshConfig(home: string): Promise<typeof import("./config")> {
  vi.resetModules();
  process.env.HERMES_HOME = home;
  return await import("./config");
}

describe("redactSensitiveData", () => {
  it("leaves normal text untouched", () => {
    expect(redactSensitiveData("Hello World!")).toBe("Hello World!");
    expect(redactSensitiveData("My name is John Doe")).toBe(
      "My name is John Doe",
    );
  });

  it("redacts OpenAI API keys", () => {
    const key = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF";
    expect(redactSensitiveData(`My key is ${key}`)).toBe(
      "My key is [REDACTED]",
    );
  });

  it("redacts local desk API keys", () => {
    const key = "desk-12345678-abcd-1234-abcd-1234567890ab";
    expect(redactSensitiveData(`Token: ${key}`)).toBe("Token: [REDACTED]");
  });

  it("redacts bearer tokens in headers", () => {
    expect(
      redactSensitiveData("Authorization: Bearer sk-12345678901234567890"),
    ).toBe("Authorization: Bearer [REDACTED]");
    expect(redactSensitiveData("Bearer someLongToken1234567890")).toBe(
      "Bearer [REDACTED]",
    );
  });

  it("redacts PEM private keys", () => {
    const rawPem = `-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Yg3V3...\n-----END RSA PRIVATE KEY-----`;
    expect(redactSensitiveData(rawPem)).toBe("[REDACTED PRIVATE KEY]");

    const ecPem = `-----BEGIN EC PRIVATE KEY-----\nMHQCAQEEIB...\n-----END EC PRIVATE KEY-----`;
    expect(redactSensitiveData(ecPem)).toBe("[REDACTED PRIVATE KEY]");
  });
});

describe("getApiServerKey secure fallback", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    (globalThis as SecureStorageTestGlobal).mockSafeStorage = safeStorageMock;
  });

  afterEach(() => {
    delete (globalThis as SecureStorageTestGlobal).mockSafeStorage;
    delete process.env.HERMES_HOME;
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("retrieves the API Server Key from desktop.json fallback when no env/config is present", async () => {
    const { getApiServerKey, writeDesktopConfig } = await freshConfig(TEST_DIR);

    // Write a key to desktop.json using writeDesktopConfig (which automatically encrypts it)
    writeDesktopConfig({
      apiServerKey: "fallback-secret-key-456",
    });

    // Verify getApiServerKey retrieves it
    const key = getApiServerKey();
    expect(key).toBe("fallback-secret-key-456");

    // Verify it was NOT migrated/copied to .env as plaintext
    const envFile = join(TEST_DIR, ".env");
    expect(existsSync(envFile)).toBe(false);
  });
});

describe("timingSafeTokenEqual (audit A5)", () => {
  it("accepts only the exact token", () => {
    expect(timingSafeTokenEqual("secret-token", "secret-token")).toBe(true);
    expect(timingSafeTokenEqual("secret-tokeN", "secret-token")).toBe(false);
    expect(timingSafeTokenEqual("secret-token-x", "secret-token")).toBe(false);
  });

  it("rejects empty/absent candidates and empty expected values", () => {
    expect(timingSafeTokenEqual(null, "secret")).toBe(false);
    expect(timingSafeTokenEqual(undefined, "secret")).toBe(false);
    expect(timingSafeTokenEqual("", "secret")).toBe(false);
    // An unset expected token must never match anything.
    expect(timingSafeTokenEqual("", "")).toBe(false);
    expect(timingSafeTokenEqual("anything", "")).toBe(false);
  });

  it("handles length mismatches without throwing", () => {
    expect(() =>
      timingSafeTokenEqual("short", "a-much-longer-token"),
    ).not.toThrow();
    expect(timingSafeTokenEqual("short", "a-much-longer-token")).toBe(false);
  });
});
