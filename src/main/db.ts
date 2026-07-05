import Database from "better-sqlite3";
import { dirname } from "path";
import { existsSync, mkdirSync } from "fs";
import { activeStateDbPath } from "./utils";
import { formatLogError, log } from "./log";

let cachedDb: Database.Database | null = null;
let cachedDbPath: string | null = null;
let cachedDbReadonly = true;

export function getSharedDb(readonly = true): Database.Database | null {
  const dbPath = activeStateDbPath();
  if (!dbPath) {
    closeSharedDb();
    return null;
  }
  if (!existsSync(dbPath)) {
    if (readonly) {
      closeSharedDb();
      return null;
    }
    mkdirSync(dirname(dbPath), { recursive: true });
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
      log.error("db", {
        msg: "failed to open shared SQLite database connection",
        path: dbPath,
        error: formatLogError(err),
      });
      return null;
    }
  }

  return cachedDb;
}

export function initializeMetadataTable(db: Database.Database): void {
  try {
    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS messages_metadata (
        message_id INTEGER PRIMARY KEY,
        model TEXT,
        provider TEXT,
        council_group_id TEXT
      )
      `,
    ).run();

    const messagesTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='messages'",
      )
      .get();
    if (!messagesTable) return;

    db.prepare(
      `
      CREATE TRIGGER IF NOT EXISTS delete_message_metadata
      AFTER DELETE ON messages
      BEGIN
        DELETE FROM messages_metadata WHERE message_id = OLD.id;
      END;
      `,
    ).run();
  } catch (err) {
    log.error("db", {
      msg: "failed to initialize messages_metadata table/trigger",
      error: formatLogError(err),
    });
  }
}

export function initializeSkillsTable(db: Database.Database): void {
  if (typeof db.prepare !== "function") return;
  try {
    db.prepare(
      `
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
    `,
    ).run();
    initializeMetadataTable(db);
    initializeHealthRssTables(db);
  } catch (err) {
    log.error("db", {
      msg: "failed to initialize skills_registry table",
      error: formatLogError(err),
    });
  }
}

export function initializeHealthRssTables(db: Database.Database): void {
  if (typeof db.prepare !== "function") return;
  try {
    // 1. health_profiles
    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS health_profiles (
        id TEXT PRIMARY KEY,
        weight_goal_kg REAL,
        muscle_goal_kg REAL,
        active_conditions TEXT,
        med_and_supp_list TEXT,
        rss_feeds TEXT
      )
    `,
    ).run();

    // 2. journal_entries
    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS journal_entries (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        text_raw TEXT,
        voice_transcription TEXT,
        mood_score INTEGER CHECK(mood_score BETWEEN 1 AND 10),
        tags TEXT
      )
    `,
    ).run();

    // 3. journal_media
    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS journal_media (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        parsed_payload TEXT,
        FOREIGN KEY(entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE
      )
    `,
    ).run();

    // 4. biometric_ledger
    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS biometric_ledger (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        weight_kg REAL,
        skeletal_muscle_mass_kg REAL,
        body_fat_pct REAL,
        systolic_bp INTEGER,
        diastolic_bp INTEGER,
        fasting_glucose_mgdl REAL,
        sleep_duration_min INTEGER,
        sleep_deep_min INTEGER,
        sleep_score INTEGER,
        hrv_ms INTEGER
      )
    `,
    ).run();

    // 5. medication_protocols
    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS medication_protocols (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        substance_type TEXT NOT NULL,
        vial_size_mg REAL,
        diluent_ml REAL,
        dosage_unit TEXT NOT NULL,
        syringe_units_per_ml INTEGER DEFAULT 100,
        half_life_hours REAL,
        schedule_cron TEXT NOT NULL,
        titration_steps TEXT
      )
    `,
    ).run();

    // 6. medication_logs
    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS medication_logs (
        id TEXT PRIMARY KEY,
        protocol_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        dose_administered REAL NOT NULL,
        injection_site TEXT,
        side_effects TEXT,
        FOREIGN KEY(protocol_id) REFERENCES medication_protocols(id) ON DELETE CASCADE
      )
    `,
    ).run();

    // 7. medical_vault_docs
    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS medical_vault_docs (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        uploaded_at INTEGER NOT NULL,
        doc_type TEXT NOT NULL,
        ocr_content_text TEXT,
        extracted_biomarkers TEXT
      )
    `,
    ).run();

    // 8. rss_feeds
    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS rss_feeds (
        id TEXT PRIMARY KEY,
        url TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        site_url TEXT,
        description TEXT,
        category TEXT DEFAULT 'Uncategorized',
        icon_path TEXT,
        last_fetched_at INTEGER,
        refresh_interval_min INTEGER DEFAULT 60
      )
    `,
    ).run();

    // 9. rss_articles
    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS rss_articles (
        id TEXT PRIMARY KEY,
        feed_id TEXT NOT NULL,
        guid TEXT NOT NULL,
        title TEXT NOT NULL,
        author TEXT,
        url TEXT NOT NULL,
        published_at INTEGER NOT NULL,
        content_raw TEXT,
        content_text TEXT,
        summary_excerpt TEXT,
        read_status INTEGER DEFAULT 0,
        star_status INTEGER DEFAULT 0,
        relevance_score REAL DEFAULT 0.0,
        FOREIGN KEY(feed_id) REFERENCES rss_feeds(id) ON DELETE CASCADE,
        UNIQUE(feed_id, guid)
      )
    `,
    ).run();

    // 10. rss_articles_fts (using FTS5)
    db.prepare(
      `
      CREATE VIRTUAL TABLE IF NOT EXISTS rss_articles_fts USING fts5(
        title,
        content_text,
        content='rss_articles',
        content_rowid='rowid'
      )
    `,
    ).run();

    // FTS triggers
    db.prepare(
      `
      CREATE TRIGGER IF NOT EXISTS rss_articles_ai AFTER INSERT ON rss_articles BEGIN
        INSERT INTO rss_articles_fts(rowid, title, content_text) VALUES (new.rowid, new.title, new.content_text);
      END;
    `,
    ).run();

    db.prepare(
      `
      CREATE TRIGGER IF NOT EXISTS rss_articles_ad AFTER DELETE ON rss_articles BEGIN
        INSERT INTO rss_articles_fts(rss_articles_fts, rowid, title, content_text) VALUES('delete', old.rowid, old.title, old.content_text);
      END;
    `,
    ).run();

    db.prepare(
      `
      CREATE TRIGGER IF NOT EXISTS rss_articles_au AFTER UPDATE ON rss_articles BEGIN
        INSERT INTO rss_articles_fts(rss_articles_fts, rowid, title, content_text) VALUES('delete', old.rowid, old.title, old.content_text);
        INSERT INTO rss_articles_fts(rowid, title, content_text) VALUES (new.rowid, new.title, new.content_text);
      END;
    `,
    ).run();
  } catch (err) {
    log.error("db", {
      msg: "failed to initialize Health & RSS tables",
      error: formatLogError(err),
    });
  }
}

export function closeSharedDb(): void {
  if (cachedDb) {
    try {
      cachedDb.close();
    } catch (err) {
      log.error("db", {
        msg: "error closing shared database connection",
        path: cachedDbPath,
        error: formatLogError(err),
      });
    }
    cachedDb = null;
    cachedDbPath = null;
    cachedDbReadonly = true;
  }
}
