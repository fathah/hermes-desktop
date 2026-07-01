import { promises as fs } from "fs";
import { join } from "path";
import {
  WorkspaceWriteQueue,
  selectBackupsToPrune,
  OVERSIZE_ADVISORY_BYTES,
  type RevisionedWorkspace,
  type WorkspaceQueueIO,
} from "../sps-write-queue";
import type { Workspace, SpsSaveResult } from "../../shared/sps-types";
import {
  profileHome,
  getActiveProfileNameSync,
  safeWriteFileAsync,
} from "../utils";

function workspacePath(profile?: string): string {
  return join(
    profileHome(profile || getActiveProfileNameSync()),
    "sps-agent",
    "workspace.json",
  );
}

function workspaceDir(profile?: string): string {
  return join(profileHome(profile || getActiveProfileNameSync()), "sps-agent");
}

export async function spsLoad(profile?: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(workspacePath(profile), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// One serialized write queue per profile guards workspace.json against the
// whole-blob last-write-wins hazard.
const writeQueues = new Map<string, WorkspaceWriteQueue>();

function listBackups(profile?: string): Promise<string[]> {
  const dir = workspaceDir(profile);
  return fs
    .readdir(dir)
    .then((names) =>
      names
        .filter((name) => name.startsWith("workspace.json.bak-"))
        .map((name) => join(dir, name)),
    )
    .catch(() => []);
}

function makeQueueIo(profile?: string): WorkspaceQueueIO {
  const p = workspacePath(profile);
  return {
    async read() {
      const data = await spsLoad(profile);
      return (data as RevisionedWorkspace | null) ?? null;
    },
    async write(blob) {
      const json = JSON.stringify(blob);
      await safeWriteFileAsync(p, json);
      return Buffer.byteLength(json);
    },
    async backup() {
      await spsBackupWorkspace(profile);
    },
    async prune(keep) {
      const existing = await listBackups(profile);
      const stale = selectBackupsToPrune(existing, keep);
      await Promise.all(stale.map((path) => fs.unlink(path).catch(() => {})));
    },
    now() {
      return Date.now();
    },
  };
}

function queueFor(profile?: string): WorkspaceWriteQueue {
  const key = profile || getActiveProfileNameSync();
  let queue = writeQueues.get(key);
  if (!queue) {
    queue = new WorkspaceWriteQueue(makeQueueIo(profile));
    writeQueues.set(key, queue);
  }
  return queue;
}

export async function spsSave(
  ws: unknown,
  profile?: string,
  baseRev?: number,
): Promise<SpsSaveResult> {
  // The reset path bypasses the queue/merge and resets revision tracking.
  if (ws === null || typeof ws !== "object") {
    writeQueues.delete(profile || getActiveProfileNameSync());
    try {
      await safeWriteFileAsync(workspacePath(profile), JSON.stringify(ws));
      return { ok: true, rev: 0, merged: false };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        rev: 0,
        merged: false,
      };
    }
  }

  const outcome = await queueFor(profile).enqueue(ws as Workspace, baseRev);
  const oversize =
    typeof outcome.bytes === "number" &&
    outcome.bytes > OVERSIZE_ADVISORY_BYTES;
  return { ...outcome, oversize };
}

export async function spsBackupWorkspace(
  profile?: string,
): Promise<string | null> {
  try {
    const p = workspacePath(profile);
    const backup = `${p}.bak-${Date.now()}`;
    await fs.copyFile(p, backup);
    return backup;
  } catch {
    return null;
  }
}
