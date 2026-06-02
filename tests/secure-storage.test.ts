import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock Electron safeStorage module before importing config
let isEncryptionAvailableMock = true;

const safeStorageMock = {
  isEncryptionAvailable: () => isEncryptionAvailableMock,
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

describe("config secure secret storage", () => {
  beforeEach(() => {
    isEncryptionAvailableMock = true;
    (globalThis as SecureStorageTestGlobal).mockSafeStorage = safeStorageMock;
    vi.resetModules();
  });

  afterEach(() => {
    delete (globalThis as SecureStorageTestGlobal).mockSafeStorage;
  });

  it("encrypts secrets if safeStorage is available", async () => {
    const { encryptSecret, decryptSecret } = await import("../src/main/config");
    const plaintext = "super-secret-key-123";
    const encrypted = encryptSecret(plaintext);

    // Should be base64-encoded encrypted format
    expect(encrypted).not.toBe(plaintext);
    expect(
      Buffer.from(encrypted, "base64")
        .toString("utf-8")
        .startsWith("encrypted:"),
    ).toBe(true);

    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("falls back to raw string on decryption failure (legacy plain text keys)", async () => {
    const { decryptSecret } = await import("../src/main/config");
    const legacyPlaintext = "my-old-plaintext-api-key";

    // Decrypting raw plaintext should fail decryption internally but fall back to returning raw string
    const result = decryptSecret(legacyPlaintext);
    expect(result).toBe(legacyPlaintext);
  });

  it("does not encrypt if safeStorage is unavailable", async () => {
    isEncryptionAvailableMock = false;
    const { encryptSecret, decryptSecret } = await import("../src/main/config");

    const plaintext = "some-key";
    const encrypted = encryptSecret(plaintext);
    expect(encrypted).toBe(plaintext);

    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(plaintext);
  });
});
