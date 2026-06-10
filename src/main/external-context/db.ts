/**
 * ExternalContextDb — a DERIVED, REBUILDABLE better-sqlite3 index over the local
 * transcripts of *other* AI coding tools. Mirrors the note-index philosophy: the
 * on-disk transcript files are the source of truth; this DB is a disposable
 * search/provenance cache that can be dropped and rebuilt at any time.
 *
 * SECURITY — this is the SINGLE WRITER. {@link applyFragments} is the only path
 * that inserts message text, and it redacts EVERY message via
 * {@link redactExternalText} before the INSERT. A secret therefore never reaches
 * `messages` or `messages_fts`, so it cannot be recovered by search.
 *
 * Schema:
 *   meta(key PK, value)                                  -- schema_version
 *   conversations(conv_id PK, source, conversation_id, project_path,
 *                 git_branch, title, started_at, last_at, message_count)
 *   messages(conv_id, seq, role, ts, text, PK(conv_id,seq))
 *   messages_fts(conv_id UNINDEXED, seq UNINDEXED, text, tokenize='porter')
 *   files(path PK, source, strategy, offset, size, mtime)  -- incremental cursors
 *
 * Opening this module loads better-sqlite3 (Electron ABI), so it CANNOT run under
 * vitest — it is exercised by scripts/verify-external-context.ts instead.
 */
import Database from "better-sqlite3";
import { dirname } from "path";
import { mkdirSync } from "fs";
import type {
  ExternalConversationMeta,
  ExternalMessage,
  ExternalSearchHit,
  ExternalSource,
  ExternalSourceStatus,
} from "../../shared/external-context";
import { EXTERNAL_SOURCES } from "../../shared/external-context";
import { redactExternalText } from "./redact";
import type { DiscoveredFile, ParseResult } from "./adapters/types";
import type { FileRecord } from "./scan-logic";

const SCHEMA_VERSION = 1;

interface ConversationRow {
  conv_id: string;
  source: string;
  conversation_id: string;
  project_path: string | null;
  git_branch: string | null;
  title: string | null;
  started_at: number | null;
  last_at: number | null;
  message_count: number;
}

interface MessageRow {
  seq: number;
  role: string;
  ts: number | null;
  text: string;
}

function convKey(source: ExternalSource, conversationId: string): string {
  return `${source}:${conversationId}`;
}

/** Sanitize a search string into a safe FTS5 prefix-AND query (note-index style). */
function toFtsQuery(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `"${w.replace(/"/g, '""')}"*`)
    .join(" ");
}

export class ExternalContextDb {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.ensureSchema();
  }

  private ensureSchema(): void {
    const version = this.schemaVersion();
    if (version !== null && version !== SCHEMA_VERSION) {
      // Schema bump → drop everything and rebuild from disk (cache is disposable).
      this.dropAll();
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations (
        conv_id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        project_path TEXT,
        git_branch TEXT,
        title TEXT,
        started_at INTEGER,
        last_at INTEGER,
        message_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_conv_source ON conversations(source);
      CREATE INDEX IF NOT EXISTS idx_conv_project ON conversations(project_path);
      CREATE INDEX IF NOT EXISTS idx_conv_last ON conversations(last_at);
      CREATE TABLE IF NOT EXISTS messages (
        conv_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        role TEXT NOT NULL,
        ts INTEGER,
        text TEXT NOT NULL,
        PRIMARY KEY (conv_id, seq)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
        USING fts5(conv_id UNINDEXED, seq UNINDEXED, text, tokenize='porter');
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        strategy TEXT NOT NULL,
        offset INTEGER NOT NULL DEFAULT 0,
        size INTEGER NOT NULL DEFAULT 0,
        mtime REAL NOT NULL DEFAULT 0
      );
    `);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO meta(key,value) VALUES('schema_version',?)`,
      )
      .run(String(SCHEMA_VERSION));
  }

  private schemaVersion(): number | null {
    try {
      const row = this.db
        .prepare(`SELECT value FROM meta WHERE key='schema_version'`)
        .get() as { value: string } | undefined;
      return row ? Number(row.value) : null;
    } catch {
      return null;
    }
  }

  private dropAll(): void {
    this.db.exec(`
      DROP TABLE IF EXISTS conversations;
      DROP TABLE IF EXISTS messages;
      DROP TABLE IF EXISTS messages_fts;
      DROP TABLE IF EXISTS files;
    `);
  }

  // ── the one writer ──────────────────────────────────────────────────────────

  /**
   * Apply a parsed slice to the index in a SINGLE transaction. Redaction of
   * every message happens HERE (the choke point) before any INSERT. `replace`
   * (whole-file sources) clears the conversation first; append merges by
   * (conv_id, seq) so re-parsing an overlap is idempotent.
   */
  applyFragments(
    file: DiscoveredFile,
    result: ParseResult,
    knownSecrets: readonly string[],
    replace: boolean,
  ): void {
    const tx = this.db.transaction(() => {
      const conv = result.conversation;
      let convId: string | null = null;

      if (conv) {
        convId = convKey(file.source, conv.conversationId);
        this.mergeConversation(convId, file.source, conv, knownSecrets);
        if (replace) {
          this.db.prepare(`DELETE FROM messages WHERE conv_id = ?`).run(convId);
          this.db
            .prepare(`DELETE FROM messages_fts WHERE conv_id = ?`)
            .run(convId);
        }
      }

      const insMsg = this.db.prepare(
        `INSERT OR REPLACE INTO messages(conv_id,seq,role,ts,text) VALUES(?,?,?,?,?)`,
      );
      const delFts = this.db.prepare(
        `DELETE FROM messages_fts WHERE conv_id = ? AND seq = ?`,
      );
      const insFts = this.db.prepare(
        `INSERT INTO messages_fts(conv_id,seq,text) VALUES(?,?,?)`,
      );

      const touched = new Set<string>();
      for (const m of result.messages) {
        const cid = convKey(file.source, m.conversationId);
        const safeText = redactExternalText(m.text, knownSecrets);
        insMsg.run(cid, m.seq, m.role, m.ts, safeText);
        delFts.run(cid, m.seq);
        insFts.run(cid, m.seq, safeText);
        touched.add(cid);
      }

      // Recompute message_count for every conversation we touched.
      const recount = this.db.prepare(
        `UPDATE conversations SET message_count =
           (SELECT COUNT(*) FROM messages WHERE messages.conv_id = conversations.conv_id)
         WHERE conv_id = ?`,
      );
      if (convId) touched.add(convId);
      for (const cid of touched) recount.run(cid);

      // Advance the file cursor.
      this.db
        .prepare(
          `INSERT INTO files(path,source,strategy,offset,size,mtime)
           VALUES(@path,@source,@strategy,@offset,@size,@mtime)
           ON CONFLICT(path) DO UPDATE SET
             strategy=@strategy, offset=@offset, size=@size, mtime=@mtime`,
        )
        .run({
          path: file.absPath,
          source: file.source,
          strategy: file.strategy,
          offset: result.bytesConsumed,
          size: file.size,
          mtime: file.mtimeMs,
        });
    });
    tx();
  }

  /** Merge conversation metadata: widen the time span, keep first-known fields.
   *  The title is DERIVED from the first user message (before redaction), so it
   *  is redacted HERE too — otherwise a secret in the opening message would leak
   *  through the title into search hits, the viewer header, and Save-to-KB. */
  private mergeConversation(
    convId: string,
    source: ExternalSource,
    conv: ParseResult["conversation"] & object,
    knownSecrets: readonly string[],
  ): void {
    const existing = this.db
      .prepare(`SELECT * FROM conversations WHERE conv_id = ?`)
      .get(convId) as ConversationRow | undefined;

    const startedAt = minNullable(existing?.started_at ?? null, conv.startedAt);
    const lastAt = maxNullable(existing?.last_at ?? null, conv.lastAt);
    const projectPath = conv.projectPath ?? existing?.project_path ?? null;
    const gitBranch = conv.gitBranch ?? existing?.git_branch ?? null;
    const rawTitle = conv.title ?? existing?.title ?? null;
    const title = rawTitle ? redactExternalText(rawTitle, knownSecrets) : null;

    this.db
      .prepare(
        `INSERT INTO conversations
           (conv_id,source,conversation_id,project_path,git_branch,title,started_at,last_at,message_count)
         VALUES(@conv_id,@source,@conversation_id,@project_path,@git_branch,@title,@started_at,@last_at,
                COALESCE((SELECT message_count FROM conversations WHERE conv_id=@conv_id),0))
         ON CONFLICT(conv_id) DO UPDATE SET
           project_path=@project_path, git_branch=@git_branch, title=@title,
           started_at=@started_at, last_at=@last_at`,
      )
      .run({
        conv_id: convId,
        source,
        conversation_id: conv.conversationId,
        project_path: projectPath,
        git_branch: gitBranch,
        title,
        started_at: startedAt,
        last_at: lastAt,
      });
  }

  // ── reads ───────────────────────────────────────────────────────────────────

  /** Full-text search over redacted message text, joined to provenance. */
  search(
    query: string,
    opts: { source?: ExternalSource; project?: string; limit?: number } = {},
  ): ExternalSearchHit[] {
    const ftsQuery = toFtsQuery(query);
    if (!ftsQuery) return [];
    const clauses: string[] = ["messages_fts MATCH ?"];
    const params: unknown[] = [ftsQuery];
    if (opts.source) {
      clauses.push("c.source = ?");
      params.push(opts.source);
    }
    if (opts.project) {
      clauses.push("c.project_path LIKE ?");
      params.push(`%${opts.project}%`);
    }
    const limit = Math.max(1, Math.min(opts.limit ?? 30, 100));
    params.push(limit);
    try {
      const rows = this.db
        .prepare(
          `SELECT m.conv_id AS convId, m.seq AS seq, m.role AS role, m.ts AS ts,
                  c.source AS source, c.conversation_id AS conversationId,
                  c.project_path AS projectPath, c.git_branch AS gitBranch, c.title AS title,
                  snippet(messages_fts, 2, '', '', '…', 14) AS snippet
           FROM messages_fts
           JOIN messages m ON m.conv_id = messages_fts.conv_id AND m.seq = messages_fts.seq
           JOIN conversations c ON c.conv_id = m.conv_id
           WHERE ${clauses.join(" AND ")}
           ORDER BY rank
           LIMIT ?`,
        )
        .all(...params) as Array<ExternalSearchHit & { source: string }>;
      return rows.map((r) => ({ ...r, source: r.source as ExternalSource }));
    } catch {
      return [];
    }
  }

  getConversationMeta(convId: string): ExternalConversationMeta | null {
    const row = this.db
      .prepare(`SELECT * FROM conversations WHERE conv_id = ?`)
      .get(convId) as ConversationRow | undefined;
    return row ? convMetaFromRow(row) : null;
  }

  /**
   * Conversations whose most-recent activity is at/after `sinceMs`, newest
   * first — the time-windowed query the weekly digest run is built on. Optional
   * source/project scoping mirrors search().
   */
  listConversationsSince(
    sinceMs: number,
    opts: { source?: ExternalSource; project?: string; limit?: number } = {},
  ): ExternalConversationMeta[] {
    const clauses = ["last_at IS NOT NULL", "last_at >= ?"];
    const params: unknown[] = [sinceMs];
    if (opts.source) {
      clauses.push("source = ?");
      params.push(opts.source);
    }
    if (opts.project) {
      clauses.push("project_path LIKE ?");
      params.push(`%${opts.project}%`);
    }
    const limit = Math.max(1, Math.min(opts.limit ?? 100, 500));
    params.push(limit);
    const rows = this.db
      .prepare(
        `SELECT * FROM conversations WHERE ${clauses.join(" AND ")}
         ORDER BY last_at DESC LIMIT ?`,
      )
      .all(...params) as ConversationRow[];
    return rows.map(convMetaFromRow);
  }

  /** Ordered messages for a conversation, optionally windowed around a seq. */
  getConversation(
    convId: string,
    opts: { aroundSeq?: number; limit?: number } = {},
  ): ExternalMessage[] {
    const limit = Math.max(1, Math.min(opts.limit ?? 200, 1000));
    if (typeof opts.aroundSeq === "number") {
      const half = Math.floor(limit / 2);
      const before = this.db
        .prepare(
          `SELECT seq,role,ts,text FROM messages
           WHERE conv_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?`,
        )
        .all(convId, opts.aroundSeq, half) as MessageRow[];
      const after = this.db
        .prepare(
          `SELECT seq,role,ts,text FROM messages
           WHERE conv_id = ? AND seq >= ? ORDER BY seq ASC LIMIT ?`,
        )
        .all(convId, opts.aroundSeq, limit - half) as MessageRow[];
      const rows = [...before.reverse(), ...after];
      return rows.map(toExternalMessage);
    }
    const rows = this.db
      .prepare(
        `SELECT seq,role,ts,text FROM messages WHERE conv_id = ? ORDER BY seq ASC LIMIT ?`,
      )
      .all(convId, limit) as MessageRow[];
    return rows.map(toExternalMessage);
  }

  /** Distinct project paths (optionally for one source) with conversation counts. */
  listProjects(
    source?: ExternalSource,
  ): Array<{ projectPath: string; count: number }> {
    const clause = source
      ? "WHERE source = ? AND project_path IS NOT NULL"
      : "WHERE project_path IS NOT NULL";
    const params = source ? [source] : [];
    const rows = this.db
      .prepare(
        `SELECT project_path AS projectPath, COUNT(*) AS count
         FROM conversations ${clause}
         GROUP BY project_path ORDER BY count DESC, project_path ASC`,
      )
      .all(...params) as Array<{ projectPath: string; count: number }>;
    return rows;
  }

  /** Per-source rollup (conversations / messages / files). */
  sourceStats(): Record<
    ExternalSource,
    { conversations: number; messages: number; files: number }
  > {
    const out = {} as Record<
      ExternalSource,
      { conversations: number; messages: number; files: number }
    >;
    for (const source of EXTERNAL_SOURCES) {
      const conv = this.db
        .prepare(`SELECT COUNT(*) AS n FROM conversations WHERE source = ?`)
        .get(source) as { n: number };
      const msg = this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM messages m JOIN conversations c ON c.conv_id = m.conv_id WHERE c.source = ?`,
        )
        .get(source) as { n: number };
      const files = this.db
        .prepare(`SELECT COUNT(*) AS n FROM files WHERE source = ?`)
        .get(source) as { n: number };
      out[source] = { conversations: conv.n, messages: msg.n, files: files.n };
    }
    return out;
  }

  totals(): { conversations: number; messages: number } {
    const c = this.db
      .prepare(`SELECT COUNT(*) AS n FROM conversations`)
      .get() as { n: number };
    const m = this.db.prepare(`SELECT COUNT(*) AS n FROM messages`).get() as {
      n: number;
    };
    return { conversations: c.n, messages: m.n };
  }

  /** File cursors keyed by absolute path (for the scan orchestrator). */
  fileRecords(): Map<string, FileRecord> {
    const rows = this.db
      .prepare(`SELECT path,strategy,offset,size,mtime FROM files`)
      .all() as Array<{
      path: string;
      strategy: string;
      offset: number;
      size: number;
      mtime: number;
    }>;
    const map = new Map<string, FileRecord>();
    for (const r of rows) {
      map.set(r.path, {
        path: r.path,
        strategy: r.strategy === "replace" ? "replace" : "append",
        offset: r.offset,
        size: r.size,
        mtimeMs: r.mtime,
      });
    }
    return map;
  }

  // ── maintenance ─────────────────────────────────────────────────────────────

  /** Remove everything for one source (used when a source is disabled). */
  purgeSource(source: ExternalSource): void {
    const tx = this.db.transaction(() => {
      const convIds = this.db
        .prepare(`SELECT conv_id FROM conversations WHERE source = ?`)
        .all(source) as Array<{ conv_id: string }>;
      const delMsg = this.db.prepare(`DELETE FROM messages WHERE conv_id = ?`);
      const delFts = this.db.prepare(
        `DELETE FROM messages_fts WHERE conv_id = ?`,
      );
      for (const { conv_id } of convIds) {
        delMsg.run(conv_id);
        delFts.run(conv_id);
      }
      this.db.prepare(`DELETE FROM conversations WHERE source = ?`).run(source);
      this.db.prepare(`DELETE FROM files WHERE source = ?`).run(source);
    });
    tx();
  }

  /** Drop file cursors whose paths are no longer present on disk. */
  dropMissingFiles(source: ExternalSource, present: Set<string>): void {
    const rows = this.db
      .prepare(`SELECT path FROM files WHERE source = ?`)
      .all(source) as Array<{ path: string }>;
    const del = this.db.prepare(`DELETE FROM files WHERE path = ?`);
    const tx = this.db.transaction(() => {
      for (const { path } of rows) {
        if (!present.has(path)) del.run(path);
      }
    });
    tx();
  }

  /** Drop and recreate everything — full rebuild starting point. */
  rebuild(): void {
    this.dropAll();
    this.ensureSchema();
  }

  /** Sources that currently have at least one indexed conversation. */
  populatedSources(): Set<ExternalSource> {
    const rows = this.db
      .prepare(`SELECT DISTINCT source FROM conversations`)
      .all() as Array<{ source: string }>;
    return new Set(rows.map((r) => r.source as ExternalSource));
  }

  buildSourceStatuses(
    enabled: Record<ExternalSource, boolean>,
    available: Record<ExternalSource, boolean>,
  ): ExternalSourceStatus[] {
    const stats = this.sourceStats();
    return EXTERNAL_SOURCES.map((source) => ({
      source,
      enabled: enabled[source],
      available: available[source],
      conversations: stats[source].conversations,
      messages: stats[source].messages,
      files: stats[source].files,
    }));
  }

  close(): void {
    this.db.close();
  }
}

function toExternalMessage(row: MessageRow): ExternalMessage {
  return { seq: row.seq, role: row.role, ts: row.ts, text: row.text };
}

function convMetaFromRow(row: ConversationRow): ExternalConversationMeta {
  return {
    convId: row.conv_id,
    source: row.source as ExternalSource,
    conversationId: row.conversation_id,
    projectPath: row.project_path,
    gitBranch: row.git_branch,
    title: row.title,
    startedAt: row.started_at,
    lastAt: row.last_at,
    messageCount: row.message_count,
  };
}

function minNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}
