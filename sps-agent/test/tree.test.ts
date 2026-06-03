import { describe, expect, it } from "vitest";
import {
  treeFind,
  treeInsert,
  treeMove,
  treePathIds,
  treeRemove,
  treeWalkIds,
} from "../src/lib/tree";
import type { TreeNode } from "../src/types";

const sample = (): TreeNode[] => [
  {
    id: "a",
    children: [
      { id: "a1", children: [] },
      { id: "a2", children: [{ id: "a2x", children: [] }] },
    ],
  },
  { id: "b", children: [] },
];

describe("tree algebra", () => {
  it("finds nodes at any depth", () => {
    expect(treeFind(sample(), "a2x")?.id).toBe("a2x");
    expect(treeFind(sample(), "nope")).toBeNull();
  });

  it("computes the path to a deep node", () => {
    expect(treePathIds(sample(), "a2x")).toEqual(["a", "a2", "a2x"]);
    expect(treePathIds(sample(), "b")).toEqual(["b"]);
    expect(treePathIds(sample(), "zzz")).toBeNull();
  });

  it("walks all descendant ids", () => {
    const node = treeFind(sample(), "a")!;
    expect(treeWalkIds(node).sort()).toEqual(["a", "a1", "a2", "a2x"]);
  });

  it("removes a node and returns it, immutably", () => {
    const t0 = sample();
    const [t1, removed] = treeRemove(t0, "a2");
    expect(removed?.id).toBe("a2");
    expect(treeFind(t1, "a2")).toBeNull();
    expect(treeFind(t1, "a2x")).toBeNull(); // subtree gone too
    expect(treeFind(t0, "a2")?.id).toBe("a2"); // original untouched
  });

  it("inserts before/after/inside/root", () => {
    const ins = (where: "before" | "after" | "inside" | "root") =>
      treeInsert(
        sample(),
        where === "root" ? null : "a1",
        { id: "n", children: [] },
        where,
      );
    expect(ins("root").map((n) => n.id)).toContain("n");
    const after = treeFind(ins("after"), "a")!;
    expect(after.children.map((c) => c.id)).toEqual(["a1", "n", "a2"]);
    const before = treeFind(ins("before"), "a")!;
    expect(before.children.map((c) => c.id)).toEqual(["n", "a1", "a2"]);
    const inside = treeFind(ins("inside"), "a1")!;
    expect(inside.children.map((c) => c.id)).toEqual(["n"]);
  });

  it("moves a node and refuses to drop into its own subtree", () => {
    const moved = treeMove(sample(), "b", "a1", "inside");
    expect(treeFind(moved, "a1")!.children.map((c) => c.id)).toEqual(["b"]);
    // dropping 'a' inside its own descendant is a no-op
    const same = treeMove(sample(), "a", "a2x", "inside");
    expect(treePathIds(same, "a")).toEqual(["a"]);
  });
});
