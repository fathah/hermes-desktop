import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import {
  activeStateDbPath,
  profileHome,
  getActiveProfileNameSync,
  safeWriteFile,
} from "./utils";
import Database from "better-sqlite3";
import { t } from "../shared/i18n";
import {
  isSessionTitleUniqueViolation,
  MAX_SESSION_TITLE_LENGTH,
  normalizeSessionTitle,
  validateNormalizedSessionTitle,
} from "../shared/session-title";
import { getAppLocale } from "./locale";
import { getDbConnection, sessionVisibilityPredicate } from "./db";
import { getSessionContextFolders } from "./session-context-folder-store";

// Re-export for callers/docs that historically imported the cap from here.
export { MAX_SESSION_TITLE_LENGTH } from "../shared/session-title";

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

/**
 * Identity of the `state.db` a cache file was built from.
 *
 * The JSON cache is a denormalised mirror of that database's visible
 * `sessions`, but nothing in a cached row records which database it came
 * from. A cache left behind by a database that has since been deleted or
 * replaced (reinstall, profile reset, restored backup, a `HERMES_HOME`
 * pointed somewhere new) therefore describes sessions that can no longer be
 * opened, and `listCachedSessions` — the renderer's deliberately DB-free fast
 * path — has no way to tell it apart from a live cache. It paints whatever
 * the file holds, which is how long-dead sessions reappear on launch.
 *
 * Stamping the source database into the cache makes that answerable without
 * opening the database: if the stamp no longer matches, the rows are stale by
 * provenance, whatever they happen to contain.
 */
interface CacheSource {
  profile: string;
  dbPath: string;
  /**
   * Inode and creation time of `state.db`. Deliberately *not* size or mtime:
   * those change on every write during normal use and would invalidate the
   * cache constantly. Inode and birth time change only when the file is
   * replaced, which is exactly the event this needs to catch.
   */
  dbId: string;
}

interface CacheData {
  sessions: CachedSession[];
  lastSync: number;
  source?: CacheSource;
}

/**
 * Identify the state DB a profile's cache should mirror, or `null` when there
 * is no such database — in which case none of its cached rows can be valid.
 *
 * Resolved per profile, matching `cacheFilePath` and `getDb`, so one profile's
 * cache is never validated against another profile's database.
 */
function currentCacheSource(profile?: unknown): CacheSource | null {
  const selectedProfile =
    profile === undefined || profile === ""
      ? getActiveProfileNameSync()
      : profile;
  const dbPath = activeStateDbPath(selectedProfile);
  try {
    const stats = statSync(dbPath);
    return {
      profile: String(selectedProfile),
      dbPath,
      dbId: `${stats.ino}:${Math.floor(stats.birthtimeMs)}`,
    };
  } catch {
    return null;
  }
}

function sameSource(a: CacheSource, b: CacheSource): boolean {
  return a.profile === b.profile && a.dbPath === b.dbPath && a.dbId === b.dbId;
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

/**
 * Read a profile's cache, rejecting rows that provably do not belong to the
 * state DB that profile is pointed at right now.
 *
 * Every consumer goes through here, so the validation holds for the DB-free
 * fast path (`listCachedSessions`), for `syncSessionCache`'s success path,
 * and — importantly — for its fallbacks, which return the existing cache when
 * the database cannot be opened. Guarding only one of those, or guarding in
 * the renderer, leaves the others free to paint the same rejected rows.
 */
function readCache(profile?: unknown): CacheData {
  const current = currentCacheSource(profile);
  const file = cacheFilePath(profile);
  try {
    if (!existsSync(file)) return { sessions: [], lastSync: 0 };
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as CacheData;

    // No state.db at all: every cached row points at a session that cannot be
    // opened, so serve nothing rather than a list of ghosts. This is the case
    // that never self-heals on its own — with no database there is also no
    // sync able to drop the rows, so they survive every restart.
    if (!current) return { sessions: [], lastSync: 0 };

    const stored = parsed.source;
    // The cache belongs to a different database. Drop it outright and let the
    // next sync rebuild from the live one.
    //
    // A cache with no stamp at all predates this check. It is not known to be
    // wrong, so its rows still paint and upgrading users keep their instant
    // sidebar; `syncSessionCache` rebuilds the visible set from the database
    // on the very next run either way, which stamps it from then on.
    if (stored && !sameSource(stored, current)) {
      return { sessions: [], lastSync: 0, source: current };
    }

    return {
      lastSync: typeof parsed.lastSync === "number" ? parsed.lastSync : 0,
      sessions: Array.isArray(parsed.sessions)
        ? parsed.sessions.map((s) => ({
            ...s,
            contextFolder:
              typeof s.contextFolder === "string" ? s.contextFolder : null,
          }))
        : [],
      source: current,
    };
  } catch {
    return { sessions: [], lastSync: 0 };
  }
}

// Always stamp the cache with the database it was built from, so the next
// read can verify it. A write with no resolvable source (state.db vanished
// mid-run) is left unstamped, which `readCache` treats as unverifiable.
function writeCache(data: CacheData, profile?: unknown): void {
  try {
    const source = data.source ?? currentCacheSource(profile);
    safeWriteFile(
      cacheFilePath(profile),
      JSON.stringify(source ? { ...data, source } : data),
    );
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
  // `readCache` has already discarded rows that don't belong to this
  // profile's live state DB, so both of this function's fallbacks (here, and
  // the catch at the end) return a provenance-checked list rather than
  // whatever was last written. Note the distinction that preserves: a
  // *missing* state.db emptied the cache above, while a database that merely
  // cannot be opened right now — locked, or a startup with no gateway
  // reachable — leaves the cache intact and still renders the user's history.
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
    // Same guarantee as the `!db` path above: already provenance-checked.
    return cache.sessions;
  }
}

// Fast read from cache only (no DB access). `contextFolder` is persisted into
// the cache by `syncSessionCache`, and folder changes trigger a re-sync (the
// renderer fires `hermes-session-context-folder-changed`), so the cached value
// stays current without this path touching the DB. `readCache` validates the
// cache's provenance with a single `stat` — still no DB open — so this path
// cannot paint sessions belonging to a database that is gone or replaced.
export function listCachedSessions(
  limit = 50,
  offset = 0,
  profile?: unknown,
): CachedSession[] {
  const cache = readCache(profile);
  return cache.sessions.slice(offset, offset + limit);
}

/**
 * Persist a user-chosen session title to state.db, then mirror it into the
 * desktop sessions.json cache.
 *
 * Order matters: the durable DB write must succeed before the cache is
 * updated. The previous cache-first + swallow-errors approach left the UI
 * looking renamed while the next syncSessionCache restored the old DB title
 * (Hermes enforces UNIQUE non-NULL titles via idx_sessions_title_unique).
 */
export function updateSessionTitle(
  sessionId: string,
  title: string,
  profile?: unknown,
): void {
  const locale = getAppLocale();
  const normalized = normalizeSessionTitle(title);
  const validation = validateNormalizedSessionTitle(normalized);
  switch (validation) {
    case "empty":
      throw new Error(t("sessions.renameInvalid", locale));
    case "too_long":
      throw new Error(
        t("sessions.renameTooLong", locale, {
          max: String(MAX_SESSION_TITLE_LENGTH),
        }),
      );
    case null:
      break;
    default: {
      const _exhaustive: never = validation;
      throw new Error(String(_exhaustive));
    }
  }

  const db = getDbConnection(false, profile);
  if (!db) {
    throw new Error(t("sessions.renameUnavailable", locale));
  }

  // Match Hermes SessionDB.set_session_title: reject conflicts before write so
  // we never partially update the JSON cache on a UNIQUE constraint failure.
  const conflict = db
    .prepare("SELECT id FROM sessions WHERE title = ? AND id != ?")
    .get(normalized, sessionId) as { id: string } | undefined;
  if (conflict) {
    throw new Error(
      t("sessions.renameDuplicate", locale, { title: normalized }),
    );
  }

  let changes = 0;
  try {
    const columns = db.prepare("PRAGMA table_info(sessions)").all() as Array<{
      name: string;
    }>;
    const titleSource = columns.some((column) => column.name === "title_source")
      ? ", title_source = 'user'"
      : "";
    changes = db
      .prepare(`UPDATE sessions SET title = ?${titleSource} WHERE id = ?`)
      .run(normalized, sessionId).changes;
  } catch (err) {
    if (isSessionTitleUniqueViolation(err)) {
      throw new Error(
        t("sessions.renameDuplicate", locale, { title: normalized }),
      );
    }
    throw err instanceof Error ? err : new Error(String(err));
  }

  if (changes === 0) {
    throw new Error(t("sessions.renameNotFound", locale));
  }

  const cache = readCache(profile);
  const idx = cache.sessions.findIndex((s) => s.id === sessionId);
  if (idx >= 0) {
    cache.sessions[idx].title = normalized;
    writeCache(cache, profile);
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
