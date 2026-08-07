import type Database from "better-sqlite3";
import { basename } from "path";
import { getDbConnection } from "./db";
import type { DesktopProject } from "../shared/projects";

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
const PROJECTS_TABLE = "desktop_projects";

function ensureTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      session_id TEXT PRIMARY KEY,
      folder_path TEXT NOT NULL,
      updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
    );
  `);
}

function ensureProjectsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${PROJECTS_TABLE} (
      folder_path TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
      updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
    );
  `);
}

function tableExists(db: Database.Database): boolean {
  return tableExistsNamed(db, TABLE);
}

function tableExistsNamed(db: Database.Database, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table) as { name: string } | undefined;
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

  // A linked working folder is also a project. Keep a separate registry so
  // the folder remains in the sidebar after its final chat is moved/deleted.
  ensureProjectsTable(db);
  upsertProject(db, folder);
}

function upsertProject(
  db: Database.Database,
  folderPath: string,
  displayName?: string,
): DesktopProject {
  const name = displayName?.trim() || basename(folderPath) || folderPath;
  db.prepare(
    `INSERT INTO ${PROJECTS_TABLE} (folder_path, name, updated_at)
     VALUES (?, ?, strftime('%s', 'now'))
     ON CONFLICT(folder_path) DO UPDATE SET
       name = excluded.name,
       updated_at = excluded.updated_at`,
  ).run(folderPath, name);
  return { path: folderPath, name };
}

/** Register a local folder as a project independently of any conversation. */
export function addProject(
  folderPath: string,
  displayName?: string,
): DesktopProject | null {
  const path = folderPath.trim();
  if (!path) return null;
  const db = getDbConnection(false);
  if (!db) return null;
  ensureProjectsTable(db);
  return upsertProject(db, path, displayName);
}

/** List registered projects, including empty projects with no chats yet. */
export function listProjects(): DesktopProject[] {
  const db = getDbConnection(false);
  if (!db) return [];
  ensureProjectsTable(db);
  // One-time/lazy migration for projects that existed only as session folder
  // bindings before the independent registry was introduced.
  if (tableExists(db)) {
    const folders = db
      .prepare(
        `SELECT folder_path FROM ${TABLE} WHERE folder_path IS NOT NULL AND folder_path != '' GROUP BY folder_path`,
      )
      .all() as Array<{ folder_path: string }>;
    for (const { folder_path } of folders) {
      db.prepare(
        `INSERT OR IGNORE INTO ${PROJECTS_TABLE} (folder_path, name) VALUES (?, ?)`,
      ).run(folder_path, basename(folder_path) || folder_path);
    }
  }
  const rows = db
    .prepare(
      `SELECT folder_path, name FROM ${PROJECTS_TABLE} ORDER BY updated_at DESC, name COLLATE NOCASE`,
    )
    .all() as Array<{ folder_path: string; name: string }>;
  return rows.map((row) => ({ path: row.folder_path, name: row.name }));
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
