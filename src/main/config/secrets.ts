let safeStorage: typeof import("electron").safeStorage | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  safeStorage = require("electron").safeStorage;
} catch {
  // Not running inside an Electron environment (e.g. unit tests)
}

type MockSafeStorageGlobal = typeof globalThis & {
  mockSafeStorage?: typeof safeStorage;
};

function getSafeStorage(): typeof safeStorage {
  return (globalThis as MockSafeStorageGlobal).mockSafeStorage ?? safeStorage;
}

export function isSecretEncryptionAvailable(): boolean {
  const storage = getSafeStorage();
  return !!storage?.isEncryptionAvailable();
}

export function encryptSecret(secret: string): string {
  if (!secret) return "";
  const storage = getSafeStorage();
  if (storage && storage.isEncryptionAvailable()) {
    try {
      return storage.encryptString(secret).toString("base64");
    } catch (err) {
      console.error("[Security] Failed to encrypt secret:", err);
    }
  }
  return secret;
}

export function canDecryptSecret(payload: string): boolean {
  if (!payload) return false;
  const storage = getSafeStorage();
  if (!storage || !storage.isEncryptionAvailable()) return false;
  try {
    storage.decryptString(Buffer.from(payload, "base64"));
    return true;
  } catch {
    return false;
  }
}

export function decryptSecret(payload: string): string {
  if (!payload) return "";
  const storage = getSafeStorage();
  if (storage && storage.isEncryptionAvailable()) {
    try {
      const buffer = Buffer.from(payload, "base64");
      return storage.decryptString(buffer);
    } catch {
      // Fallback for legacy plaintext values
      return payload;
    }
  }
  return payload;
}
