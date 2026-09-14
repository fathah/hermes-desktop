import type Database from "better-sqlite3";
import type { SessionModelOverride } from "../shared/model-override";
import { getDbConnection } from "./db";

/**
 * Desktop-owned, per-session store for the model/provider chosen from the
 * in-chat model picker. Only routing identity is stored; API keys remain in the
 * profile/global credential stores.
 */
const TABLE = "desktop_session_model_overrides";

function ensureTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      session_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      base_url TEXT NOT NULL DEFAULT '',
      updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
    );
  `);
}

function tableExists(db: Database.Database): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(TABLE) as { name: string } | undefined;
  return !!row;
}

export function setSessionModelOverride(
  sessionId: string,
  override: SessionModelOverride | null,
): void {
  if (!sessionId) return;
  const db = getDbConnection(false);
  if (!db) return;
  ensureTable(db);

  if (!override?.model) {
    db.prepare(`DELETE FROM ${TABLE} WHERE session_id = ?`).run(sessionId);
    return;
  }

  db.prepare(
    `INSERT INTO ${TABLE} (session_id, provider, model, base_url, updated_at)
     VALUES (?, ?, ?, ?, strftime('%s', 'now'))
     ON CONFLICT(session_id) DO UPDATE SET
       provider = excluded.provider,
       model = excluded.model,
       base_url = excluded.base_url,
       updated_at = excluded.updated_at`,
  ).run(sessionId, override.provider, override.model, override.baseUrl || "");
}

export function getSessionModelOverride(
  sessionId: string,
): SessionModelOverride | null {
  if (!sessionId) return null;
  const db = getDbConnection(true);
  if (!db || !tableExists(db)) return null;
  const row = db
    .prepare(
      `SELECT provider, model, base_url FROM ${TABLE} WHERE session_id = ?`,
    )
    .get(sessionId) as
    | { provider: string; model: string; base_url: string }
    | undefined;
  if (!row?.provider || !row.model) return null;
  return {
    provider: row.provider,
    model: row.model,
    baseUrl: row.base_url || "",
  };
}

export function deleteSessionModelOverrideForSession(
  db: Database.Database,
  sessionId: string,
): void {
  if (tableExists(db)) {
    db.prepare(`DELETE FROM ${TABLE} WHERE session_id = ?`).run(sessionId);
  }
}
