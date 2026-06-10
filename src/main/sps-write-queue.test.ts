import { describe, it, expect } from "vitest";
import {
  mergeWorkspaces,
  shouldBackup,
  selectBackupsToPrune,
  WorkspaceWriteQueue,
  type RevisionedWorkspace,
  type WorkspaceQueueIO,
  BACKUP_KEEP,
} from "./sps-write-queue";
import type { Workspace } from "../shared/sps-types";

function ws(overrides: Partial<Workspace> = {}): Workspace {
  return {
    tree: [],
    meta: {},
    docs: {},
    comments: [],
    trash: [],
    page: "home",
    ...overrides,
  };
}

function pageWs(id: string, body = `body-${id}`): Workspace {
  return ws({
    tree: [{ id, children: [] }],
    meta: { [id]: { icon: "", title: id, cover: null } as never },
    docs: { [id]: [{ type: "p", text: body } as never] },
    page: id,
  });
}

describe("mergeWorkspaces — additive, no page lost", () => {
  it("keeps pages that exist only on the current (on-disk) side", () => {
    const current = pageWs("background-added");
    const incoming = pageWs("user-edited");
    const merged = mergeWorkspaces(current, incoming);
    expect(Object.keys(merged.docs).sort()).toEqual([
      "background-added",
      "user-edited",
    ]);
    expect(Object.keys(merged.meta).sort()).toEqual([
      "background-added",
      "user-edited",
    ]);
  });

  it("lets incoming win for a page both sides touched", () => {
    const current = pageWs("shared", "old");
    const incoming = pageWs("shared", "new");
    const merged = mergeWorkspaces(current, incoming);
    expect((merged.docs["shared"][0] as { text: string }).text).toBe("new");
  });

  it("keeps the current-only page reachable in the nav tree", () => {
    const current = pageWs("bg");
    const incoming = pageWs("ui");
    const merged = mergeWorkspaces(current, incoming);
    const treeIds = merged.tree.map((n) => n.id).sort();
    expect(treeIds).toEqual(["bg", "ui"]);
  });

  it("uses the active writer's page cursor", () => {
    const merged = mergeWorkspaces(pageWs("a"), pageWs("b"));
    expect(merged.page).toBe("b");
  });
});

describe("shouldBackup", () => {
  it("backs up the first save and every Nth save", () => {
    expect(shouldBackup(0)).toBe(true);
    expect(shouldBackup(1)).toBe(false);
    expect(shouldBackup(49)).toBe(false);
    expect(shouldBackup(50)).toBe(true);
    expect(shouldBackup(100)).toBe(true);
  });
});

describe("selectBackupsToPrune", () => {
  it("keeps the newest N backups by stamp, returns the rest to delete", () => {
    const paths = [
      "workspace.json.bak-100",
      "workspace.json.bak-500",
      "workspace.json.bak-300",
      "workspace.json.bak-200",
      "workspace.json.bak-400",
      "workspace.json.bak-600",
    ];
    const toPrune = selectBackupsToPrune(paths, 5).sort();
    expect(toPrune).toEqual(["workspace.json.bak-100"]);
  });

  it("returns nothing when at or under the keep count", () => {
    const paths = ["workspace.json.bak-1", "workspace.json.bak-2"];
    expect(selectBackupsToPrune(paths, 5)).toEqual([]);
  });
});

// ── In-memory IO double for the serialized queue ──
function makeIo(): {
  io: WorkspaceQueueIO;
  blob: { value: RevisionedWorkspace | null };
  backups: number[];
  failNextWrite: { value: boolean };
} {
  const blob: { value: RevisionedWorkspace | null } = { value: null };
  const backups: number[] = [];
  const failNextWrite = { value: false };
  let clock = 1000;
  const io: WorkspaceQueueIO = {
    async read() {
      return blob.value;
    },
    async write(next) {
      if (failNextWrite.value) {
        failNextWrite.value = false;
        throw new Error("EACCES: permission denied");
      }
      blob.value = next;
      return JSON.stringify(next).length;
    },
    async backup() {
      if (blob.value) backups.push(blob.value.__rev ?? 0);
    },
    async prune() {
      /* no-op for the in-memory double */
    },
    now() {
      clock += 1;
      return clock;
    },
  };
  return { io, blob, backups, failNextWrite };
}

describe("WorkspaceWriteQueue", () => {
  it("stamps a monotonic revision and reports bytes", async () => {
    const { io } = makeIo();
    const queue = new WorkspaceWriteQueue(io);
    const first = await queue.enqueue(pageWs("a"));
    const second = await queue.enqueue(pageWs("a"));
    expect(first.ok).toBe(true);
    expect(first.rev).toBe(1);
    expect(second.rev).toBe(2);
    expect(first.bytes).toBeGreaterThan(0);
    expect(first.merged).toBe(false);
  });

  it("reload-merges a stale-base write so no page is lost", async () => {
    const { io, blob } = makeIo();
    const queue = new WorkspaceWriteQueue(io);

    // Writer A (the renderer) saves rev 1 with page "ui".
    const a = await queue.enqueue(pageWs("ui"));
    expect(a.rev).toBe(1);

    // A background writer commits page "bg" directly to disk at rev 2,
    // out of band — simulating a Phase-3 import landing between the renderer's
    // loads.
    blob.value = { ...pageWs("bg"), __rev: 2 };

    // Writer A saves again, still believing it is based on rev 1 (stale): it
    // only knows about "ui". Without the guard this blind-overwrites "bg" away.
    const stale = await queue.enqueue(pageWs("ui"), 1);
    expect(stale.ok).toBe(true);
    expect(stale.merged).toBe(true);
    expect(Object.keys(blob.value!.docs).sort()).toEqual(["bg", "ui"]);
  });

  it("does not merge when the base revision is current", async () => {
    const { io } = makeIo();
    const queue = new WorkspaceWriteQueue(io);
    await queue.enqueue(pageWs("a")); // rev 1
    const fresh = await queue.enqueue(pageWs("b"), 1); // base matches current
    expect(fresh.merged).toBe(false);
  });

  it("serializes overlapping enqueues (no interleaved revisions)", async () => {
    const { io } = makeIo();
    const queue = new WorkspaceWriteQueue(io);
    const results = await Promise.all([
      queue.enqueue(pageWs("a")),
      queue.enqueue(pageWs("b")),
      queue.enqueue(pageWs("c")),
    ]);
    const revs = results.map((r) => r.rev).sort((x, y) => x - y);
    expect(revs).toEqual([1, 2, 3]);
  });

  it("surfaces a write failure as ok:false without advancing the revision", async () => {
    const { io, failNextWrite } = makeIo();
    const queue = new WorkspaceWriteQueue(io);
    await queue.enqueue(pageWs("a")); // rev 1
    failNextWrite.value = true;
    const failed = await queue.enqueue(pageWs("b"));
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain("EACCES");
    expect(failed.rev).toBe(1); // unchanged
    // The queue stays usable after a failure.
    const recovered = await queue.enqueue(pageWs("c"));
    expect(recovered.ok).toBe(true);
    expect(recovered.rev).toBe(2);
  });

  it("backs up the first save of a session", async () => {
    const { io, blob, backups } = makeIo();
    const queue = new WorkspaceWriteQueue(io);
    blob.value = { ...pageWs("seed"), __rev: 7 }; // a pre-existing file
    await queue.enqueue(pageWs("a"), 7);
    expect(backups).toContain(7); // backed the existing blob before overwrite
  });
});

describe("BACKUP_KEEP sanity", () => {
  it("retains a small rolling window", () => {
    expect(BACKUP_KEEP).toBe(5);
  });
});
