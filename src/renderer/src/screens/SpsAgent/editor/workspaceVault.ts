// workspaceVault.ts — Part 2 / S5: whole-workspace ↔ vault, and the cutover
// parity gate.
//
// Before markdown can become the source of truth (S6), we must prove the entire
// workspace round-trips through the vault losslessly. A vault is:
//   • one markdown file per page (content + properties), and
//   • a small manifest for the structure that pages can't hold on their own
//     (the page tree, trash, comments, current page).
//
// workspaceParity() round-trips a live workspace and reports whether content,
// metadata, and structure survive — plus the one known caveat: block-anchored
// comments reference runtime block ids that regenerate on parse.
import { pageToMarkdown, pageFromMarkdown } from "./pageMarkdown";
import { treeWalkIds } from "../lib/tree";
import type {
  Block,
  Comment,
  PageMeta,
  TreeNode,
  TrashEntry,
  Workspace,
} from "../types";

/** Structure that lives outside individual page files. */
export interface WorkspaceManifest {
  tree: TreeNode[];
  trash: TrashEntry[];
  comments: Comment[];
  page: string;
}

export interface VaultSnapshot {
  pages: Record<string, string>; // pageId → markdown file
  manifest: WorkspaceManifest;
}

const DEFAULT_META: PageMeta = { icon: "📄", title: "", cover: null };

/** The structural manifest for a workspace (everything not in page files). */
export function workspaceManifest(ws: Workspace): WorkspaceManifest {
  return {
    tree: ws.tree,
    trash: ws.trash,
    comments: ws.comments,
    page: ws.page,
  };
}

/** Serialize a whole workspace to a vault (page files + manifest). */
export function workspaceToVault(ws: Workspace): VaultSnapshot {
  const pages: Record<string, string> = {};
  for (const id of Object.keys(ws.docs)) {
    pages[id] = pageToMarkdown(ws.meta[id] ?? {}, ws.docs[id] ?? []);
  }
  return {
    pages,
    manifest: {
      tree: ws.tree,
      trash: ws.trash,
      comments: ws.comments,
      page: ws.page,
    },
  };
}

/** Reconstruct a workspace from a vault. Inverse of workspaceToVault (within the
 *  documented tolerances: block ids regenerate, empty paragraphs drop). */
export function vaultToWorkspace(snapshot: VaultSnapshot): Workspace {
  const m = snapshot.manifest;
  // Only reconstruct pages the manifest knows about, so a stale orphan file left
  // by a delete in vault mode can't resurrect itself as a hidden page.
  const known = new Set<string>([
    ...m.tree.flatMap((n) => treeWalkIds(n)),
    ...m.trash.flatMap((t) => t.ids),
    m.page,
  ]);
  const docs: Record<string, Block[]> = {};
  const meta: Record<string, PageMeta> = {};
  for (const id of Object.keys(snapshot.pages)) {
    if (!known.has(id)) continue;
    const parsed = pageFromMarkdown(snapshot.pages[id]);
    docs[id] = parsed.blocks;
    meta[id] = { ...DEFAULT_META, ...parsed.meta };
  }
  return {
    tree: m.tree,
    trash: m.trash,
    comments: m.comments,
    page: m.page,
    meta,
    docs,
  };
}

// ── parity ──────────────────────────────────────────────────────────────────

export interface PageParity {
  pageId: string;
  contentOk: boolean;
  metaOk: boolean;
}

export interface ParityReport {
  /** True when content + metadata + structure all survive the round-trip. */
  ok: boolean;
  pages: PageParity[];
  treeOk: boolean;
  /** Empty paragraphs are intentionally not representable in markdown. */
  droppedEmptyParagraphs: number;
  /** Comments anchored to a block id — these need re-anchoring at cutover. */
  blockAnchoredComments: number;
}

/** Strip the runtime id and empty paragraphs so two block lists are comparable. */
function normalizeBlocks(blocks: Block[]): Omit<Block, "id">[] {
  return blocks
    .filter((b) => !(b.type === "p" && !(b.text || "").trim()))
    .map((b) => {
      const rest: Partial<Block> = { ...b };
      delete rest.id;
      return rest as Omit<Block, "id">;
    });
}

function countEmptyParagraphs(blocks: Block[]): number {
  return blocks.filter((b) => b.type === "p" && !(b.text || "").trim()).length;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Round-trip a live workspace through the vault and report cutover readiness. */
export function workspaceParity(ws: Workspace): ParityReport {
  // Simulate the disk hop: the manifest is JSON on disk.
  const snapshot = workspaceToVault(ws);
  const onDisk: VaultSnapshot = {
    pages: snapshot.pages,
    manifest: JSON.parse(JSON.stringify(snapshot.manifest)),
  };
  const back = vaultToWorkspace(onDisk);

  const pages: PageParity[] = [];
  let droppedEmptyParagraphs = 0;
  for (const id of Object.keys(ws.docs)) {
    droppedEmptyParagraphs += countEmptyParagraphs(ws.docs[id] ?? []);
    pages.push({
      pageId: id,
      contentOk: deepEqual(
        normalizeBlocks(back.docs[id] ?? []),
        normalizeBlocks(ws.docs[id] ?? []),
      ),
      metaOk: deepEqual(back.meta[id], { ...DEFAULT_META, ...ws.meta[id] }),
    });
  }

  const treeOk =
    deepEqual(back.tree, ws.tree) &&
    deepEqual(back.trash, ws.trash) &&
    back.page === ws.page;

  const blockAnchoredComments = ws.comments.filter((c) => !!c.blockId).length;

  const ok = treeOk && pages.every((p) => p.contentOk && p.metaOk);
  return { ok, pages, treeOk, droppedEmptyParagraphs, blockAnchoredComments };
}
