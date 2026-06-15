// sps-types.ts — domain model for the SPS Agent workspace.
// Derived from the prototype's data.jsx / store.jsx object shapes. The prototype
// uses loosely-typed objects; here every field is modelled but block-specific
// fields stay optional (a single Block interface) to keep the dynamic editor
// behaviour a faithful, low-friction port.

// A recent-session row as shown in the sidebar / cockpit (a display-only subset
// of the main SessionSummary). Consolidated from duplicate copies that lived in
// SidebarRecents and CockpitSurface.
export interface SessionRow {
  id: string;
  title: string | null;
  preview: string;
}

export type BlockType =
  | "p"
  | "h1"
  | "h2"
  | "h3"
  | "todo"
  | "li"
  | "numli"
  | "toggle"
  | "quote"
  | "callout"
  | "code"
  | "divider"
  | "image"
  | "audio"
  | "video"
  | "file"
  | "bookmark"
  | "page"
  | "database"
  // Diagram blocks. mermaid keeps its source in `text` (serialises to a clean
  // ```mermaid fence). excalidraw keeps a preview-SVG path in `src` and stores
  // its scene in a sidecar asset file — never inline in the markdown.
  | "mermaid"
  | "excalidraw"
  // Agent-action button: `text` is the label, `agentPrompt` the prompt it runs
  // against the co-author on click. Always serialises Tier-2 (custom field).
  | "button"
  // Side-by-side layout: holds 2–3 columns of rich text in `columns` (HTML per
  // column). A "special" block — NOT in the serializer's cleanTypes, so it
  // round-trips losslessly via the generic Tier-2 meta comment.
  | "columns";

export type DbView = "board" | "table" | "list" | "gallery" | "calendar";
export type StatusKey = "todo" | "doing" | "review" | "done" | "inbox" | "this_week" | "blocked";
export type PrioKey = "high" | "med" | "low";
export type PersonKey = string; // 'maya' | 'theo' | 'priya' | 'sam' (+ user-added)

export type SpsPropertyValue = string | number | boolean | string[] | null;
export type SpsPageSchemaKey =
  | "project"
  | "task"
  | "meeting"
  | "person"
  | "organization"
  | "source"
  | "decision"
  | "journal";

export interface SpsPropertySchema {
  key: string;
  label: string;
  type: "text" | "number" | "checkbox" | "date" | "datetime" | "tags";
  required?: boolean;
}

export interface SpsBaseViewConfig {
  source?: string;
  scope?: string;
  view: DbView;
  columns: string[];
  filters?: Array<{ prop: string; op: "eq" | "neq" | "contains" | "exists"; value?: SpsPropertyValue }>;
  sort?: { prop: string; dir: "asc" | "desc" };
  titleProperty?: string;
  schema?: SpsPageSchemaKey;
}

export type SpsImportSource =
  | { kind: "okf-bundle"; path: string }
  | { kind: "markdown-folder"; path: string }
  | { kind: "document-folder"; path: string };

export interface SpsImportPlanItem {
  sourcePath: string;
  targetPageId: string;
  targetPath: string;
  status: "create" | "conflict" | "skipped";
  reason?: string;
}

export interface SpsImportPlan {
  id: string;
  source: SpsImportSource;
  targetFolder?: string;
  items: SpsImportPlanItem[];
  summary: {
    filesScanned: number;
    pagesToCreate: number;
    conflicts: number;
    skipped: number;
  };
}

export interface SpsImportResult {
  success: boolean;
  pagesCreated: number;
  conflicts: number;
  skipped: number;
  error?: string;
}

export type VaultProposalStatus = "pending" | "committed" | "dismissed";
export type VaultOperationStatus = "pending" | "committed" | "skipped";

export interface VaultDiff {
  path: string;
  before?: string;
  after?: string;
}

interface VaultOperationBase {
  id: string;
  operationStatus?: VaultOperationStatus;
  diff?: VaultDiff;
}

export interface VaultUpsertPageOperation extends VaultOperationBase {
  kind: "upsert-page";
  pageId: string;
  title: string;
  markdown: string;
}

export interface VaultUpdateFrontmatterOperation extends VaultOperationBase {
  kind: "update-frontmatter";
  pageId: string;
  patch: Record<string, SpsPropertyValue | undefined>;
}

export interface VaultReplaceWikilinkOperation extends VaultOperationBase {
  kind: "replace-wikilink";
  pageId: string;
  from: string;
  to: string;
}

export interface VaultMarkDuplicateMergedOperation extends VaultOperationBase {
  kind: "mark-duplicate-merged";
  duplicatePageId: string;
  canonicalPageId: string;
}

export interface VaultCreateBasePageOperation extends VaultOperationBase {
  kind: "create-base-page";
  pageId: string;
  title: string;
  markdown: string;
  base: SpsBaseViewConfig;
}

export interface VaultMarkCaptureOperation extends VaultOperationBase {
  kind: "mark-capture";
  captureId: string;
  status: "processed" | "discarded";
}

export interface VaultAddMemoryOperation extends VaultOperationBase {
  kind: "add-memory";
  body: string;
}

export type VaultOperation =
  | VaultUpsertPageOperation
  | VaultUpdateFrontmatterOperation
  | VaultReplaceWikilinkOperation
  | VaultMarkDuplicateMergedOperation
  | VaultCreateBasePageOperation
  | VaultMarkCaptureOperation
  | VaultAddMemoryOperation;

export interface VaultProposalInput {
  source: "inbox" | "health" | "base" | "obsidian" | "context-pack" | "manual";
  title: string;
  summary: string;
  operations: VaultOperation[];
}

export interface VaultProposal extends VaultProposalInput {
  id: string;
  status: VaultProposalStatus;
  createdAt: number;
  updatedAt: number;
  operations: VaultOperation[];
}

export interface VaultHealthNoteSnapshot {
  path: string;
  title: string;
  props: Record<string, unknown>;
  body: string;
  mtime: number;
}

export interface VaultHealthReport {
  orphans: string[];
  brokenLinks: Array<{ source: string; target: string; type?: string }>;
  stale: string[];
  duplicateTitles: Array<{ title: string; paths: string[] }>;
  duplicateAliases: Array<{ alias: string; paths: string[] }>;
  missingSchemaFields: Array<{
    path: string;
    schema: string;
    missing: string[];
  }>;
  staleCaptures: Array<{ path: string; title: string; ageDays: number }>;
  unprocessedPdfs: Array<{ path: string; title: string }>;
  weaklyConnected: Array<{ path: string; degree: number }>;
}

export interface SpsContextPackInput {
  pageId: string;
  depth?: number;
  includeBacklinks?: boolean;
  includeTasks?: boolean;
  includeSources?: boolean;
  maxBytes?: number;
  save?: boolean;
}

export interface SpsContextPackResult {
  markdown: string;
  includedPaths: string[];
  truncated: boolean;
  savedPath?: string;
}

export type SpsBaseWorkbenchRecipeId =
  | "research"
  | "projects"
  | "decisions"
  | "people"
  | "meetings"
  | "tasks"
  | "sources";

export interface SpsBaseProposalInput {
  recipe: SpsBaseWorkbenchRecipeId;
  folder: string;
  pageId?: string;
}

export type SpsCaptureKind =
  | "note"
  | "source"
  | "project"
  | "person"
  | "decision"
  | "meeting"
  | "task"
  | "journal";

export interface SpsCaptureInput {
  source: "quick-note" | "web" | "voice" | "screenshot";
  body: string;
  title?: string;
  description?: string;
  via?: string;
  url?: string;
  capturedAt: number;
  selection?: string;
  highlights?: string[];
  captureKind?: SpsCaptureKind;
  schema?: SpsPageSchemaKey;
  links?: string[];
  provenance?: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

/** A tracked-change proposal applied to a single block (AI "diff"). */
export interface BlockDiff {
  proposalId: string;
  oldHtml: string;
  newHtml: string;
  label?: string;
}

/** A database column added to the tasks table view. */
export interface DbCol {
  id: string;
  name: string;
}

/** One row in the embedded tasks database. */
export interface Task {
  id: string;
  title: string;
  status: StatusKey;
  prio: PrioKey;
  who: PersonKey;
  due: string;
  est: string;
  custom?: Record<string, string>;
  isc?: string[];
  desc?: string;
  checklist?: ChecklistItem[];
}

/** One editor block. Most fields are block-type specific and optional. */
export interface Block {
  id: string;
  type: BlockType;
  text: string;
  html?: string;
  indent?: number;
  // todo / toggle
  done?: boolean;
  collapsed?: boolean;
  // color / background (block menu)
  color?: string | null;
  bg?: string | null;
  // callout
  emoji?: string;
  // database
  view?: DbView;
  rows?: Task[];
  filter?: StatusKey[];
  sort?: string;
  cols?: DbCol[];
  kanbanPreset?: "standard" | "personal";
  // S4: a folder-backed "query database". When set, the block renders rows from
  // markdown row-files under <vault>/<source>/ (via the note index) instead of
  // the embedded `rows`. Absent ⇒ classic embedded database (unchanged).
  source?: string;
  // Bases: generalized database view over page/frontmatter collections.
  base?: SpsBaseViewConfig;
  // bookmark
  bm?: BookmarkMeta | null;
  // image (data URL + caption)
  src?: string | null;
  caption?: string;
  // media (image / audio / video / file): when set, the bytes live in the vault
  // asset store (vault/_assets/<assetPath>) and are streamed via sps-asset://.
  // The markdown carries the portable relative link `../_assets/<assetPath>`.
  assetPath?: string; // bare content-addressed filename "<sha256>.<ext>"
  mime?: string; // original mime type (e.g. "audio/webm", "application/pdf")
  name?: string; // original file name, for display / download
  size?: number; // byte size, for display
  duration?: number; // audio/video length in seconds (best-effort)
  // sub-page link
  pageId?: string;
  // button: the prompt this agent-action button sends to the co-author on click
  // (`text` holds the visible label, `emoji` the icon).
  agentPrompt?: string;
  buttonType?: "prompt" | "shell" | "api";
  buttonCommand?: string;
  buttonUrl?: string;
  buttonHeaders?: string;
  // columns: a list of blocks for each side-by-side column (2–3 columns). Each
  // column is its own mini block-list (todos, headings, lists, …).
  columns?: Block[][];
  // AI proposals
  diff?: BlockDiff;
  proposalId?: string;
  proposalLabel?: string;
}

export interface BookmarkMeta {
  url: string;
  title: string;
  desc: string;
  favicon?: string;
  image?: string;
}

/** Page tree node (structure only; presentation lives in PageMeta). */
export interface TreeNode {
  id: string;
  children: TreeNode[];
}

/** Cover is a CSS color string, the literal 'image', or null. */
export type Cover = string | "image" | null;

export interface PageMeta {
  icon: string;
  title: string;
  cover: Cover;
  /** Hermes session id for a resumable `/work` run on this plan page (M1C).
   *  Persisted in the workspace blob only — never serialized to markdown
   *  frontmatter (the serializer emits title/icon/cover only). */
  workSessionId?: string;
  // KB ingestion (Phase 0): set on pages created from an imported document.
  // `source` is the absolute path of the original file; `ingestedAt` is the
  // import epoch-ms. Both optional ⇒ ordinary pages serialize unchanged.
  source?: string;
  ingestedAt?: number;
  // Journal entry metadata. Present only on journal entries (pages flagged
  // `journal: true`); ordinary pages omit these so their markdown/JSON is
  // byte-identical to before. The calendar surface groups entries by `date`.
  journal?: boolean;
  date?: string; // "YYYY-MM-DD"
  time?: string; // "HH:mm"
  mood?: string; // mood emoji / key (optional)
  // Obsidian-compatible tags. Emitted as a YAML flow sequence (`tags: ["a"]`)
  // only when present, so non-tagged pages serialize byte-identically. The
  // note-index also harvests inline `#tag`s from the body.
  tags?: string[];
  aliases?: string[];
  properties?: Record<string, SpsPropertyValue>;
}

export interface CommentMessage {
  name: string;
  initials: string;
  color: string;
  time: string;
  text: string;
}

export interface Comment {
  id: string;
  quote: string;
  blockId: string | null;
  page: string;
  resolved: boolean;
  messages: CommentMessage[];
}

export interface TrashEntry {
  id: string;
  title: string;
  icon: string;
  ids: string[];
}

/** The persisted workspace document. */
export interface Workspace {
  tree: TreeNode[];
  meta: Record<string, PageMeta>;
  docs: Record<string, Block[]>;
  comments: Comment[];
  trash: TrashEntry[];
  page: string;
}

/** Result of a workspace save (Phase 1.5 write-safety). `ok:false` means the
 *  blob did NOT reach disk — the renderer surfaces a persistent warning. `rev`
 *  is the on-disk revision after the save (unchanged on failure); the renderer
 *  echoes it back as the base of its next save so the main-process write queue
 *  can detect a stale base and reload-merge instead of blind-overwriting.
 *  `merged` flags that a stale base was reconciled; `oversize` flags the blob
 *  crossed the vault-migration advisory threshold. */
export interface SpsSaveResult {
  ok: boolean;
  error?: string;
  bytes?: number;
  rev: number;
  merged: boolean;
  oversize?: boolean;
}

// ---- static reference data shapes ----
export interface Person {
  name: string;
  initials: string;
  color: string;
}
export interface StatusDef {
  label: string;
  cls: string;
  dot: string;
}
export interface PrioDef {
  label: string;
  cls: string;
}
export interface SeedTreeNode {
  id: string;
  emoji: string;
  label: string;
  children?: SeedTreeNode[];
}
