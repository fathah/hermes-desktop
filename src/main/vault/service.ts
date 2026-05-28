import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { existsSync, readFileSync, renameSync, unlinkSync } from "fs";
import { join } from "path";
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
  listAllSecrets,
  updateSecret,
  deleteSecret,
  deleteSecretsForProfile,
  getAuditLog,
  countSecrets,
  VAULT_DB_PATH,
  type SecretRow,
} from "./store";
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
  );
  return { id: row.id, provider: row.provider, label: row.label };
}

export function getCredentials(profile: string): VaultCredentialMeta[] {
  initVault();
  const masterKey = initMasterKey();
  const rows = listSecretsForProfile(profile);
  return rows.map((row) => {
    const full = getSecretById(row.id)!;
    let masked = "••••";
    try {
      masked = maskSecret(decrypt(full, masterKey));
    } catch {
      masked = "••••????";
    }
    return {
      id: row.id,
      provider: row.provider,
      label: row.label,
      maskedValue: masked,
    };
  });
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
    });
  } else if (updates.label !== undefined) {
    updateSecret(id, { label: updates.label });
  }
}

export function removeCredential(id: string): void {
  initVault();
  deleteSecret(id);
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

function buildEnvContent(
  entries: Array<{ envKey: string; value: string }>,
): string {
  const lines = [
    "# Managed by Hermes Workspace — do not edit manually",
    "# Secrets are encrypted in vault.db and synced on profile activation",
    "",
  ];
  for (const { envKey, value } of entries) {
    lines.push(`${envKey}=${value}`);
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}

function atomicWrite(path: string, content: string): void {
  const tempPath = `${path}.tmp`;
  safeWriteFile(tempPath, content);
  renameSync(tempPath, path);
}

/**
 * Decrypt vault entries for profile and write plaintext .env + auth.json
 * for Hermes Agent to consume.
 */
export function activateProfile(profile: string): void {
  initVault();
  const masterKey = initMasterKey();
  const rows = listSecretsForProfile(profile);
  const { envFile } = profilePaths(profile);
  const envEntries: Array<{ envKey: string; value: string }> = [];
  const poolUpdates: Record<string, string> = {};

  for (const meta of rows) {
    const row = getSecretById(meta.id)!;
    const plaintext = decrypt(row, masterKey);
    const envKey = resolveEnvKey(row.provider);
    envEntries.push({ envKey, value: plaintext });
    poolUpdates[row.provider] = plaintext;
  }

  if (envEntries.length > 0) {
    atomicWrite(envFile, buildEnvContent(envEntries));
  }

  for (const [provider, apiKey] of Object.entries(poolUpdates)) {
    const existing = getCredentialPool(profile)[provider] || [];
    const entry = buildCredentialPoolEntry(provider, apiKey, provider, existing);
    setCredentialPool(provider, [entry, ...existing.filter((e) => e.id !== entry.id)], profile);
  }
}

export function deactivateProfile(profile: string, wipe = false): void {
  if (!wipe) return;
  const { envFile, home } = profilePaths(profile);
  const authFile = join(home, "auth.json");
  if (existsSync(envFile)) unlinkSync(envFile);
  if (existsSync(authFile)) unlinkSync(authFile);
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
    addCredential(targetProfile, row.provider, row.label, plaintext);
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

export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (/^[A-Z][A-Z0-9_]*$/.test(key) && value) {
      result[key] = value.replace(/^["']|["']$/g, "");
    }
  }
  return result;
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
  envContent: string,
): number {
  initVault();
  const parsed = parseEnvFile(envContent);
  let count = 0;
  for (const [envKey, value] of Object.entries(parsed)) {
    const provider = envKeyToProvider(envKey);
    addCredential(profile, provider, envKey, value);
    count++;
  }
  return count;
}

export function shutdownVault(): void {
  wipeMasterKeyFromMemory();
  initialized = false;
}
