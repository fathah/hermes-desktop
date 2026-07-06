import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  activeStateDbPath,
  profileHome,
  getActiveProfileNameSync,
  safeWriteFile,
} from "./utils";
import Database from "better-sqlite3";
import { t } from "../shared/i18n";
import { getAppLocale } from "./locale";
import { getDbConnection } from "./db";
import { getSessionContextFolders } from "./session-context-folder-store";

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
  contextFolder: string | null;
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
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as CacheData;
    return {
      lastSync: typeof parsed.lastSync === "number" ? parsed.lastSync : 0,
      sessions: Array.isArray(parsed.sessions)
        ? parsed.sessions.map((s) => ({
            ...s,
            contextFolder:
              typeof s.contextFolder === "string" ? s.contextFolder : null,
          }))
        : [],
    };
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
  return getDbConnection(true);
}

// Attach each session's linked folder in a single batched store read, so a
// full sync stays a couple of queries rather than two per row. The result is
// written into the JSON cache by `syncSessionCache`, which lets the renderer's
// fast read path (`listCachedSessions`) stay DB-free.
function attachContextFolders(sessions: CachedSession[]): CachedSession[] {
  const folders = getSessionContextFolders(sessions.map((s) => s.id));
  return sessions.map((session) => ({
    ...session,
    contextFolder: folders.get(session.id) ?? null,
  }));
}

// Sync from hermes DB to local cache — only fetches new/updated sessions
export function syncSessionCache(): CachedSession[] {
  const cache = readCache();
  const db = getDb();
  if (!db) return cache.sessions;

  try {
    const lastSync = cache.sessions.length === 0 ? 0 : cache.lastSync;

    // Fetch sessions newer than last sync, or all if first sync
    const rows = db
      .prepare(
        `SELECT s.id, s.started_at, s.source, s.message_count, s.model, s.title
         FROM sessions s
         WHERE s.started_at > ?
         ORDER BY s.started_at DESC`,
      )
      .all(lastSync > 0 ? lastSync - 300 : 0) as Array<{
      id: string;
      started_at: number;
      source: string;
      message_count: number;
      model: string;
      title: string | null;
    }>;

    // Index existing sessions by id once so the per-row update below is
    // O(1) instead of O(N). Without this, syncing N existing sessions
    // against N new rows is O(N²) and visibly slows app startup once a
    // user has accumulated thousands of sessions (issue #16).
    const existingById = new Map<string, CachedSession>();
    for (const s of cache.sessions) existingById.set(s.id, s);
    const newSessions: CachedSession[] = [];

    const refreshedIds = new Set<string>();
    for (const row of rows) {
      refreshedIds.add(row.id);
      const existing = existingById.get(row.id);
      if (existing) {
        existing.messageCount = row.message_count;
        if (row.model) existing.model = row.model;
        if (row.title) existing.title = row.title;
        continue;
      }

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
          title = msg
            ? generateTitle(msg.content)
            : t("sessions.newConversation", getAppLocale());
        } catch {
          title = t("sessions.newConversation", getAppLocale());
        }
      }

      newSessions.push({
        id: row.id,
        title,
        startedAt: row.started_at,
        source: row.source,
        messageCount: row.message_count,
        model: row.model || "",
        // Filled in below by the single batched `attachContextFolders` pass
        // over the merged set, so we don't query the store once per new row.
        contextFolder: null,
      });
    }

    // Phase 2: refresh message_count for cached sessions that weren't
    // returned by the lastSync-windowed query above. Without this, an
    // old session that's still accumulating messages keeps the stale
    // count it had at first sync — the renderer reads from the cache,
    // so the UI reports e.g. 15 messages when the conversation actually
    // has 200+. Issue #226. Cheap (single column, no joins, batched IN
    // clause), and skipped entirely on a first sync since cache.sessions
    // is empty.
    const staleIds = cache.sessions
      .map((s) => s.id)
      .filter((id) => !refreshedIds.has(id));
    if (staleIds.length > 0) {
      // SQLite caps prepared-statement parameters; chunk well under
      // SQLITE_MAX_VARIABLE_NUMBER (default 999 on older builds) for
      // portability across the better-sqlite3 versions hermes ships.
      const CHUNK = 500;
      const countsById = new Map<string, number>();
      for (let i = 0; i < staleIds.length; i += CHUNK) {
        const chunk = staleIds.slice(i, i + CHUNK);
        const placeholders = chunk.map(() => "?").join(", ");
        const refreshed = db
          .prepare(
            `SELECT id, message_count FROM sessions WHERE id IN (${placeholders})`,
          )
          .all(...chunk) as Array<{ id: string; message_count: number }>;
        for (const r of refreshed) countsById.set(r.id, r.message_count);
      }
      cache.sessions = cache.sessions.filter(
        (s) => refreshedIds.has(s.id) || countsById.has(s.id),
      );
      for (const s of cache.sessions) {
        const fresh = countsById.get(s.id);
        if (fresh !== undefined && fresh !== s.messageCount) {
          s.messageCount = fresh;
        }
      }
    }

    // Merge via Map to prevent duplicates: existing sessions (already
    // mutated in-place above) plus newly discovered sessions.
    const merged = new Map<string, CachedSession>();
    for (const s of cache.sessions) merged.set(s.id, s);
    for (const s of newSessions) merged.set(s.id, s);
    const allSessions = attachContextFolders(Array.from(merged.values()));
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

// Fast read from cache only (no DB access). `contextFolder` is persisted into
// the cache by `syncSessionCache`, and folder changes trigger a re-sync (the
// renderer fires `hermes-session-context-folder-changed`), so the cached value
// stays current without this path touching the DB.
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
  // Also persist in state.db so the rename survives cache rebuilds
  try {
    const dbPath = activeStateDbPath();
    if (existsSync(dbPath)) {
      const db = new Database(dbPath);
      try {
        db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(
          title,
          sessionId,
        );
      } finally {
        db.close();
      }
    }
  } catch {
    // ignore DB errors — cache update above is the fast path
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
