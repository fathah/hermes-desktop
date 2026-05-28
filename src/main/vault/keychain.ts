import { randomBytes, scryptSync, createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { safeStorage } from "electron";
import { HERMES_HOME } from "../installer";

const MASTER_KEY_FILE = join(HERMES_HOME, "desktop", "master.key.enc");
const SALT_PATH = join(HERMES_HOME, "desktop", "master.key.salt");
const KEY_ID = "key-v1";
const MASTER_KEY_BYTES = 32;

export type KeychainMode = "safeStorage" | "password";

let cachedMasterKey: Buffer | null = null;
let keychainMode: KeychainMode | null = null;

function ensureDesktopDir(): void {
  const dir = dirname(MASTER_KEY_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export function getKeychainMode(): KeychainMode {
  if (keychainMode) return keychainMode;
  return isEncryptionAvailable() ? "safeStorage" : "password";
}

export function isPasswordVaultConfigured(): boolean {
  return existsSync(SALT_PATH) && existsSync(MASTER_KEY_FILE);
}

export function isVaultUnlocked(): boolean {
  return cachedMasterKey !== null;
}

export function isVaultLocked(): boolean {
  return isPasswordVaultConfigured() && !isEncryptionAvailable() && !isVaultUnlocked();
}

export function getKeyId(): string {
  return KEY_ID;
}

/**
 * Derive a 32-byte master key from a user password (Linux headless fallback).
 */
export function deriveMasterKeyFromPassword(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, MASTER_KEY_BYTES);
}

function loadEncryptedMasterKeyFile(): Buffer | null {
  if (!existsSync(MASTER_KEY_FILE)) return null;
  return readFileSync(MASTER_KEY_FILE);
}

function saveEncryptedMasterKeyFile(data: Buffer): void {
  ensureDesktopDir();
  writeFileSync(MASTER_KEY_FILE, data, { mode: 0o600 });
}

function generateMasterKey(): Buffer {
  return randomBytes(MASTER_KEY_BYTES);
}

function decryptWithSafeStorage(blob: Buffer): Buffer {
  const decrypted = safeStorage.decryptString(blob);
  const key = Buffer.from(decrypted, "base64");
  if (key.length !== MASTER_KEY_BYTES) {
    throw new Error("Invalid master key length from keychain");
  }
  return key;
}

function encryptWithSafeStorage(key: Buffer): Buffer {
  return safeStorage.encryptString(key.toString("base64"));
}

/**
 * Initialize or load the vault master key. Uses OS keychain via safeStorage
 * when available; password fallback requires initVaultWithPassword first.
 */
export function initMasterKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey;

  if (isEncryptionAvailable()) {
    const existing = loadEncryptedMasterKeyFile();
    if (existing) {
      cachedMasterKey = decryptWithSafeStorage(existing);
      keychainMode = "safeStorage";
      return cachedMasterKey;
    }

    const key = generateMasterKey();
    saveEncryptedMasterKeyFile(encryptWithSafeStorage(key));
    cachedMasterKey = key;
    keychainMode = "safeStorage";
    return cachedMasterKey;
  }

  if (isPasswordVaultConfigured()) {
    throw new Error("Vault is locked. Unlock with initVaultWithPassword.");
  }

  throw new Error(
    "OS keychain not accessible. Call initVaultWithPassword before using the vault.",
  );
}

/**
 * Password fallback when safeStorage is unavailable (headless Linux, etc.).
 */
export function initVaultWithPassword(password: string): Buffer {
  ensureDesktopDir();

  let salt: Buffer;
  const existing = loadEncryptedMasterKeyFile();

  if (existsSync(SALT_PATH) && existing) {
    salt = readFileSync(SALT_PATH);
    const key = deriveMasterKeyFromPassword(password, salt);
    const check = createHash("sha256").update(key).digest();
    const storedCheck = existing.subarray(0, 32);
    if (!check.equals(storedCheck)) {
      throw new Error("Invalid master password");
    }
    cachedMasterKey = key;
    keychainMode = "password";
    return cachedMasterKey;
  }

  salt = randomBytes(16);
  writeFileSync(SALT_PATH, salt, { mode: 0o600 });
  const key = deriveMasterKeyFromPassword(password, salt);
  const check = createHash("sha256").update(key).digest();
  saveEncryptedMasterKeyFile(check);
  cachedMasterKey = key;
  keychainMode = "password";
  return cachedMasterKey;
}

export function rotateMasterKey(newKey?: Buffer): Buffer {
  const key = newKey || generateMasterKey();
  if (isEncryptionAvailable()) {
    saveEncryptedMasterKeyFile(encryptWithSafeStorage(key));
    keychainMode = "safeStorage";
  } else {
    throw new Error("Master key rotation requires OS keychain or re-init with password");
  }
  cachedMasterKey = key;
  return key;
}

export function wipeMasterKeyFromMemory(): void {
  if (cachedMasterKey) {
    cachedMasterKey.fill(0);
    cachedMasterKey = null;
  }
}

export function getMasterKeyForTest(key: Buffer): void {
  cachedMasterKey = key;
  keychainMode = "password";
}
