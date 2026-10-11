import Database from "better-sqlite3";
import { statSync } from "fs";
import { activeStateDbPath } from "./utils";
import {
  conversationPredicate,
  listableSessionChildPredicate,
} from "./session-conversation";

let cachedDb: Database.Database | null = null;
let cachedDbPath: string | null = null;
let cachedDbReadonly: boolean | null = null;
let cachedDbIdentity: string | null = null;

/** A file generation changes on replacement, unlike normal SQLite writes. */
export function stateDbFileIdentity(dbPath: string): string | null {
  try {
    const stats = statSync(dbPath, { bigint: true });
    return stats.isFile()
      ? `${stats.dev}:${stats.ino}:${stats.birthtimeNs}`
      : null;
  } catch {
    return null;
  }
}

/** Older Agent databases predate native archiving; keep their lists readable. */
export function sessionVisibilityPredicate(db: Database.Database): string {
  const columns = db.prepare("PRAGMA table_info(sessions)").all() as Array<{
    name: string;
  }>;
  return columns.some((column) => column.name === "archived")
    ? "s.archived = 0"
    : "1 = 1";
}

/**
 * Shared local/cache conversation rule. Native delegation markers stay hidden
 * after parent removal; user-visible branch/reset children remain listable.
 */
export function conversationListPredicate(db: Database.Database): string {
  const columns = db.prepare("PRAGMA table_info(sessions)").all() as Array<{
    name: string;
  }>;
  const hasExclusions = !!db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'desktop_session_conversation_exclusions'",
    )
    .get();
  return conversationPredicate(
    columns.map((column) => column.name),
    hasExclusions,
  );
}

/** Keep an unselected hidden child's classification when its parent is removed. */
export function preserveHiddenSessionChildren(
  db: Database.Database,
  sessionId: string,
): void {
  const columns = db.prepare("PRAGMA table_info(sessions)").all() as Array<{
    name: string;
  }>;
  const names = columns.map((column) => column.name);
  if (!names.includes("parent_session_id")) return;
  const rows = db
    .prepare(
      `SELECT s.id FROM sessions s WHERE s.parent_session_id = ? AND NOT (${listableSessionChildPredicate(names)})`,
    )
    .all(sessionId) as Array<{ id: string }>;
  if (!rows.length) return;
  // A desktop-owned overlay avoids relabeling legacy Agent model_config or
  // changing its schema version. Foreign-key cleanup follows the child row.
  db.exec(
    "CREATE TABLE IF NOT EXISTS desktop_session_conversation_exclusions (session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE)",
  );
  const insert = db.prepare(
    "INSERT OR IGNORE INTO desktop_session_conversation_exclusions(session_id) VALUES (?)",
  );
  for (const row of rows) insert.run(row.id);
}

/**
 * Return a cached database connection for the active profile state DB.
 * If the active profile database path or readonly status changes,
 * the old database connection is cleanly closed and a new one is established.
 */
export function getDbConnection(
  readonly = true,
  profile?: unknown,
): Database.Database | null {
  const dbPath = activeStateDbPath(profile);
  const identity = stateDbFileIdentity(dbPath);
  if (!identity) {
    closeDbConnection();
    return null;
  }

  // Reuse the existing cached connection if the path and mode match
  if (
    cachedDb &&
    cachedDbPath === dbPath &&
    cachedDbReadonly === readonly &&
    cachedDbIdentity === identity
  ) {
    return cachedDb;
  }

  closeDbConnection();

  try {
    cachedDb = new Database(dbPath, readonly ? { readonly: true } : {});
    cachedDbPath = dbPath;
    cachedDbReadonly = readonly;
    cachedDbIdentity = identity;
    return cachedDb;
  } catch (err) {
    console.error(`[db] Failed to open database at ${dbPath}:`, err);
    return null;
  }
}

/**
 * Close the cached database connection if open.
 */
export function closeDbConnection(): void {
  if (cachedDb) {
    try {
      cachedDb.close();
    } catch (err) {
      console.error("[db] Error closing database connection:", err);
    }
    cachedDb = null;
    cachedDbPath = null;
    cachedDbReadonly = null;
    cachedDbIdentity = null;
  }
}
