import Database from "better-sqlite3";
import { existsSync } from "fs";
import { activeStateDbPath } from "./utils";

let cachedDb: Database.Database | null = null;
let cachedDbPath: string | null = null;
let cachedDbReadonly = true;

export function getSharedDb(readonly = true): Database.Database | null {
  const dbPath = activeStateDbPath();
  if (!dbPath || !existsSync(dbPath)) {
    closeSharedDb();
    return null;
  }

  // Recycle connection if:
  // 1. Path has changed (e.g. profile switched)
  // 2. We need a write connection (readonly=false) but the cached one is readonly (readonly=true)
  if (
    cachedDb &&
    (cachedDbPath !== dbPath || (!readonly && cachedDbReadonly))
  ) {
    closeSharedDb();
  }

  if (!cachedDb) {
    try {
      cachedDb = new Database(dbPath, readonly ? { readonly: true } : {});
      cachedDbPath = dbPath;
      cachedDbReadonly = readonly;
      if (!readonly && typeof cachedDb.pragma === "function") {
        cachedDb.pragma("journal_mode = WAL");
        cachedDb.pragma("synchronous = NORMAL");
        initializeSkillsTable(cachedDb);
      }
    } catch (err) {
      console.error(
        "[db] Failed to open shared SQLite database connection:",
        err,
      );
      return null;
    }
  }

  return cachedDb;
}

export function initializeSkillsTable(db: Database.Database): void {
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS skills_registry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        description TEXT,
        keywords TEXT,
        status TEXT DEFAULT 'active',
        entrypoint TEXT,
        dependencies TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch (err) {
    console.error("[db] Failed to initialize skills_registry table:", err);
  }
}

export function closeSharedDb(): void {
  if (cachedDb) {
    try {
      cachedDb.close();
    } catch (err) {
      console.error("[db] Error closing shared database connection:", err);
    }
    cachedDb = null;
    cachedDbPath = null;
    cachedDbReadonly = true;
  }
}
