// note-index.ts — Part 2 / S1 of the substrate convergence.
//
// A DERIVED, REBUILDABLE SQLite index over the markdown-on-disk workspace.
// Markdown files (+ YAML frontmatter + [[wikilinks]]) remain the single source
// of truth; this index is a query/search/graph cache. It is read-only over the
// files — it never writes them — so adding it changes nothing about where the
// editor stores content. A chokidar watcher keeps it live; `rebuild()` is always
// a safe reset because the files are authoritative.
//
// Design (the one rule): files → index, never index-as-truth. The whole DB can
// be deleted and reproduced from disk identically.
//
// Schema:
//   notes(path PK, title, props JSON, body, mtime, updated_at)
//   notes_fts(path UNINDEXED, title, body)            -- FTS5 search
//   links(source, target_norm)                        -- [[wikilink]] graph
// Frontmatter is stored whole in the JSON `props` column so any database can add
// any property with no schema migration; filters/sorts use json_extract() with
// on-demand expression indexes.
import Database from "better-sqlite3";
import type { Dirent } from "fs";
import { mkdir, readdir, readFile, stat, unlink } from "fs/promises";
import { basename, extname, join, relative, sep } from "path";
import chokidar, { type FSWatcher } from "chokidar";
import { resolveSpsVaultDir } from "./sps-storage";
import { semanticManager } from "./semantic-index";
import { formatLogError, log } from "./log";
import { extractSpsLinkEdges, maskSpsWikilinks } from "../shared/sps-wikilinks";
import type { VaultLinkEdge } from "../shared/sps-types";
import { parseYamlFrontmatterMarkdown } from "../shared/sps-frontmatter";

const NOTE_EXTENSIONS = new Set([".md", ".markdown"]);

/** Predefined allowlist of frontmatter properties to index in SQLite.
 *  Prevents B-tree index bloat for dynamic/ad-hoc frontmatter keys. */
const INDEXED_PROPERTIES = new Set([
  "title",
  "icon",
  "cover",
  "source",
  "ingestedat",
  "journal",
  "date",
  "time",
  "mood",
  "tags",
  "status",
  "rating",
  "updated",
  "prio",
  "assignee",
  "tenant",
]);

/** Extract `[[wikilink]]` targets from raw note content. */
export interface TypedLink {
  target_norm: string;
  type: string;
  kind: "link" | "embed";
  target_heading?: string;
  target_block_id?: string;
}

/** Extract `[[wikilink]]` targets and relationship types from raw note content. */
function extractBacklinks(
  content: string,
  props: Record<string, unknown> = {},
): TypedLink[] {
  return extractSpsLinkEdges(content, props)
    .map((edge) => ({
      target_norm: normalizeName(edge.target),
      type: edge.type,
      kind: edge.kind,
      target_heading: edge.heading,
      target_block_id: edge.blockId,
    }))
    .filter((edge) => !!edge.target_norm);
}

/** Normalize a tag: drop a leading `#`, trim. Empty → "". */
function normalizeTag(raw: string): string {
  return raw.replace(/^#+/, "").trim();
}

/** Frontmatter tags: an array, or a string of comma/space-separated tags
 *  (Obsidian accepts both forms). */
function frontmatterTags(props: Record<string, unknown>): string[] {
  const raw = props.tags;
  if (Array.isArray(raw)) {
    return raw.filter((t): t is string => typeof t === "string");
  }
  if (typeof raw === "string") {
    return raw.split(/[,\s]+/).filter(Boolean);
  }
  return [];
}

/** Inline `#tag`s in the body (Obsidian style: letter-led, allows `-_/`). The
 *  `#` must be preceded by start/whitespace so `# Heading` and `##` aren't tags
 *  (the char after `#` must be a letter). */
function extractInlineTags(body: string): string[] {
  const tags = new Set<string>();
  const re = /(?:^|\s)#([A-Za-z][\w-]*(?:\/[\w-]+)*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    tags.add(match[1]);
  }
  return [...tags];
}
const INDEX_DB_FILE = ".note-index.db";
const INDEX_DB_SIDE_FILES = [
  INDEX_DB_FILE,
  `${INDEX_DB_FILE}-wal`,
  `${INDEX_DB_FILE}-shm`,
];

// Wiki META pages (Karpathy LLM-Wiki): the LLM-maintained catalog, the
// append-only evolution log, and the schema. They are intentionally link-free
// bookkeeping artifacts, so orphan lint must skip them (relpaths, with ext).
const WIKI_META_PAGES = new Set([
  "index.md",
  "log.md",
  "WIKI.md",
  "home.md",
  "Home.md",
  "home",
  "Home",
]);

export interface NoteRecord {
  path: string;
  title: string;
  props: Record<string, unknown>;
  mtime: number;
}

export interface UnlinkedMentionHit {
  source: string;
  target: string;
  phrase: string;
}

export interface NoteSearchHit {
  path: string;
  title: string;
  snippet: string;
  /** File mtime (epoch ms) of the matched note — joined from `notes`, for a
   *  recency boost in federated ranking. Optional: legacy callers ignore it. */
  mtime?: number;
}

export interface NoteIndexStatus {
  root: string;
  notes: number;
  links: number;
  indexedAt: number | null;
}

export type NoteFilterOp = "eq" | "neq" | "contains" | "exists";

export interface NoteFilter {
  prop: string;
  op: NoteFilterOp;
  value?: unknown;
}

export interface NoteQuery {
  /** Limit to notes whose path starts with this folder (the "database" scope). */
  scope?: string;
  filters?: NoteFilter[];
  sort?: { prop: string; dir: "asc" | "desc" };
  limit?: number;
}

// ── pure helpers (no I/O) ─────────────────────────────────────────────────────

/** Split YAML frontmatter from the markdown body. Never throws. */
export function parseFrontmatter(raw: string): {
  props: Record<string, unknown>;
  body: string;
} {
  return parseYamlFrontmatterMarkdown(raw);
}

function firstHeading(body: string): string | null {
  for (const line of body.split("\n")) {
    const m = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (m) return m[1];
    if (line.trim()) break; // stop at first non-empty non-heading line
  }
  return null;
}

function deriveTitle(
  props: Record<string, unknown>,
  body: string,
  relPath: string,
): string {
  if (typeof props.title === "string" && props.title.trim()) {
    return props.title.trim();
  }
  const heading = firstHeading(body);
  if (heading) return heading;
  return basename(relPath, extname(relPath));
}

/** Normalize a wikilink target / note name for order-independent matching. */
function normalizeName(raw: string): string {
  let s = raw.trim().toLowerCase();
  s = s.split("|")[0]; // strip [[target|alias]]
  s = s.split("#")[0]; // strip [[target#heading]]
  s = s.replace(/\.(md|markdown)$/i, "");
  return s.trim();
}

/** Every name a [[wikilink]] could legitimately use to reference this note. */
function candidateNames(relPath: string): string[] {
  const fwd = relPath.replace(/\\/g, "/");
  const noExt = fwd.replace(/\.(md|markdown)$/i, "");
  const base = basename(noExt);
  return Array.from(
    new Set([normalizeName(fwd), normalizeName(noExt), normalizeName(base)]),
  ).filter(Boolean);
}

function mentionPhrases(note: NoteRecord): string[] {
  const phrases = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value !== "string") return;
    const clean = value.trim();
    if (clean) phrases.add(clean);
  };
  add(note.path.replace(/\.(md|markdown)$/i, ""));
  add(basename(note.path, extname(note.path)));
  add(note.title);
  const aliases = note.props.aliases;
  if (Array.isArray(aliases)) aliases.forEach(add);
  return [...phrases].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

function maskExplicitWikilinks(text: string): string {
  return maskSpsWikilinks(text);
}

function phraseRegex(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_-])(${escaped})(?=$|[^A-Za-z0-9_-])`, "i");
}

export function findUnlinkedMentionTargets(
  body: string,
  notes: NoteRecord[],
  source: string,
): UnlinkedMentionHit[] {
  const searchable = maskExplicitWikilinks(body);
  const hits: UnlinkedMentionHit[] = [];
  for (const note of notes) {
    if (note.path === source) continue;
    for (const phrase of mentionPhrases(note)) {
      if (!phraseRegex(phrase).test(searchable)) continue;
      hits.push({ source, target: note.path, phrase });
      break;
    }
  }
  return hits.sort(
    (a, b) =>
      a.target.localeCompare(b.target) || a.phrase.localeCompare(b.phrase),
  );
}

function isNoteFile(path: string): boolean {
  return NOTE_EXTENSIONS.has(extname(path).toLowerCase());
}

/** A path segment we never index (dotfiles, .history, the index db itself). */
function isHidden(relPath: string): boolean {
  return relPath.split("/").some((part) => part.startsWith("."));
}

/** Only [A-Za-z0-9_.] property names reach the SQL json path (injection guard). */
function safeProp(prop: string): string | null {
  return /^[A-Za-z0-9_.]+$/.test(prop) ? prop : null;
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function isRecoverableIndexOpenError(error: unknown): boolean {
  const code = errorCode(error);
  if (
    code !== null &&
    (code === "SQLITE_NOTADB" || code.startsWith("SQLITE_CORRUPT"))
  ) {
    return true;
  }

  const message = formatLogError(error).toLowerCase();
  return (
    message.includes("file is not a database") ||
    message.includes("database disk image is malformed")
  );
}

async function deleteIndexFiles(root: string): Promise<void> {
  for (const file of INDEX_DB_SIDE_FILES) {
    try {
      await unlink(join(root, file));
    } catch (err) {
      if (errorCode(err) !== "ENOENT") throw err;
    }
  }
}

// ── the index ─────────────────────────────────────────────────────────────────

export class NoteIndex {
  private db: Database.Database;
  private watcher: FSWatcher | null = null;
  private ensuredPropIndexes = new Set<string>();
  private indexedAt: number | null = null;
  private stmts!: Record<string, Database.Statement>;
  private nameToPathCache: Map<string, string> | null = null;
  private knownNameCache: Set<string> | null = null;
  private indexedMtimes = new Map<string, number>();
  private watcherPending = new Map<string, "upsert" | "unlink">();
  private watcherDrainTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor(
    public readonly root: string,
    dbPath: string,
  ) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.ensureSchema();
    this.prepareStatements();
    this.loadExistingPropIndexes();
  }

  private prepareStatements(): void {
    this.stmts = {
      countNotes: this.db.prepare(`SELECT COUNT(*) AS n FROM notes`),
      countLinks: this.db.prepare(`SELECT COUNT(*) AS n FROM links`),
      upsertNote: this.db.prepare(
        `INSERT INTO notes(path,title,props,body,mtime,updated_at)
         VALUES(@path,@title,@props,@body,@mtime,@now)
         ON CONFLICT(path) DO UPDATE SET
           title=@title, props=@props, body=@body, mtime=@mtime, updated_at=@now`,
      ),
      deleteFts: this.db.prepare(`DELETE FROM notes_fts WHERE path = ?`),
      insertFts: this.db.prepare(
        `INSERT INTO notes_fts(path,title,body) VALUES(?,?,?)`,
      ),
      deleteLinksForSource: this.db.prepare(
        `DELETE FROM links WHERE source = ?`,
      ),
      insertLink: this.db.prepare(
        `INSERT INTO links(source,target_norm,type,kind,target_heading,target_block_id)
         VALUES(?,?,?,?,?,?)`,
      ),
      deleteTagsForSource: this.db.prepare(`DELETE FROM tags WHERE source = ?`),
      insertTag: this.db.prepare(`INSERT INTO tags(source,tag) VALUES(?,?)`),
      deleteNote: this.db.prepare(`DELETE FROM notes WHERE path = ?`),
      selectRecordByPath: this.db.prepare(
        `SELECT path,title,props,mtime FROM notes WHERE path = ?`,
      ),
      selectAllNoteMetadata: this.db.prepare(
        `SELECT path,title,props,mtime FROM notes`,
      ),
      selectAllNotePaths: this.db.prepare(`SELECT path FROM notes`),
      selectAllLinks: this.db.prepare(
        `SELECT source, target_norm, type, kind, target_heading, target_block_id FROM links`,
      ),
      selectOtherNoteBodies: this.db.prepare(
        `SELECT path, body FROM notes WHERE path != ?`,
      ),
      staleNotes: this.db.prepare(
        `SELECT path FROM notes WHERE mtime > 0 AND mtime < ? AND instr(path,'/') = 0 ORDER BY mtime ASC`,
      ),
      allTags: this.db.prepare(
        `SELECT tag, COUNT(DISTINCT source) AS count
         FROM tags GROUP BY tag COLLATE NOCASE
         ORDER BY count DESC, tag ASC`,
      ),
      notesByTag: this.db.prepare(
        `SELECT DISTINCT source FROM tags WHERE tag = ? COLLATE NOCASE`,
      ),
    };
  }

  private invalidateGraphCache(): void {
    this.nameToPathCache = null;
    this.knownNameCache = null;
  }

  private loadExistingPropIndexes(): void {
    try {
      const rows = this.db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_prop_%'`,
        )
        .all() as Array<{ name: string }>;
      for (const row of rows) {
        this.ensuredPropIndexes.add(row.name);
      }
    } catch (err) {
      log.error("note-index", {
        msg: "failed to load existing expression indexes",
        error: formatLogError(err),
      });
    }
  }

  /** Open (or create) the index for a workspace root and do an initial scan. */
  static async open(root: string): Promise<NoteIndex> {
    const dbPath = join(root, INDEX_DB_FILE);
    try {
      return await NoteIndex.openFresh(root, dbPath);
    } catch (err) {
      if (!isRecoverableIndexOpenError(err)) throw err;
      log.warn("note-index", {
        msg: "derived SQLite index is corrupt; deleting and rebuilding from markdown",
        root,
        error: formatLogError(err),
      });
      await deleteIndexFiles(root);
      return NoteIndex.openFresh(root, dbPath);
    }
  }

  private static async openFresh(
    root: string,
    dbPath: string,
  ): Promise<NoteIndex> {
    let idx: NoteIndex | null = null;
    try {
      idx = new NoteIndex(root, dbPath);
      const count = idx.count("notes");
      if (count === 0) await idx.rebuild();
      return idx;
    } catch (err) {
      if (idx) {
        try {
          await idx.close();
        } catch (closeErr) {
          log.warn("note-index", {
            msg: "failed to close index after open failure",
            root,
            error: formatLogError(closeErr),
          });
        }
      }
      throw err;
    }
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        path TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        props TEXT NOT NULL DEFAULT '{}',
        body TEXT NOT NULL DEFAULT '',
        mtime INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS links (
        source TEXT NOT NULL,
        target_norm TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'link',
        kind TEXT NOT NULL DEFAULT 'link',
        target_heading TEXT,
        target_block_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_norm);
      CREATE INDEX IF NOT EXISTS idx_links_source ON links(source);
      CREATE TABLE IF NOT EXISTS tags (
        source TEXT NOT NULL,
        tag TEXT NOT NULL COLLATE NOCASE
      );
      CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
      CREATE INDEX IF NOT EXISTS idx_tags_source ON tags(source);
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts
        USING fts5(path UNINDEXED, title, body, tokenize='porter');
    `);

    // Migrate existing DB if links table does not have 'type' column
    try {
      const columns = this.db
        .prepare("PRAGMA table_info(links)")
        .all() as Array<{ name: string }>;
      const existing = new Set(columns.map((col) => col.name));
      const migrations: string[] = [];
      if (columns.length > 0 && !existing.has("type")) {
        migrations.push(
          "ALTER TABLE links ADD COLUMN type TEXT NOT NULL DEFAULT 'link'",
        );
      }
      if (columns.length > 0 && !existing.has("kind")) {
        migrations.push(
          "ALTER TABLE links ADD COLUMN kind TEXT NOT NULL DEFAULT 'link'",
        );
      }
      if (columns.length > 0 && !existing.has("target_heading")) {
        migrations.push("ALTER TABLE links ADD COLUMN target_heading TEXT");
      }
      if (columns.length > 0 && !existing.has("target_block_id")) {
        migrations.push("ALTER TABLE links ADD COLUMN target_block_id TEXT");
      }
      if (migrations.length > 0) this.db.exec(migrations.join(";"));
    } catch (err) {
      log.error("note-index", {
        msg: "failed to run links table migration",
        error: formatLogError(err),
      });
    }
  }

  private count(table: "notes" | "links"): number {
    const row = this.stmts[
      table === "notes" ? "countNotes" : "countLinks"
    ].get() as {
      n: number;
    };
    return row.n;
  }

  // ── writes (index maintenance only — never touches markdown files) ──────────

  /** Index one note from its already-read content. Replaces any prior row. */
  private upsert(relPath: string, raw: string, mtime: number): void {
    const { props, body } = parseFrontmatter(raw);
    const title = deriveTitle(props, body, relPath);
    const propsJson = JSON.stringify(props ?? {});
    const typedLinks = extractBacklinks(body, props);
    const now = Date.now();

    if (props && typeof props === "object") {
      for (const key of Object.keys(props)) {
        this.ensurePropIndex(key);
      }
    }

    const tx = this.db.transaction(() => {
      this.stmts.upsertNote.run({
        path: relPath,
        title,
        props: propsJson,
        body,
        mtime,
        now,
      });

      this.stmts.deleteFts.run(relPath);
      this.stmts.insertFts.run(relPath, title, body);

      this.stmts.deleteLinksForSource.run(relPath);
      for (const link of typedLinks)
        this.stmts.insertLink.run(
          relPath,
          link.target_norm,
          link.type,
          link.kind,
          link.target_heading ?? null,
          link.target_block_id ?? null,
        );

      // Tags: frontmatter `tags` (array or string) + inline `#tag`s in the body.
      this.stmts.deleteTagsForSource.run(relPath);
      const fmTags = frontmatterTags(props);
      const inlineTags = extractInlineTags(body);
      const tags = new Set(
        [...fmTags, ...inlineTags].map(normalizeTag).filter(Boolean),
      );
      for (const tag of tags) this.stmts.insertTag.run(relPath, tag);
    });
    tx();
    this.invalidateGraphCache();
  }

  private remove(relPath: string): void {
    const tx = this.db.transaction(() => {
      this.stmts.deleteNote.run(relPath);
      this.stmts.deleteFts.run(relPath);
      this.stmts.deleteLinksForSource.run(relPath);
      this.stmts.deleteTagsForSource.run(relPath);
    });
    tx();
    this.invalidateGraphCache();
  }

  private async indexAbsolute(
    absPath: string,
    opts: { skipUnchanged?: boolean; logFailures?: boolean } = {},
  ): Promise<boolean> {
    if (!isNoteFile(absPath)) return false;
    const relPath = relative(this.root, absPath).split(sep).join("/");
    if (isHidden(relPath)) return false;
    try {
      const info = await stat(absPath);
      if (
        opts.skipUnchanged &&
        this.indexedMtimes.get(absPath) === info.mtimeMs
      ) {
        return false;
      }
      const raw = await readFile(absPath, "utf-8");
      this.upsert(relPath, raw, info.mtimeMs);
      this.indexedMtimes.set(absPath, info.mtimeMs);
      return true;
    } catch (err) {
      if (opts.logFailures) {
        log.warn("note-index.upsert", {
          path: relPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      // File vanished between event and read — drop it from the index.
      this.remove(relPath);
      this.indexedMtimes.delete(absPath);
      return true;
    }
  }

  /** Wipe and rebuild from disk. Always safe: the markdown files are the truth. */
  async rebuild(): Promise<NoteIndexStatus> {
    this.db.exec(
      `DELETE FROM notes; DELETE FROM notes_fts; DELETE FROM links; DELETE FROM tags;`,
    );
    this.indexedMtimes.clear();
    this.invalidateGraphCache();
    for (const absPath of await this.walk(this.root)) {
      await this.indexAbsolute(absPath);
    }
    this.indexedAt = Date.now();
    semanticManager.triggerIndex(this.root);
    return this.status();
  }

  private async walk(dir: string): Promise<string[]> {
    const out: string[] = [];
    let entries: Dirent[];
    try {
      entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
    } catch {
      return out;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...(await this.walk(abs)));
      } else if (entry.isFile() && isNoteFile(abs)) {
        out.push(abs);
      }
    }
    return out;
  }

  // ── reads ───────────────────────────────────────────────────────────────────

  private rowToRecord(row: {
    path: string;
    title: string;
    props: string;
    mtime: number;
  }): NoteRecord {
    let props: Record<string, unknown> = {};
    try {
      props = JSON.parse(row.props) as Record<string, unknown>;
    } catch {
      /* corrupt row — treat as empty props */
    }
    return { path: row.path, title: row.title, props, mtime: row.mtime };
  }

  private linkTargetNames(note: NoteRecord): string[] {
    const names = new Set(candidateNames(note.path));
    const add = (value: unknown): void => {
      if (typeof value !== "string") return;
      const norm = normalizeName(value);
      if (norm) names.add(norm);
    };
    add(note.title);
    const aliases = note.props.aliases;
    if (Array.isArray(aliases)) aliases.forEach(add);
    return [...names].filter(Boolean);
  }

  private recordForPath(relPath: string): NoteRecord | null {
    const row = this.stmts.selectRecordByPath.get(relPath) as
      | { path: string; title: string; props: string; mtime: number }
      | undefined;
    return row ? this.rowToRecord(row) : null;
  }

  private getNameToPath(): Map<string, string> {
    if (this.nameToPathCache) return this.nameToPathCache;
    const notes = (
      this.stmts.selectAllNoteMetadata.all() as Array<{
        path: string;
        title: string;
        props: string;
        mtime: number;
      }>
    ).map((row) => this.rowToRecord(row));
    const nameToPath = new Map<string, string>();
    for (const note of notes) {
      for (const name of this.linkTargetNames(note)) {
        if (!nameToPath.has(name)) nameToPath.set(name, note.path);
      }
    }
    this.nameToPathCache = nameToPath;
    return nameToPath;
  }

  private getKnownNames(): Set<string> {
    if (this.knownNameCache) return this.knownNameCache;
    this.knownNameCache = new Set(this.getNameToPath().keys());
    return this.knownNameCache;
  }

  /** Ensure an expression index over a frontmatter property exists (lazy). */
  private ensurePropIndex(prop: string): void {
    const safe = safeProp(prop);
    if (!safe) return;
    if (!INDEXED_PROPERTIES.has(safe.toLowerCase())) return;
    const name = `idx_prop_${safe.replace(/\./g, "_")}`;
    if (this.ensuredPropIndexes.has(name)) return;
    try {
      this.db.exec(
        `CREATE INDEX IF NOT EXISTS ${name} ON notes(json_extract(props,'$.${safe}'))`,
      );
      this.ensuredPropIndexes.add(name);
    } catch (err) {
      log.error("note-index", {
        msg: "failed to create expression index",
        prop,
        error: formatLogError(err),
      });
    }
  }

  /** Query notes as a database view (scope + property filters + sort). */
  query(q: NoteQuery = {}): NoteRecord[] {
    const clauses: string[] = ["1=1"];
    const params: unknown[] = [];

    if (q.scope) {
      const prefix = q.scope.replace(/\\/g, "/").replace(/\/+$/, "");
      clauses.push(`path LIKE ?`);
      params.push(`${prefix}/%`);
    }

    for (const f of q.filters ?? []) {
      const safe = safeProp(f.prop);
      if (!safe) continue;
      const expr = `json_extract(props,'$.${safe}')`;
      if (f.op === "exists") {
        clauses.push(`${expr} IS NOT NULL`);
      } else if (f.op === "eq") {
        clauses.push(`${expr} = ?`);
        params.push(f.value);
      } else if (f.op === "neq") {
        clauses.push(`(${expr} IS NULL OR ${expr} != ?)`);
        params.push(f.value);
      } else if (f.op === "contains") {
        clauses.push(`${expr} LIKE ?`);
        params.push(`%${String(f.value ?? "")}%`);
      }
    }

    let sql = `SELECT path,title,props,mtime FROM notes WHERE ${clauses.join(" AND ")}`;
    if (q.sort) {
      const safe = safeProp(q.sort.prop);
      if (safe) {
        const dir = q.sort.dir === "desc" ? "DESC" : "ASC";
        sql += ` ORDER BY json_extract(props,'$.${safe}') ${dir}`;
      }
    } else {
      sql += ` ORDER BY mtime DESC`;
    }
    sql += ` LIMIT ?`;
    params.push(Math.max(1, Math.min(q.limit ?? 500, 2000)));

    const rows = this.db.prepare(sql).all(...params) as Array<{
      path: string;
      title: string;
      props: string;
      mtime: number;
    }>;
    return rows.map((r) => this.rowToRecord(r));
  }

  /**
   * Full-text search over title + body (FTS5).
   *
   * `mode` controls how the query terms combine:
   *  - "all" (default): every term must match (AND). Right for short, deliberate
   *    in-app search boxes where the user types exactly the terms they want.
   *  - "any": any term may match (OR), ranked by relevance. Right for grounding
   *    a full natural-language chat message, where requiring every word (incl.
   *    "what"/"the"/"does") would almost never match. Callers should strip
   *    stopwords first so common words don't dominate; ranking does the rest.
   */
  search(
    text: string,
    limit = 20,
    mode: "all" | "any" = "all",
  ): NoteSearchHit[] {
    const cleaned = text.trim();
    if (!cleaned) return [];
    // Sanitize into a prefix-match FTS query: quote each token, append *.
    const ftsQuery = cleaned
      .split(/\s+/)
      .map((w) => `"${w.replace(/"/g, '""')}"*`)
      .join(mode === "any" ? " OR " : " ");
    try {
      const rows = this.db
        .prepare(
          `SELECT notes_fts.path AS path, notes_fts.title AS title,
                  snippet(notes_fts, 2, '⟦', '⟧', '…', 12) AS snippet,
                  n.mtime AS mtime
           FROM notes_fts
           JOIN notes n ON n.path = notes_fts.path
           WHERE notes_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(ftsQuery, Math.max(1, Math.min(limit, 100))) as NoteSearchHit[];
      return rows;
    } catch {
      return [];
    }
  }

  /** Notes that [[wikilink]] to the given note (order-independent resolution). */
  backlinks(relPath: string): string[] {
    const note = this.recordForPath(relPath);
    const candidates = note
      ? this.linkTargetNames(note)
      : candidateNames(relPath);
    if (candidates.length === 0) return [];
    const placeholders = candidates.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT DISTINCT source FROM links WHERE target_norm IN (${placeholders})`,
      )
      .all(...candidates) as Array<{ source: string }>;
    return rows.map((r) => r.source).filter((p) => p !== relPath);
  }

  backlinkDetails(relPath: string): VaultLinkEdge[] {
    const note = this.recordForPath(relPath);
    const candidates = note
      ? this.linkTargetNames(note)
      : candidateNames(relPath);
    if (candidates.length === 0) return [];
    const placeholders = candidates.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT source, target_norm, type, kind, target_heading, target_block_id
         FROM links WHERE target_norm IN (${placeholders})`,
      )
      .all(...candidates) as Array<{
      source: string;
      target_norm: string;
      type: string;
      kind: "link" | "embed";
      target_heading: string | null;
      target_block_id: string | null;
    }>;
    const out: VaultLinkEdge[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.source === relPath) continue;
      const key = [
        row.source,
        row.type,
        row.kind,
        row.target_heading ?? "",
        row.target_block_id ?? "",
      ].join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        source: row.source,
        target: relPath,
        type: row.type,
        kind: row.kind,
        ...(row.target_heading ? { targetHeading: row.target_heading } : {}),
        ...(row.target_block_id ? { targetBlockId: row.target_block_id } : {}),
      });
    }
    return out;
  }

  /** All resolved [[wikilink]] edges as {source, target} relPaths (F4 graph
   *  view). Only edges whose target resolves to an indexed note are returned;
   *  self-links and duplicate edges are dropped. */
  links(): VaultLinkEdge[] {
    const nameToPath = this.getNameToPath();
    const rows = this.stmts.selectAllLinks.all() as Array<{
      source: string;
      target_norm: string;
      type: string;
      kind: "link" | "embed";
      target_heading: string | null;
      target_block_id: string | null;
    }>;
    const edges: VaultLinkEdge[] = [];
    const seen = new Set<string>();
    for (const {
      source,
      target_norm,
      type,
      kind,
      target_heading,
      target_block_id,
    } of rows) {
      const target = nameToPath.get(target_norm);
      if (!target || target === source) continue;
      const key = [
        source,
        target,
        type,
        kind,
        target_heading ?? "",
        target_block_id ?? "",
      ].join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        source,
        target,
        type,
        kind,
        ...(target_heading ? { targetHeading: target_heading } : {}),
        ...(target_block_id ? { targetBlockId: target_block_id } : {}),
      });
    }
    return edges;
  }

  /** Raw [[wikilink]]s whose target does NOT resolve to an indexed note
   *  (broken links — the inverse of links(), for lint). Deduped per edge. */
  unresolvedLinks(): VaultLinkEdge[] {
    const known = this.getKnownNames();
    const rows = this.stmts.selectAllLinks.all() as Array<{
      source: string;
      target_norm: string;
      type: string;
      kind: "link" | "embed";
      target_heading: string | null;
      target_block_id: string | null;
    }>;
    const out: VaultLinkEdge[] = [];
    const seen = new Set<string>();
    for (const {
      source,
      target_norm,
      type,
      kind,
      target_heading,
      target_block_id,
    } of rows) {
      if (known.has(target_norm)) continue;
      const key = [
        source,
        target_norm,
        type,
        kind,
        target_heading ?? "",
        target_block_id ?? "",
      ].join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        source,
        target: target_norm,
        type,
        kind,
        ...(target_heading ? { targetHeading: target_heading } : {}),
        ...(target_block_id ? { targetBlockId: target_block_id } : {}),
      });
    }
    return out;
  }

  /** Root-level pages with no resolved inbound OR outbound [[wikilink]] — isolated
   *  pages. Excludes nested files (folder-DB rows, _inbox captures): those aren't
   *  wiki pages and aren't meant to be linked. Also excludes the wiki META pages
   *  (index / log / WIKI): catalog/log/schema artifacts are intentionally
   *  link-free and would otherwise show as permanent orphan noise. */
  orphans(): string[] {
    const notes = this.stmts.selectAllNotePaths.all() as Array<{
      path: string;
    }>;
    const connected = new Set<string>();
    for (const edge of this.links()) {
      // Links FROM a META page (the auto-generated index links to every page)
      // are navigational, not real connectivity — they must not mask an orphan.
      if (WIKI_META_PAGES.has(edge.source)) continue;
      connected.add(edge.source);
      connected.add(edge.target);
    }
    const result: string[] = [];
    for (const { path } of notes) {
      if (path.includes("/")) continue; // skip rows / captures / assets
      if (WIKI_META_PAGES.has(path)) continue; // skip index/log/WIKI
      if (!connected.has(path)) result.push(path);
    }
    return result.sort();
  }

  /** A composed lint report over the vault. `staleBeforeMs` (optional) flags
   *  notes whose file mtime predates it. */
  lint(staleBeforeMs?: number): {
    orphans: string[];
    brokenLinks: VaultLinkEdge[];
    stale: string[];
  } {
    const orphans = this.orphans();
    const brokenLinks = this.unresolvedLinks();
    let stale: string[] = [];
    if (staleBeforeMs && staleBeforeMs > 0) {
      // Root-level pages only (exclude rows / captures), like orphans().
      const rows = this.stmts.staleNotes.all(staleBeforeMs) as Array<{
        path: string;
      }>;
      stale = rows.map((r) => r.path);
    }
    return { orphans, brokenLinks, stale };
  }

  /** All tags with their note counts, most-used first (for tag clouds/filters). */
  allTags(): Array<{ tag: string; count: number }> {
    return this.stmts.allTags.all() as Array<{ tag: string; count: number }>;
  }

  /** Relpaths of notes carrying the given tag (case-insensitive). */
  notesByTag(tag: string): string[] {
    const clean = normalizeTag(tag);
    if (!clean) return [];
    const rows = this.stmts.notesByTag.all(clean) as Array<{ source: string }>;
    return rows.map((r) => r.source);
  }

  unlinkedMentions(relPath: string): UnlinkedMentionHit[] {
    const target = this.recordForPath(relPath);
    if (!target) return [];
    const phrases = mentionPhrases(target);
    if (phrases.length === 0) return [];
    const rows = this.stmts.selectOtherNoteBodies.all(relPath) as Array<{
      path: string;
      body: string;
    }>;
    const hits: UnlinkedMentionHit[] = [];
    for (const row of rows) {
      const searchable = maskExplicitWikilinks(row.body);
      for (const phrase of phrases) {
        if (!phraseRegex(phrase).test(searchable)) continue;
        hits.push({ source: row.path, target: relPath, phrase });
        break;
      }
    }
    return hits.sort(
      (a, b) =>
        a.source.localeCompare(b.source) || a.phrase.localeCompare(b.phrase),
    );
  }

  status(): NoteIndexStatus {
    return {
      root: this.root,
      notes: this.count("notes"),
      links: this.count("links"),
      indexedAt: this.indexedAt,
    };
  }

  // ── live updates ────────────────────────────────────────────────────────────

  startWatcher(): void {
    if (this.watcher) return;
    this.watcher = chokidar.watch(this.root, {
      ignoreInitial: true,
      ignored: (path) => path.split(sep).some((p) => p.startsWith(".")),
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    });
    this.watcher.on("add", (abs) => this.queueWatcherEvent(abs, "upsert"));
    this.watcher.on("change", (abs) => this.queueWatcherEvent(abs, "upsert"));
    this.watcher.on("unlink", (abs) => this.queueWatcherEvent(abs, "unlink"));
  }

  private queueWatcherEvent(abs: string, kind: "upsert" | "unlink"): void {
    this.watcherPending.set(abs, kind);
    if (this.watcherDrainTimer) clearTimeout(this.watcherDrainTimer);
    this.watcherDrainTimer = setTimeout(() => {
      this.watcherDrainTimer = null;
      void this.drainWatcherEvents();
    }, 250);
  }

  private async drainWatcherEvents(): Promise<void> {
    const pending = Array.from(this.watcherPending.entries());
    this.watcherPending.clear();
    let changed = false;
    for (const [abs, kind] of pending) {
      const relPath = relative(this.root, abs).split(sep).join("/");
      try {
        if (kind === "unlink") {
          this.remove(relPath);
          this.indexedMtimes.delete(abs);
          changed = true;
          continue;
        }
        const didChange = await this.indexAbsolute(abs, {
          skipUnchanged: true,
          logFailures: true,
        });
        changed = changed || didChange;
      } catch (err) {
        log.warn("note-index.watcher", {
          path: relPath,
          event: kind,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (changed) semanticManager.triggerIndex(this.root);
  }

  async close(): Promise<void> {
    if (this.watcherDrainTimer) {
      clearTimeout(this.watcherDrainTimer);
      this.watcherDrainTimer = null;
    }
    this.watcherPending.clear();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.db.close();
  }
}

// ── per-root lifecycle cache ───────────────────────────────────────────────────

const instances = new Map<string, Promise<NoteIndex>>();

/** Get (or lazily create) the live note index for an arbitrary markdown root. */
export async function getNoteIndexForRoot(root: string): Promise<NoteIndex> {
  let pending = instances.get(root);
  if (!pending) {
    pending = (async (): Promise<NoteIndex> => {
      await mkdir(root, { recursive: true }); // better-sqlite3 needs the dir
      const idx = await NoteIndex.open(root);
      idx.startWatcher();
      semanticManager.triggerIndex(root);
      return idx;
    })();
    instances.set(root, pending);
    pending.catch(() => {
      if (instances.get(root) === pending) instances.delete(root);
    });
  }
  return pending;
}

/** The live index for a profile's SPS page vault (the S2b mirror target).
 *  Honors a shared-directory override (e.g. an Obsidian vault) via sps-storage. */
export async function getSpsNoteIndex(profile?: string): Promise<NoteIndex> {
  return getNoteIndexForRoot(resolveSpsVaultDir(profile));
}

/** Close every open index (call on profile switch / app quit). */
export async function closeAllNoteIndexes(): Promise<void> {
  const pending = Array.from(instances.values());
  instances.clear();
  for (const p of pending) {
    try {
      const idx = await p;
      await idx.close();
    } catch {
      /* best-effort */
    }
  }
}
