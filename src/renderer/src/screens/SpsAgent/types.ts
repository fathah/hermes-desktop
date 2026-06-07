// types.ts — domain model for the SPS Agent workspace.
// Derived from the prototype's data.jsx / store.jsx object shapes. The prototype
// uses loosely-typed objects; here every field is modelled but block-specific
// fields stay optional (a single Block interface) to keep the dynamic editor
// behaviour a faithful, low-friction port.

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
export type StatusKey = "todo" | "doing" | "review" | "done";
export type PrioKey = "high" | "med" | "low";
export type PersonKey = string; // 'maya' | 'theo' | 'priya' | 'sam' (+ user-added)

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
  // S4: a folder-backed "query database". When set, the block renders rows from
  // markdown row-files under <vault>/<source>/ (via the note index) instead of
  // the embedded `rows`. Absent ⇒ classic embedded database (unchanged).
  source?: string;
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
