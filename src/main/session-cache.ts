import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  profileHome,
  getActiveProfileNameSync,
  activeStateDbPath,
  safeWriteFile,
} from "./utils";
import Database from "better-sqlite3";
import { t } from "../shared/i18n";
import { getAppLocale } from "./locale";

/**
 * The session cache lives alongside its own profile's data so profiles
 * don't share a single cache file. The default profile keeps
 * ~/.hermes/desktop/sessions.json; named profiles use
 * ~/.hermes/profiles/<name>/desktop/sessions.json (issue #311).
 */
function cacheFilePath(): string {
  return join(
    profileHome(getActiveProfileNameSync()),
    "desktop",
    "sessions.json",
  );
}

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
  if (!message || !message.trim())
    return t("sessions.newConversation", getAppLocale());

  // Clean up the message
  let text = message.trim();

  // Remove markdown formatting
  text = text.replace(/[#*_`~[\]()]/g, "");
  // Remove URLs
  text = text.replace(/https?:\/\/\S+/g, "");
  // Remove extra whitespace
  text = text.replace(/\s+/g, " ").trim();

  if (!text) return t("sessions.newConversation", getAppLocale());

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
  const file = cacheFilePath();
  try {
    if (!existsSync(file)) return { sessions: [], lastSync: 0 };
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return { sessions: [], lastSync: 0 };
  }
}

function writeCache(data: CacheData): void {
  try {
    safeWriteFile(cacheFilePath(), JSON.stringify(data));
  } catch {
    // non-fatal
  }
}

function getDb(): Database.Database | null {
  const dbPath = activeStateDbPath();
  if (!existsSync(dbPath)) return null;
  return new Database(dbPath, { readonly: true });
}

/**
 * Sync one DB file into sessionMap (upsert).
 * New sessions are inserted; existing sessions have their messageCount updated.
 * Title preservation: if the cached title is already meaningful (not the
 * default placeholder), keep it — this prevents renamed sessions from
 * reverting to generated titles on the next sync.
 */
function syncOneDb(
  dbPath: string,
  lastSync: number,
  sessionMap: Map<string, CachedSession>,
): void {
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const rows = db
      .prepare(
        `SELECT s.id, s.started_at, s.source, s.message_count, s.model, s.title
         FROM sessions s
         WHERE s.updated_at > ?
         ORDER BY s.updated_at DESC`,
      )
      .all(lastSync > 0 ? lastSync - 300 : 0) as Array<{
      id: string;
      started_at: number;
      source: string;
      message_count: number;
      model: string;
      title: string | null;
    }>;

    const defaultTitle = t("sessions.newConversation", getAppLocale());

    const refreshedIds = new Set<string>();
    for (const row of rows) {
      refreshedIds.add(row.id);
      const existing = sessionMap.get(row.id);
      if (existing) {
        // Update existing entry (message count may have changed)
        existing.messageCount = row.message_count;
        continue;
      }

      // Determine best title: prefer a cached, non-default title (user may
      // have renamed the session) over re-generating from DB.
      let title = row.title || "";
      if (!title || title === defaultTitle) {
        if (existing?.title && existing.title !== defaultTitle) {
          title = existing.title;
        } else {
          try {
            const msg = db
              .prepare(
                `SELECT content FROM messages
                 WHERE session_id = ? AND role IN ('user', 'human') AND content IS NOT NULL
                 ORDER BY timestamp, id LIMIT 1`,
              )
              .get(row.id) as { content: string } | undefined;
            title = msg
              ? generateTitle(msg.content)
              : existing?.title || defaultTitle;
          } catch {
            title = existing?.title || defaultTitle;
          }
        }
      }

      sessionMap.set(row.id, {
        id: row.id,
        title,
        startedAt: row.started_at,
        source: row.source,
        messageCount: row.message_count,
        model: row.model || "",
      });
    }
  } catch {
    // DB may have a different schema — skip silently
  } finally {
    db?.close();
  }
}

// Sync from the active profile's hermes DB to local cache
export function syncSessionCache(): CachedSession[] {
  const cache = readCache();
  const dbPath = activeStateDbPath();
  if (!existsSync(dbPath)) return cache.sessions;

  try {
    // Seed the map with what we already have cached. syncOneDb upserts into
    // this map, so existing sessions get their messageCount refreshed and new
    // sessions are inserted — all in a single pass with no separate merge step.
    const sessionMap = new Map<string, CachedSession>();
    for (const s of cache.sessions) sessionMap.set(s.id, s);

    syncOneDb(dbPath, cache.lastSync, sessionMap);

    const allSessions = Array.from(sessionMap.values());
    allSessions.sort((a, b) => b.startedAt - a.startedAt);

    const updated: CacheData = {
      sessions: allSessions,
      lastSync: Math.floor(Date.now() / 1000),
    };
    writeCache(updated);
    return updated.sessions;
  } catch {
    return cache.sessions;
  }
}

// Fast read from cache only (no DB access)
export function listCachedSessions(limit = 50, offset = 0): CachedSession[] {
  const cache = readCache();
  return cache.sessions.slice(offset, offset + limit);
}

// Update title for a specific session
export function updateSessionTitle(sessionId: string, title: string): void {
  const cache = readCache();
  const idx = cache.sessions.findIndex((s) => s.id === sessionId);
  if (idx >= 0) {
    cache.sessions[idx].title = title;
    writeCache(cache);
  }
}

// Remove a session entry from the local cache. Called after the underlying
// row in state.db is deleted so the renderer's fast-path cache doesn't keep
// surfacing a session that no longer exists.
export function removeSessionFromCache(sessionId: string): void {
  const cache = readCache();
  const next = cache.sessions.filter((s) => s.id !== sessionId);
  if (next.length !== cache.sessions.length) {
    cache.sessions = next;
    writeCache(cache);
  }
}
