// workspaceVault.test.ts — S5: whole-workspace ↔ vault reconstruction + the
// cutover parity gate.
import { describe, expect, it } from "vitest";
import {
  workspaceToVault,
  vaultToWorkspace,
  workspaceParity,
} from "./workspaceVault";
import { blk } from "../lib/ids";
import type { Block, Comment, PageMeta, TreeNode, Workspace } from "../types";

function meta(title: string, icon = "📄"): PageMeta {
  return { icon, title, cover: null };
}

function makeWorkspace(over: Partial<Workspace> = {}): Workspace {
  const tree: TreeNode[] = [
    { id: "home", children: [{ id: "sub", children: [] }] },
  ];
  const docs: Record<string, Block[]> = {
    home: [
      blk("h1", "Home"),
      blk("p", "Welcome"),
      blk("todo", "do", { done: true }),
    ],
    sub: [blk("p", "Sub page"), blk("page", "", { pageId: "home" })],
  };
  return {
    tree,
    meta: { home: meta("Home", "🏠"), sub: meta("Sub") },
    docs,
    comments: [],
    trash: [],
    page: "home",
    ...over,
  };
}

describe("workspaceToVault / vaultToWorkspace", () => {
  it("emits one markdown file per page plus a structure manifest", () => {
    const snap = workspaceToVault(makeWorkspace());
    expect(Object.keys(snap.pages).sort()).toEqual(["home", "sub"]);
    expect(snap.pages.home).toContain('title: "Home"');
    expect(snap.manifest.tree[0].id).toBe("home");
    expect(snap.manifest.page).toBe("home");
  });

  it("reconstructs page metadata and structure from the vault", () => {
    const ws = makeWorkspace();
    const back = vaultToWorkspace(workspaceToVault(ws));
    expect(back.meta.home).toEqual(meta("Home", "🏠"));
    expect(back.tree).toEqual(ws.tree);
    expect(back.page).toBe("home");
    expect(back.docs.sub.find((b) => b.type === "page")?.pageId).toBe("home");
  });
});

describe("workspaceParity", () => {
  it("reports a clean workspace as fully cutover-ready", () => {
    const report = workspaceParity(makeWorkspace());
    expect(report.ok).toBe(true);
    expect(report.treeOk).toBe(true);
    expect(report.pages.every((p) => p.contentOk && p.metaOk)).toBe(true);
    expect(report.droppedEmptyParagraphs).toBe(0);
    expect(report.blockAnchoredComments).toBe(0);
  });

  it("counts empty paragraphs (dropped) but still matches content", () => {
    const ws = makeWorkspace({
      docs: { home: [blk("p", "real"), blk("p", ""), blk("p", "")] },
      meta: { home: meta("Home") },
      tree: [{ id: "home", children: [] }],
    });
    const report = workspaceParity(ws);
    expect(report.droppedEmptyParagraphs).toBe(2);
    expect(report.pages[0].contentOk).toBe(true);
    expect(report.ok).toBe(true);
  });

  it("preserves an embedded-rows database verbatim through the round-trip", () => {
    const db = blk("database", "", {
      view: "board",
      rows: [
        {
          id: "t1",
          title: "Task",
          status: "doing",
          prio: "high",
          who: "maya",
          due: "",
          est: "",
        },
      ],
    });
    const ws = makeWorkspace({
      docs: { home: [db] },
      meta: { home: meta("Home") },
      tree: [{ id: "home", children: [] }],
    });
    expect(workspaceParity(ws).pages[0].contentOk).toBe(true);
  });

  it("counts block-anchored comments (informational), even dangling ones", () => {
    const comment: Comment = {
      id: "c1",
      quote: "Welcome",
      blockId: "some-block-id",
      page: "home",
      resolved: false,
      messages: [],
    };
    const report = workspaceParity(makeWorkspace({ comments: [comment] }));
    expect(report.blockAnchoredComments).toBe(1);
    expect(report.pages.every((p) => p.contentOk)).toBe(true);
    expect(report.treeOk).toBe(true);
  });

  it("preserves a comment anchored to a real block across the round-trip (F2)", () => {
    const anchored = blk("p", "Welcome");
    const comment: Comment = {
      id: "c1",
      quote: "Welcome",
      blockId: anchored.id,
      page: "home",
      resolved: false,
      messages: [],
    };
    const ws = makeWorkspace({
      docs: { home: [blk("h1", "Home"), anchored], sub: [blk("p", "Sub")] },
      comments: [comment],
    });
    const report = workspaceParity(ws);
    expect(report.blockAnchoredComments).toBe(1);
    expect(report.blockAnchorsOk).toBe(true);
    expect(report.ok).toBe(true);
    expect(workspaceToVault(ws).pages.home).toContain(`^${anchored.id}`);
  });

  it("ignores a dangling anchor (no matching source block) for cutover", () => {
    const comment: Comment = {
      id: "c1",
      quote: "x",
      blockId: "no-such-block",
      page: "home",
      resolved: false,
      messages: [],
    };
    const report = workspaceParity(makeWorkspace({ comments: [comment] }));
    expect(report.blockAnchorsOk).toBe(true);
    expect(report.ok).toBe(true);
  });
});
