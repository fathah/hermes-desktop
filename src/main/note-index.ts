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
import { mkdir, readdir, readFile, stat } from "fs/promises";
import { basename, extname, join, relative, sep } from "path";
import chokidar, { type FSWatcher } from "chokidar";
import YAML from "yaml";
import { resolveSpsVaultDir } from "./sps-storage";
import { semanticManager } from "./semantic-index";

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
function extractBacklinks(content: string): string[] {
  const links = new Set<string>();
  const re = /\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const target = match[1]?.trim();
    if (target) links.add(target);
  }
  return [...links];
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
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface NoteRecord {
  path: string;
  title: string;
  props: Record<string, unknown>;
  mtime: number;
}

export interface NoteSearchHit {
  path: string;
  title: string;
  snippet: string;
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
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { props: {}, body: raw };
  const body = raw.slice(match[0].length);
  try {
    const parsed = YAML.parse(match[1]);
    const props =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    return { props, body };
  } catch {
    return { props: {}, body };
  }
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

// ── the index ─────────────────────────────────────────────────────────────────

export class NoteIndex {
  private db: Database.Database;
  private watcher: FSWatcher | null = null;
  private ensuredPropIndexes = new Set<string>();
  private indexedAt: number | null = null;

  private constructor(
    public readonly root: string,
    dbPath: string,
  ) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.ensureSchema();
    this.loadExistingPropIndexes();
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
      console.error(
        "[NoteIndex] failed to load existing expression indexes:",
        err,
      );
    }
  }

  /** Open (or create) the index for a workspace root and do an initial scan. */
  static async open(root: string): Promise<NoteIndex> {
    const idx = new NoteIndex(root, join(root, INDEX_DB_FILE));
    const count = idx.count("notes");
    if (count === 0) await idx.rebuild();
    return idx;
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
        target_norm TEXT NOT NULL
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
  }

  private count(table: "notes" | "links"): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
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
    const targets = extractBacklinks(raw).map(normalizeName).filter(Boolean);
    const now = Date.now();

    if (props && typeof props === "object") {
      for (const key of Object.keys(props)) {
        this.ensurePropIndex(key);
      }
    }

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO notes(path,title,props,body,mtime,updated_at)
           VALUES(@path,@title,@props,@body,@mtime,@now)
           ON CONFLICT(path) DO UPDATE SET
             title=@title, props=@props, body=@body, mtime=@mtime, updated_at=@now`,
        )
        .run({ path: relPath, title, props: propsJson, body, mtime, now });

      this.db.prepare(`DELETE FROM notes_fts WHERE path = ?`).run(relPath);
      this.db
        .prepare(`INSERT INTO notes_fts(path,title,body) VALUES(?,?,?)`)
        .run(relPath, title, body);

      this.db.prepare(`DELETE FROM links WHERE source = ?`).run(relPath);
      const insLink = this.db.prepare(
        `INSERT INTO links(source,target_norm) VALUES(?,?)`,
      );
      for (const target of new Set(targets)) insLink.run(relPath, target);

      // Tags: frontmatter `tags` (array or string) + inline `#tag`s in the body.
      this.db.prepare(`DELETE FROM tags WHERE source = ?`).run(relPath);
      const fmTags = frontmatterTags(props);
      const inlineTags = extractInlineTags(body);
      const tags = new Set(
        [...fmTags, ...inlineTags].map(normalizeTag).filter(Boolean),
      );
      const insTag = this.db.prepare(
        `INSERT INTO tags(source,tag) VALUES(?,?)`,
      );
      for (const tag of tags) insTag.run(relPath, tag);
    });
    tx();
  }

  private remove(relPath: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM notes WHERE path = ?`).run(relPath);
      this.db.prepare(`DELETE FROM notes_fts WHERE path = ?`).run(relPath);
      this.db.prepare(`DELETE FROM links WHERE source = ?`).run(relPath);
      this.db.prepare(`DELETE FROM tags WHERE source = ?`).run(relPath);
    });
    tx();
  }

  private async indexAbsolute(absPath: string): Promise<void> {
    if (!isNoteFile(absPath)) return;
    const relPath = relative(this.root, absPath).split(sep).join("/");
    if (isHidden(relPath)) return;
    try {
      const raw = await readFile(absPath, "utf-8");
      const info = await stat(absPath);
      this.upsert(relPath, raw, info.mtimeMs);
    } catch {
      // File vanished between event and read — drop it from the index.
      this.remove(relPath);
    }
  }

  /** Wipe and rebuild from disk. Always safe: the markdown files are the truth. */
  async rebuild(): Promise<NoteIndexStatus> {
    this.db.exec(
      `DELETE FROM notes; DELETE FROM notes_fts; DELETE FROM links; DELETE FROM tags;`,
    );
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
      console.error(
        `[NoteIndex] failed to create expression index for ${prop}:`,
        err,
      );
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
          `SELECT path, title,
                  snippet(notes_fts, 2, '⟦', '⟧', '…', 12) AS snippet
           FROM notes_fts
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
    const candidates = candidateNames(relPath);
    if (candidates.length === 0) return [];
    const placeholders = candidates.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT DISTINCT source FROM links WHERE target_norm IN (${placeholders})`,
      )
      .all(...candidates) as Array<{ source: string }>;
    return rows.map((r) => r.source).filter((p) => p !== relPath);
  }

  /** All resolved [[wikilink]] edges as {source, target} relPaths (F4 graph
   *  view). Only edges whose target resolves to an indexed note are returned;
   *  self-links and duplicate edges are dropped. */
  links(): Array<{ source: string; target: string }> {
    const notes = this.db.prepare(`SELECT path FROM notes`).all() as Array<{
      path: string;
    }>;
    // Map each note's candidate names → its relPath so a normalized link target
    // resolves to a concrete note (first note to claim a name wins).
    const nameToPath = new Map<string, string>();
    for (const { path } of notes) {
      for (const name of candidateNames(path)) {
        if (!nameToPath.has(name)) nameToPath.set(name, path);
      }
    }
    const rows = this.db
      .prepare(`SELECT source, target_norm FROM links`)
      .all() as Array<{ source: string; target_norm: string }>;
    const edges: Array<{ source: string; target: string }> = [];
    const seen = new Set<string>();
    for (const { source, target_norm } of rows) {
      const target = nameToPath.get(target_norm);
      if (!target || target === source) continue;
      const key = `${source} ${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source, target });
    }
    return edges;
  }

  /** Raw [[wikilink]]s whose target does NOT resolve to an indexed note
   *  (broken links — the inverse of links(), for lint). Deduped per edge. */
  unresolvedLinks(): Array<{ source: string; target: string }> {
    const notes = this.db.prepare(`SELECT path FROM notes`).all() as Array<{
      path: string;
    }>;
    const known = new Set<string>();
    for (const { path } of notes) {
      for (const name of candidateNames(path)) known.add(name);
    }
    const rows = this.db
      .prepare(`SELECT source, target_norm FROM links`)
      .all() as Array<{ source: string; target_norm: string }>;
    const out: Array<{ source: string; target: string }> = [];
    const seen = new Set<string>();
    for (const { source, target_norm } of rows) {
      if (known.has(target_norm)) continue;
      const key = `${source} ${target_norm}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ source, target: target_norm });
    }
    return out;
  }

  /** Root-level pages with no resolved inbound OR outbound [[wikilink]] — isolated
   *  pages. Excludes nested files (folder-DB rows, _inbox captures): those aren't
   *  wiki pages and aren't meant to be linked. */
  orphans(): string[] {
    const notes = this.db.prepare(`SELECT path FROM notes`).all() as Array<{
      path: string;
    }>;
    const connected = new Set<string>();
    for (const edge of this.links()) {
      connected.add(edge.source);
      connected.add(edge.target);
    }
    const result: string[] = [];
    for (const { path } of notes) {
      if (path.includes("/")) continue; // skip rows / captures / assets
      if (!connected.has(path)) result.push(path);
    }
    return result.sort();
  }

  /** A composed lint report over the vault. `staleBeforeMs` (optional) flags
   *  notes whose file mtime predates it. */
  lint(staleBeforeMs?: number): {
    orphans: string[];
    brokenLinks: Array<{ source: string; target: string }>;
    stale: string[];
  } {
    const orphans = this.orphans();
    const brokenLinks = this.unresolvedLinks();
    let stale: string[] = [];
    if (staleBeforeMs && staleBeforeMs > 0) {
      // Root-level pages only (exclude rows / captures), like orphans().
      const rows = this.db
        .prepare(
          `SELECT path FROM notes WHERE mtime > 0 AND mtime < ? AND instr(path,'/') = 0 ORDER BY mtime ASC`,
        )
        .all(staleBeforeMs) as Array<{ path: string }>;
      stale = rows.map((r) => r.path);
    }
    return { orphans, brokenLinks, stale };
  }

  /** All tags with their note counts, most-used first (for tag clouds/filters). */
  allTags(): Array<{ tag: string; count: number }> {
    return this.db
      .prepare(
        `SELECT tag, COUNT(DISTINCT source) AS count
         FROM tags GROUP BY tag COLLATE NOCASE
         ORDER BY count DESC, tag ASC`,
      )
      .all() as Array<{ tag: string; count: number }>;
  }

  /** Relpaths of notes carrying the given tag (case-insensitive). */
  notesByTag(tag: string): string[] {
    const clean = normalizeTag(tag);
    if (!clean) return [];
    const rows = this.db
      .prepare(`SELECT DISTINCT source FROM tags WHERE tag = ? COLLATE NOCASE`)
      .all(clean) as Array<{ source: string }>;
    return rows.map((r) => r.source);
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
    });
    const onUpsert = (abs: string): void => {
      this.indexAbsolute(abs)
        .then(() => {
          semanticManager.triggerIndex(this.root);
        })
        .catch(() => {});
    };
    const onUnlink = (abs: string): void => {
      const relPath = relative(this.root, abs).split(sep).join("/");
      this.remove(relPath);
      semanticManager.triggerIndex(this.root);
    };
    this.watcher.on("add", onUpsert);
    this.watcher.on("change", onUpsert);
    this.watcher.on("unlink", onUnlink);
  }

  async close(): Promise<void> {
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
