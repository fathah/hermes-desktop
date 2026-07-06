import type Database from "better-sqlite3";
import { getDbConnection } from "./db";

/**
 * Desktop-owned, per-session store for the working folder the user links to a
 * conversation (issue #27). The folder is a desktop-only UI binding — the agent
 * receives it per message as a context-folder system message — so it isn't part
 * of hermes-agent's session schema. Persisting it here lets a re-opened session
 * restore its linked folder instead of losing it when the app restarts.
 *
 * Mirrors the [[src/main/session-continuation-store.ts]] pattern: a desktop
 * table in the active profile's state.db, keyed by `session_id`.
 */
const TABLE = "desktop_session_context_folders";

function ensureTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      session_id TEXT PRIMARY KEY,
      folder_path TEXT NOT NULL,
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

/**
 * Persist (or clear) the folder linked to a session. A null/empty folder
 * removes the row so an unlinked session doesn't restore a stale path.
 */
export function setSessionContextFolder(
  sessionId: string,
  folder: string | null,
): void {
  if (!sessionId) return;
  const db = getDbConnection(false);
  if (!db) return;
  ensureTable(db);

  if (!folder) {
    db.prepare(`DELETE FROM ${TABLE} WHERE session_id = ?`).run(sessionId);
    return;
  }

  db.prepare(
    `INSERT INTO ${TABLE} (session_id, folder_path, updated_at)
     VALUES (?, ?, strftime('%s', 'now'))
     ON CONFLICT(session_id) DO UPDATE SET
       folder_path = excluded.folder_path,
       updated_at = excluded.updated_at`,
  ).run(sessionId, folder);
}

/** Read the folder linked to a session, or null when none is stored. */
export function getSessionContextFolder(sessionId: string): string | null {
  if (!sessionId) return null;
  const db = getDbConnection(true);
  if (!db || !tableExists(db)) return null;
  const row = db
    .prepare(`SELECT folder_path FROM ${TABLE} WHERE session_id = ?`)
    .get(sessionId) as { folder_path: string } | undefined;
  return row?.folder_path || null;
}

/**
 * Batch-read the folders linked to many sessions in a single pass: one
 * `tableExists` check and one chunked `IN (...)` query instead of two queries
 * per session. Used by the session cache so attaching folders to a full page
 * of rows stays a couple of queries rather than O(N). Sessions with no linked
 * folder are simply absent from the returned map.
 */
export function getSessionContextFolders(
  sessionIds: string[],
): Map<string, string> {
  const result = new Map<string, string>();
  if (sessionIds.length === 0) return result;
  const db = getDbConnection(true);
  if (!db || !tableExists(db)) return result;

  // Chunk well under SQLITE_MAX_VARIABLE_NUMBER for portability, matching the
  // batching used elsewhere in the session cache.
  const CHUNK = 500;
  for (let i = 0; i < sessionIds.length; i += CHUNK) {
    const chunk = sessionIds.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT session_id, folder_path FROM ${TABLE} WHERE session_id IN (${placeholders})`,
      )
      .all(...chunk) as Array<{ session_id: string; folder_path: string }>;
    for (const r of rows) {
      if (r.folder_path) result.set(r.session_id, r.folder_path);
    }
  }
  return result;
}

/**
 * Drop a session's linked-folder row. Called from `deleteSessionRows` so it
 * runs inside the same delete transaction as the other per-session cleanup.
 */
export function deleteSessionContextFolderForSession(
  db: Database.Database,
  sessionId: string,
): void {
  if (tableExists(db)) {
    db.prepare(`DELETE FROM ${TABLE} WHERE session_id = ?`).run(sessionId);
  }
}

/** Get recent distinct context folder paths ordered by most recently updated. */
export function getRecentSessionContextFolders(limit = 20): string[] {
  const db = getDbConnection(true);
  if (!db || !tableExists(db)) return [];
  // GROUP BY (not DISTINCT) so each folder appears once ordered by its most
  // recent use. A `DISTINCT folder_path ... ORDER BY updated_at` collapses the
  // duplicates but then orders by an arbitrary one of each path's rows, so a
  // folder reused recently could sort as if it were old.
  const rows = db
    .prepare(
      `SELECT folder_path FROM ${TABLE} WHERE folder_path IS NOT NULL AND folder_path != '' GROUP BY folder_path ORDER BY MAX(updated_at) DESC LIMIT ?`,
    )
    .all(limit) as Array<{ folder_path: string }>;
  return rows.map((r) => r.folder_path);
}
