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
import { getDbConnection, sessionVisibilityPredicate } from "./db";
import { getSessionContextFolders } from "./session-context-folder-store";

/**
 * The session cache lives alongside its own profile's data so profiles
 * don't share a single cache file. The default profile keeps
 * ~/.hermes/desktop/sessions.json; named profiles use
 * ~/.hermes/profiles/<name>/desktop/sessions.json (issue #311).
 */
function cacheFilePath(profile?: unknown): string {
  const selectedProfile =
    profile === undefined || profile === ""
      ? getActiveProfileNameSync()
      : profile;
  return join(profileHome(selectedProfile), "desktop", "sessions.json");
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

function readCache(profile?: unknown): CacheData {
  const file = cacheFilePath(profile);
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

function writeCache(data: CacheData, profile?: unknown): void {
  try {
    safeWriteFile(cacheFilePath(profile), JSON.stringify(data));
  } catch {
    // non-fatal
  }
}

function getDb(profile?: unknown): Database.Database | null {
  return getDbConnection(true, profile);
}

// Attach each session's linked folder in a single batched store read, so a
// full sync stays a couple of queries rather than two per row. The result is
// written into the JSON cache by `syncSessionCache`, which lets the renderer's
// fast read path (`listCachedSessions`) stay DB-free.
function attachContextFolders(
  sessions: CachedSession[],
  profile?: unknown,
): CachedSession[] {
  const folders = getSessionContextFolders(
    sessions.map((s) => s.id),
    profile,
  );
  return sessions.map((session) => ({
    ...session,
    contextFolder: folders.get(session.id) ?? null,
  }));
}

// Reconcile visible session metadata; archive changes do not update started_at.
export function syncSessionCache(profile?: unknown): CachedSession[] {
  const cache = readCache(profile);
  const db = getDb(profile);
  if (!db) return cache.sessions;

  try {
    // Read the complete visible set so old sessions can disappear on archive
    // and reappear on unarchive. Reuse cached titles to avoid rereading messages.
    const rows = db
      .prepare(
        `SELECT s.id, s.started_at, s.source, s.message_count, s.model, s.title
         FROM sessions s
         WHERE ${sessionVisibilityPredicate(db)}
         ORDER BY s.started_at DESC`,
      )
      .all() as Array<{
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
    const visibleSessions: CachedSession[] = [];

    for (const row of rows) {
      const existing = existingById.get(row.id);
      if (existing) {
        visibleSessions.push({
          ...existing,
          messageCount: row.message_count,
          model: row.model || existing.model,
          title: row.title || existing.title,
        });
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

      visibleSessions.push({
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

    // Rows absent from the visible set are removed only from the desktop
    // cache. Their session/message data and linked folders remain in the DB.
    const allSessions = attachContextFolders(visibleSessions, profile);
    allSessions.sort((a, b) => b.startedAt - a.startedAt);

    const updated: CacheData = {
      sessions: allSessions,
      lastSync: Math.floor(Date.now() / 1000),
    };
    writeCache(updated, profile);
    return updated.sessions;
  } catch {
    return cache.sessions;
  }
}

// Fast read from cache only (no DB access). `contextFolder` is persisted into
// the cache by `syncSessionCache`, and folder changes trigger a re-sync (the
// renderer fires `hermes-session-context-folder-changed`), so the cached value
// stays current without this path touching the DB.
export function listCachedSessions(
  limit = 50,
  offset = 0,
  profile?: unknown,
): CachedSession[] {
  const cache = readCache(profile);
  return cache.sessions.slice(offset, offset + limit);
}

// Update title for a specific session
export function updateSessionTitle(
  sessionId: string,
  title: string,
  profile?: unknown,
): void {
  const cache = readCache(profile);
  const idx = cache.sessions.findIndex((s) => s.id === sessionId);
  if (idx >= 0) {
    cache.sessions[idx].title = title;
    writeCache(cache, profile);
  }
  // Also persist in state.db so the rename survives cache rebuilds
  try {
    const dbPath = activeStateDbPath(profile);
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
export function removeSessionFromCache(
  sessionId: string,
  profile?: unknown,
): void {
  const cache = readCache(profile);
  const next = cache.sessions.filter((s) => s.id !== sessionId);
  if (next.length !== cache.sessions.length) {
    cache.sessions = next;
    writeCache(cache, profile);
  }
}
