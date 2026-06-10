// sps-write-queue.ts — workspace write-safety core (Phase 1.5).
//
// Pure, electron-free, sqlite-free so it runs under vitest. The fs-bound IO is
// injected (see WorkspaceQueueIO), which is what lets the interleaved-stale-base
// merge, the backup rotation, and the generation guard all be unit-tested
// deterministically. The fs wiring lives in sps-agent.ts.
//
// The one rule this protects: workspace.json is whole-blob last-write-wins, so a
// writer that saves a payload derived from an OLD revision would silently drop
// any pages a concurrent writer committed in between. The queue serializes every
// write per profile, stamps a monotonic `__rev`, and — when an incoming save's
// base revision is stale — reload-merges instead of blind-overwriting.
import type { TreeNode, Workspace } from "../shared/sps-types";

/** workspace.json as persisted: the renderer-facing Workspace plus the
 *  main-owned revision metadata the renderer never sets (its type omits these,
 *  so a renderer round-trip drops them and the queue re-stamps on every write). */
export interface RevisionedWorkspace extends Workspace {
  __rev?: number;
  __savedAt?: number;
}

export const BACKUP_EVERY_N_SAVES = 50;
export const BACKUP_KEEP = 5;
/** Blob size past which we surface a one-time "consider vault migration" hint. */
export const OVERSIZE_ADVISORY_BYTES = 25 * 1024 * 1024;

/** Every page id referenced anywhere in a (recursively nested) nav tree. */
function collectTreeIds(
  nodes: TreeNode[],
  into: Set<string> = new Set(),
): Set<string> {
  for (const node of nodes) {
    into.add(node.id);
    if (node.children?.length) collectTreeIds(node.children, into);
  }
  return into;
}

/** Keep the active writer's tree as authoritative, but append any CURRENT-only
 *  root nodes (e.g. a page a background writer added that the stale payload never
 *  saw) so no page becomes permanently unreachable in the nav. */
function mergeTrees(current: TreeNode[], incoming: TreeNode[]): TreeNode[] {
  const incomingIds = collectTreeIds(incoming);
  const currentOnly = current.filter((node) => !incomingIds.has(node.id));
  return [...incoming, ...currentOnly];
}

/** Union two id-keyed lists: incoming wins for a shared id, current-only entries
 *  are appended (never dropped). */
function unionById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const incomingIds = new Set(incoming.map((item) => item.id));
  const currentOnly = current.filter((item) => !incomingIds.has(item.id));
  return [...incoming, ...currentOnly];
}

/**
 * Reload-merge for a stale-base write. `current` is the newer on-disk blob;
 * `incoming` is the payload a writer derived from an older revision. The merge
 * is deliberately additive — "no page is ever lost" beats "perfectly resolve a
 * concurrent edit" for a rare-collision safety net (we have no per-page version
 * to do a true 3-way merge). incoming wins for the pages it carries; current
 * fills every gap. A page trashed on one side but still present on the other is
 * retained, not purged — retention is the safe default here.
 */
export function mergeWorkspaces(
  current: Workspace,
  incoming: Workspace,
): Workspace {
  const docs = { ...current.docs, ...incoming.docs };
  const meta = { ...current.meta, ...incoming.meta };
  const tree = mergeTrees(current.tree, incoming.tree);
  const comments = unionById(current.comments, incoming.comments);
  const trash = unionById(current.trash, incoming.trash);
  return { tree, meta, docs, comments, trash, page: incoming.page };
}

/** Back up on the first save of a session and every Nth save thereafter.
 *  `saveIndex` is the 0-based count of saves already completed this session. */
export function shouldBackup(
  saveIndex: number,
  everyN: number = BACKUP_EVERY_N_SAVES,
): boolean {
  return saveIndex === 0 || saveIndex % everyN === 0;
}

/** Given existing `workspace.json.bak-<epochMs>` paths, return the ones to
 *  delete so only the newest `keep` survive (sorted by the numeric stamp). */
export function selectBackupsToPrune(paths: string[], keep: number): string[] {
  const stamped = paths
    .map((path) => ({ path, stamp: Number(path.split(".bak-")[1] ?? 0) }))
    .sort((a, b) => b.stamp - a.stamp);
  const surplus = stamped.slice(keep);
  return surplus.map((entry) => entry.path);
}

export interface SaveOutcome {
  ok: boolean;
  error?: string;
  bytes?: number;
  /** The revision now on disk (unchanged from the prior rev on failure). */
  rev: number;
  /** True when a stale base triggered a reload-merge instead of a blind write. */
  merged: boolean;
}

/** Injected fs boundary — see sps-agent.ts for the real implementation. */
export interface WorkspaceQueueIO {
  /** Current on-disk blob (with `__rev`), or null if none exists yet. */
  read(): Promise<RevisionedWorkspace | null>;
  /** Atomically persist the blob; resolves with the byte count written. */
  write(blob: RevisionedWorkspace): Promise<number>;
  /** Copy the current on-disk blob to a timestamped backup (best-effort). */
  backup(): Promise<void>;
  /** Delete all but the newest `keep` backups (best-effort). */
  prune(keep: number): Promise<void>;
  /** Wall clock — injected so tests stay deterministic. */
  now(): number;
}

/**
 * Serializes every workspace write for one profile behind a promise chain, so
 * two overlapping saves can never interleave their read-modify-write. Tracks a
 * monotonic revision; a save whose declared `baseRev` is older than what is on
 * disk is reload-merged rather than blindly overwritten.
 */
export class WorkspaceWriteQueue {
  private chain: Promise<unknown> = Promise.resolve();
  private currentRev = 0;
  private saveCount = 0;
  private revLoaded = false;

  constructor(private readonly io: WorkspaceQueueIO) {}

  enqueue(incoming: Workspace, baseRev?: number): Promise<SaveOutcome> {
    const run = this.chain.then(() => this.runSave(incoming, baseRev));
    // Keep the chain alive even if a run rejects (runSave catches, so it won't).
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async runSave(
    incoming: Workspace,
    baseRev: number | undefined,
  ): Promise<SaveOutcome> {
    const onDisk = await this.io.read();
    if (!this.revLoaded) {
      this.currentRev = onDisk?.__rev ?? 0;
      this.revLoaded = true;
    } else if (onDisk?.__rev != null && onDisk.__rev > this.currentRev) {
      // Another process advanced the revision out from under us.
      this.currentRev = onDisk.__rev;
    }

    let merged = false;
    let toWrite: Workspace = incoming;
    if (baseRev != null && onDisk != null && baseRev < this.currentRev) {
      toWrite = mergeWorkspaces(onDisk, incoming);
      merged = true;
    }

    const newRev = this.currentRev + 1;
    const blob: RevisionedWorkspace = {
      ...toWrite,
      __rev: newRev,
      __savedAt: this.io.now(),
    };

    try {
      if (shouldBackup(this.saveCount)) {
        await this.io.backup();
        await this.io.prune(BACKUP_KEEP);
      }
      const bytes = await this.io.write(blob);
      this.currentRev = newRev;
      this.saveCount += 1;
      return { ok: true, bytes, rev: newRev, merged };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        rev: this.currentRev,
        merged,
      };
    }
  }
}
