import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { HERMES_HOME } from "./installer";
import { safeWriteFile } from "./utils";
import Database from "better-sqlite3";

const CACHE_DIR = join(HERMES_HOME, "desktop");
const CACHE_FILE = join(CACHE_DIR, "sessions.json");
const DB_PATH = join(HERMES_HOME, "state.db");

export interface CachedSession {
  id: string;
  title: string;
  startedAt: number;
  source: string;
  messageCount: number;
  model: string;
}

interface CacheData {
  sessions: CachedSession[];
  lastSync: number;
}

// Generate a short, readable title from the first user message (like ChatGPT/Claude)
function generateTitle(message: string): string {
  if (!message || !message.trim()) return "New conversation";

  // Clean up the message
  let text = message.trim();

  // Remove markdown formatting
  text = text.replace(/[#*_`~\[\]()]/g, "");
  // Remove URLs
  text = text.replace(/https?:\/\/\S+/g, "");
  // Remove extra whitespace
  text = text.replace(/\s+/g, " ").trim();

  if (!text) return "New conversation";

  // If short enough, use as-is
  if (text.length <= 50) return text;

  // Take first meaningful chunk — aim for ~40-50 chars at word boundary
  const words = text.split(" ");
  let title = "";
  for (const word of words) {
    if ((title + " " + word).trim().length > 45) break;
    title = (title + " " + word).trim();
  }

  return title || text.slice(0, 45) + "...";
}

function readCache(): CacheData {
  try {
    if (!existsSync(CACHE_FILE)) return { sessions: [], lastSync: 0 };
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
  } catch {
    return { sessions: [], lastSync: 0 };
  }
}

function writeCache(data: CacheData): void {
  try {
    safeWriteFile(CACHE_FILE, JSON.stringify(data));
  } catch {
    // non-fatal
  }
}

function getDb(): Database.Database | null {
  if (!existsSync(DB_PATH)) return null;
  return new Database(DB_PATH, { readonly: true });
}

// Sync from hermes DB to local cache — only fetches new/updated sessions
export function syncSessionCache(): CachedSession[] {
  _cacheLock = true;
  try {
    const cache = readCache();
    const db = getDb();
    if (!db) {
      _cacheLock = false;
      return cache.sessions;
    }

    try {
      // Fetch sessions newer than last sync, or all if first sync
      const rows = db
        .prepare(
          `SELECT s.id, s.started_at, s.source, s.message_count, s.model, s.title
           FROM sessions s
           WHERE s.started_at > ?
           ORDER BY s.started_at DESC`,
        )
        .all(cache.lastSync > 0 ? cache.lastSync - 300 : 0) as Array<{
        id: string;
        started_at: number;
        source: string;
        message_count: number;
        model: string;
        title: string | null;
      }>;

      const existingIds = new Set(cache.sessions.map((s) => s.id));
      let newSessions: CachedSession[] = [];

      for (const row of rows) {
        if (existingIds.has(row.id)) {
          // Update existing entry (message count may have changed)
          const idx = cache.sessions.findIndex((s) => s.id === row.id);
          if (idx >= 0) {
            cache.sessions[idx].messageCount = row.message_count;
          }
          continue;
        }

        // Generate title from first user message
        let title = row.title || "";
        if (!title) {
          try {
            const msg = db
              .prepare(
                `SELECT content FROM messages
                 WHERE session_id = ? AND role = 'user' AND content IS NOT NULL
                 ORDER BY timestamp, id LIMIT 1`,
              )
              .get(row.id) as { content: string } | undefined;
            title = msg ? generateTitle(msg.content) : "New conversation";
          } catch {
            title = "New conversation";
          }
        }

        newSessions.push({
          id: row.id,
          title,
          startedAt: row.started_at,
          source: row.source,
          messageCount: row.message_count,
          model: row.model || "",
        });
      }

      // Merge: new sessions first (most recent), then existing
      const allSessions = [...newSessions, ...cache.sessions];
      // Sort by startedAt descending
      allSessions.sort((a, b) => b.startedAt - a.startedAt);

      const updated: CacheData = {
        sessions: allSessions,
        lastSync: Math.floor(Date.now() / 1000),
      };
      writeCache(updated);
      return updated.sessions;
    } catch {
      return cache.sessions;
    } finally {
      db.close();
    }
  } finally {
    _cacheLock = false;
  }
}

// Fast read from cache only (no DB access)
export function listCachedSessions(
  limit = 50,
  offset = 0,
): CachedSession[] {
  const cache = readCache();
  return cache.sessions.slice(offset, offset + limit);
}

let _cacheLock = false;

// Update title for a specific session
export function updateSessionTitle(
  sessionId: string,
  title: string,
): void {
  if (_cacheLock) return;
  _cacheLock = true;
  try {
    const cache = readCache();
    const idx = cache.sessions.findIndex((s) => s.id === sessionId);
    if (idx >= 0) {
      cache.sessions[idx].title = title;
      writeCache(cache);
    }
  } finally {
    _cacheLock = false;
  }
}
