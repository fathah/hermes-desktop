import { join } from "path";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from "fs";
import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { HERMES_HOME } from "../installer";
import { getKeyId } from "./keychain";

export const VAULT_DB_PATH = join(HERMES_HOME, "desktop", "vault.db");

export interface SecretRow {
  id: string;
  profile: string;
  provider: string;
  label: string;
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  masked_suffix: string;
  env_key: string | null;
  created_at: string;
  updated_at: string;
  key_id: string;
}

export interface SecretListItem {
  id: string;
  profile: string;
  provider: string;
  label: string;
  masked_suffix: string;
  env_key: string | null;
  created_at: string;
  updated_at: string;
  key_id: string;
}

export interface AuditRow {
  id: string;
  secret_id: string;
  action: "added" | "updated" | "deleted" | "rotated";
  profile: string;
  provider: string;
  label: string;
  changed_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS secrets (
  id            TEXT PRIMARY KEY,
  profile       TEXT NOT NULL,
  provider      TEXT NOT NULL,
  label         TEXT NOT NULL DEFAULT '',
  ciphertext    BLOB NOT NULL,
  iv            BLOB NOT NULL,
  auth_tag      BLOB NOT NULL,
  masked_suffix TEXT NOT NULL DEFAULT '',
  env_key       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  key_id        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_secrets_profile ON secrets(profile);

CREATE TABLE IF NOT EXISTS keychain_mapping (
  key_id  TEXT PRIMARY KEY,
  created TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credential_audit (
  id TEXT PRIMARY KEY,
  secret_id TEXT NOT NULL,
  action TEXT NOT NULL,
  profile TEXT NOT NULL,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_secret_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_secret ON credential_audit(secret_id);
CREATE INDEX IF NOT EXISTS idx_audit_profile ON credential_audit(profile);
`;

let db: Database.Database | null = null;

function ensureDir(): void {
  const dir = join(HERMES_HOME, "desktop");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // best effort on Windows
  }
}

function ensurePrivateFile(path: string): void {
  if (!existsSync(path)) {
    closeSync(openSync(path, "a", 0o600));
  }
  try {
    chmodSync(path, 0o600);
  } catch {
    // best effort on Windows
  }
}

function hardenVaultFiles(): void {
  for (const path of [VAULT_DB_PATH, `${VAULT_DB_PATH}-wal`, `${VAULT_DB_PATH}-shm`]) {
    if (!existsSync(path)) continue;
    try {
      chmodSync(path, 0o600);
    } catch {
      // best effort on Windows
    }
  }
}

function ensureColumns(database: Database.Database): void {
  const secretColumns = new Set(
    (database.pragma("table_info(secrets)") as Array<{ name: string }>).map(
      (c) => c.name,
    ),
  );
  if (!secretColumns.has("masked_suffix")) {
    database.exec("ALTER TABLE secrets ADD COLUMN masked_suffix TEXT NOT NULL DEFAULT ''");
  }
  if (!secretColumns.has("env_key")) {
    database.exec("ALTER TABLE secrets ADD COLUMN env_key TEXT");
  }
}

export function openVaultStore(): Database.Database {
  if (db) return db;
  ensureDir();
  ensurePrivateFile(VAULT_DB_PATH);
  db = new Database(VAULT_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  ensureColumns(db);
  hardenVaultFiles();

  const integrity = db.pragma("integrity_check", { simple: true }) as string;
  if (integrity !== "ok") {
    throw new Error(`Vault database corrupted: ${integrity}`);
  }

  const keyId = getKeyId();
  db.prepare(
    "INSERT OR IGNORE INTO keychain_mapping (key_id) VALUES (?)",
  ).run(keyId);

  return db;
}

export function closeVaultStore(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function resetVaultStoreForTest(): void {
  closeVaultStore();
}

export function insertSecret(
  profile: string,
  provider: string,
  label: string,
  ciphertext: Buffer,
  iv: Buffer,
  authTag: Buffer,
  keyId: string,
  maskedSuffix: string,
  envKey?: string | null,
): SecretRow {
  const database = openVaultStore();
  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO secrets (id, profile, provider, label, ciphertext, iv, auth_tag, key_id, masked_suffix, env_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, profile, provider, label, ciphertext, iv, authTag, keyId, maskedSuffix, envKey ?? null);

  insertAudit(id, "added", profile, provider, label);
  return getSecretById(id)!;
}

export function getSecretById(id: string): SecretRow | null {
  const database = openVaultStore();
  return (
    (database
      .prepare("SELECT * FROM secrets WHERE id = ?")
      .get(id) as SecretRow | undefined) ?? null
  );
}

export function listSecretsForProfile(profile: string): SecretListItem[] {
  const database = openVaultStore();
  return database
    .prepare(
      `SELECT id, profile, provider, label, created_at, updated_at, key_id
              , masked_suffix, env_key
       FROM secrets WHERE profile = ? ORDER BY provider, label`,
    )
    .all(profile) as SecretListItem[];
}

export function findSecretByProfileAndEnvKey(
  profile: string,
  envKey: string,
): SecretListItem | null {
  const database = openVaultStore();
  return (
    (database
      .prepare(
        `SELECT id, profile, provider, label, created_at, updated_at, key_id
                , masked_suffix, env_key
         FROM secrets WHERE profile = ? AND env_key = ?`,
      )
      .get(profile, envKey) as SecretListItem | undefined) ?? null
  );
}

export function listAllSecrets(): SecretRow[] {
  const database = openVaultStore();
  return database.prepare("SELECT * FROM secrets ORDER BY profile, provider").all() as SecretRow[];
}

export function updateSecret(
  id: string,
  updates: {
    label?: string;
    ciphertext?: Buffer;
    iv?: Buffer;
    authTag?: Buffer;
    maskedSuffix?: string;
    envKey?: string | null;
  },
): void {
  const existing = getSecretById(id);
  if (!existing) throw new Error("Secret not found");

  const database = openVaultStore();
  const label = updates.label ?? existing.label;
  const ciphertext = updates.ciphertext ?? existing.ciphertext;
  const iv = updates.iv ?? existing.iv;
  const authTag = updates.authTag ?? existing.auth_tag;
  const maskedSuffix = updates.maskedSuffix ?? existing.masked_suffix;
  const envKey = updates.envKey ?? existing.env_key;

  database
    .prepare(
      `UPDATE secrets SET label = ?, ciphertext = ?, iv = ?, auth_tag = ?,
       masked_suffix = ?, env_key = ?,
       updated_at = datetime('now') WHERE id = ?`,
    )
    .run(label, ciphertext, iv, authTag, maskedSuffix, envKey, id);

  insertAudit(id, "updated", existing.profile, existing.provider, label);
}

export function deleteSecret(id: string): void {
  const existing = getSecretById(id);
  if (!existing) return;

  const database = openVaultStore();
  insertAudit(id, "deleted", existing.profile, existing.provider, existing.label);
  database.prepare("DELETE FROM secrets WHERE id = ?").run(id);
}

export function deleteSecretsForProfile(profile: string): number {
  const database = openVaultStore();
  const rows = listSecretsForProfile(profile);
  for (const row of rows) {
    insertAudit(row.id, "deleted", row.profile, row.provider, row.label);
  }
  const result = database
    .prepare("DELETE FROM secrets WHERE profile = ?")
    .run(profile);
  return result.changes;
}

function insertAudit(
  secretId: string,
  action: AuditRow["action"],
  profile: string,
  provider: string,
  label: string,
): void {
  const database = openVaultStore();
  database
    .prepare(
      `INSERT INTO credential_audit (id, secret_id, action, profile, provider, label)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), secretId, action, profile, provider, label);
}

export function getAuditLog(profile?: string, limit = 100): AuditRow[] {
  const database = openVaultStore();
  if (profile) {
    return database
      .prepare(
        `SELECT * FROM credential_audit WHERE profile = ?
         ORDER BY changed_at DESC LIMIT ?`,
      )
      .all(profile, limit) as AuditRow[];
  }
  return database
    .prepare(
      "SELECT * FROM credential_audit ORDER BY changed_at DESC LIMIT ?",
    )
    .all(limit) as AuditRow[];
}

export function countSecrets(): number {
  const database = openVaultStore();
  const row = database
    .prepare("SELECT COUNT(*) as c FROM secrets")
    .get() as { c: number };
  return row.c;
}
