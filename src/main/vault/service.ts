import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { existsSync, readFileSync, renameSync, unlinkSync } from "fs";
import {
  initMasterKey,
  getKeyId,
  isVaultLocked,
  rotateMasterKey as rotateKeychainKey,
  wipeMasterKeyFromMemory,
} from "./keychain";
import {
  openVaultStore,
  insertSecret,
  getSecretById,
  listSecretsForProfile,
  findSecretByProfileAndEnvKey,
  listAllSecrets,
  updateSecret,
  deleteSecret,
  deleteSecretsForProfile,
  getAuditLog,
  countSecrets,
  VAULT_DB_PATH,
  type SecretRow,
} from "./store";
import {
  mergeEnv,
  parseEnvFile,
  stripManagedKeys,
  isImportableEnvKey,
} from "./env";
import { profilePaths, safeWriteFile } from "../utils";
import { buildCredentialPoolEntry, getCredentialPool, setCredentialPool } from "../config";
import { expectedEnvKeyForModel } from "../installer";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

/** Provider id or env var name → canonical env var for .env sync */
const PROVIDER_ENV_MAP: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  google: "GOOGLE_API_KEY",
  groq: "GROQ_API_KEY",
  together: "TOGETHER_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  mistral: "MISTRAL_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  huggingface: "HF_TOKEN",
  hf: "HF_TOKEN",
  firecrawl: "FIRECRAWL_API_KEY",
  fal: "FAL_KEY",
  browserbase: "BROWSERBASE_API_KEY",
  browserbase_api_key: "BROWSERBASE_API_KEY",
  telegram: "TELEGRAM_BOT_TOKEN",
  discord: "DISCORD_BOT_TOKEN",
  slack: "SLACK_BOT_TOKEN",
};

export interface VaultCredentialMeta {
  id: string;
  provider: string;
  label: string;
  maskedValue: string;
}

export interface EncryptedPayload {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

let initialized = false;

export function initVault(): void {
  if (initialized) return;
  try {
    initMasterKey();
  } catch (err) {
    if (isVaultLocked()) {
      openVaultStore();
      initialized = true;
      return;
    }
    throw err;
  }
  openVaultStore();
  initialized = true;
}

export function resolveEnvKey(provider: string, baseUrl?: string): string {
  const lower = provider.trim().toLowerCase();
  if (PROVIDER_ENV_MAP[lower]) return PROVIDER_ENV_MAP[lower];
  if (lower.endsWith("_api_key") || lower.endsWith("_key")) {
    return provider.toUpperCase();
  }
  if (baseUrl) {
    const fromUrl = expectedEnvKeyForModel(provider, baseUrl);
    if (fromUrl) return fromUrl;
  }
  return `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
}

export function maskSecret(value: string): string {
  if (!value) return "••••";
  if (value.length <= 4) return "••••";
  return "••••" + value.slice(-4);
}

function encrypt(plaintext: string, masterKey: Buffer): EncryptedPayload {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, masterKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return { ciphertext: encrypted, iv, authTag };
}

function decrypt(row: SecretRow, masterKey: Buffer): string {
  const decipher = createDecipheriv(ALGO, masterKey, row.iv);
  decipher.setAuthTag(row.auth_tag);
  return (
    decipher.update(row.ciphertext, undefined, "utf8") + decipher.final("utf8")
  );
}

export function addCredential(
  profile: string,
  provider: string,
  label: string,
  value: string,
  envKey?: string,
): { id: string; provider: string; label: string } {
  initVault();
  const masterKey = initMasterKey();
  const { ciphertext, iv, authTag } = encrypt(value, masterKey);
  const row = insertSecret(
    profile,
    provider,
    label,
    ciphertext,
    iv,
    authTag,
    getKeyId(),
    value.length > 4 ? value.slice(-4) : "",
    envKey,
  );
  return { id: row.id, provider: row.provider, label: row.label };
}

export function getCredentials(profile: string): VaultCredentialMeta[] {
  initVault();
  const rows = listSecretsForProfile(profile);
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    label: row.label,
    maskedValue: row.masked_suffix ? `••••${row.masked_suffix}` : "••••",
  }));
}

export function updateCredential(
  id: string,
  updates: { label?: string; value?: string },
): void {
  initVault();
  const existing = getSecretById(id);
  if (!existing) throw new Error("Secret not found");

  if (updates.value !== undefined) {
    const masterKey = initMasterKey();
    const { ciphertext, iv, authTag } = encrypt(updates.value, masterKey);
    updateSecret(id, {
      label: updates.label,
      ciphertext,
      iv,
      authTag,
      maskedSuffix: updates.value.length > 4 ? updates.value.slice(-4) : "",
    });
  } else if (updates.label !== undefined) {
    updateSecret(id, { label: updates.label });
  }
}

export function removeCredential(id: string): void {
  initVault();
  deleteSecret(id);
}

export function credentialBelongsToProfile(id: string, profile: string): boolean {
  initVault();
  return getSecretById(id)?.profile === profile;
}

export function getCredentialAuditLog(
  profile: string,
): Array<{
  id: string;
  action: string;
  provider: string;
  label: string;
  changedAt: string;
}> {
  initVault();
  return getAuditLog(profile).map((a) => ({
    id: a.id,
    action: a.action,
    provider: a.provider,
    label: a.label,
    changedAt: a.changed_at,
  }));
}

function upsertCredentialByEnvKey(
  profile: string,
  provider: string,
  label: string,
  value: string,
  envKey: string,
): void {
  initVault();
  const existing = findSecretByProfileAndEnvKey(profile, envKey);
  if (existing) {
    updateCredential(existing.id, { label, value });
    return;
  }
  addCredential(profile, provider, label, value, envKey);
}

function atomicWrite(path: string, content: string): void {
  const tempPath = `${path}.tmp`;
  safeWriteFile(tempPath, content);
  renameSync(tempPath, path);
}

/**
 * Decrypt vault entries for profile and merge managed keys into plaintext .env
 * for Hermes Agent to consume.
 */
export function activateProfile(profile: string): void {
  initVault();
  const masterKey = initMasterKey();
  const rows = listSecretsForProfile(profile);
  const { envFile } = profilePaths(profile);
  const managed = new Map<string, string>();
  const poolUpdates: Record<string, string> = {};

  for (const meta of rows) {
    const row = getSecretById(meta.id)!;
    const plaintext = decrypt(row, masterKey);
    const envKey = row.env_key ?? resolveEnvKey(row.provider);
    managed.set(envKey, plaintext);
    poolUpdates[row.provider] = plaintext;
  }

  if (managed.size > 0) {
    const existing = existsSync(envFile) ? readFileSync(envFile, "utf-8") : "";
    atomicWrite(envFile, mergeEnv(existing, managed));
  }

  for (const [provider, apiKey] of Object.entries(poolUpdates)) {
    const existing = getCredentialPool(profile)[provider] || [];
    const entry = buildCredentialPoolEntry(provider, apiKey, provider, existing);
    setCredentialPool(provider, [entry, ...existing.filter((e) => e.id !== entry.id)], profile);
  }
}

export function deactivateProfile(profile: string, wipe = false): void {
  if (!wipe) return;
  const { envFile } = profilePaths(profile);
  if (existsSync(envFile)) unlinkSync(envFile);
}

export function removeProfileSecrets(profile: string): number {
  initVault();
  return deleteSecretsForProfile(profile);
}

/**
 * Copy all vault credentials from one profile to another (decrypt + re-encrypt).
 */
export function copyProfileSecrets(
  sourceProfile: string,
  targetProfile: string,
): number {
  initVault();
  const masterKey = initMasterKey();
  const rows = listSecretsForProfile(sourceProfile);
  let count = 0;
  for (const meta of rows) {
    const row = getSecretById(meta.id)!;
    const plaintext = decrypt(row, masterKey);
    addCredential(targetProfile, row.provider, row.label, plaintext, row.env_key || undefined);
    count++;
  }
  return count;
}

export function rotateMasterKey(): { success: boolean; entriesRotated: number } {
  initVault();
  const oldKey = initMasterKey();
  const newKey = rotateKeychainKey();
  const all = listAllSecrets();
  let count = 0;

  for (const row of all) {
    const plaintext = decrypt(row, oldKey);
    const { ciphertext, iv, authTag } = encrypt(plaintext, newKey);
    updateSecret(row.id, { ciphertext, iv, authTag });
    count++;
  }

  oldKey.fill(0);
  return { success: true, entriesRotated: count };
}

export function exportVaultBlob(): Buffer {
  initVault();
  return readFileSync(VAULT_DB_PATH);
}

export function vaultIsPopulated(): boolean {
  try {
    initVault();
    return countSecrets() > 0;
  } catch {
    return false;
  }
}

export function parseEnvFileAsRecord(content: string): Record<string, string> {
  return Object.fromEntries(parseEnvFile(content));
}

export function envKeyToProvider(envKey: string): string {
  const lower = envKey.toLowerCase();
  for (const [provider, key] of Object.entries(PROVIDER_ENV_MAP)) {
    if (key === envKey) return provider;
  }
  if (lower.endsWith("_api_key")) {
    return lower.replace(/_api_key$/, "").replace(/_/g, "-");
  }
  if (lower.endsWith("_key")) {
    return lower.replace(/_key$/, "").replace(/_/g, "-");
  }
  return lower.replace(/_/g, "-");
}

export function migratePlaintextEnv(
  profile: string,
  envContent?: string,
): number {
  initVault();
  const { envFile } = profilePaths(profile);
  const content =
    envContent ?? (existsSync(envFile) ? readFileSync(envFile, "utf-8") : "");
  const parsed = parseEnvFile(content);
  let count = 0;
  const migratedKeys: string[] = [];

  for (const [envKey, value] of parsed) {
    if (!isImportableEnvKey(envKey) || !value) continue;
    const provider = envKeyToProvider(envKey);
    upsertCredentialByEnvKey(profile, provider, envKey, value, envKey);
    migratedKeys.push(envKey);
    count++;
  }

  if (!envContent && migratedKeys.length > 0 && existsSync(envFile)) {
    const stripped = stripManagedKeys(readFileSync(envFile, "utf-8"), migratedKeys);
    atomicWrite(envFile, stripped);
  }

  return count;
}

export function shutdownVault(): void {
  wipeMasterKeyFromMemory();
  initialized = false;
}
