import { describe, expect, it } from "vitest";
import { treeMove } from "./tree";
import type { TreeNode } from "../types";

function node(id: string, children: TreeNode[] = []): TreeNode {
  return { id, children };
}

describe("treeMove", () => {
  it("moves a page before a target page", () => {
    const tree = [node("a"), node("b"), node("c")];

    expect(treeMove(tree, "c", "a", "before")).toEqual([
      node("c"),
      node("a"),
      node("b"),
    ]);
  });

  it("moves a page after a target page", () => {
    const tree = [node("a"), node("b"), node("c")];

    expect(treeMove(tree, "a", "c", "after")).toEqual([
      node("b"),
      node("c"),
      node("a"),
    ]);
  });

  it("nests a page inside a target page", () => {
    const tree = [node("a"), node("b"), node("c")];

    expect(treeMove(tree, "a", "b", "inside")).toEqual([
      node("b", [node("a")]),
      node("c"),
    ]);
  });

  it("does not move a page into its own descendant", () => {
    const tree = [node("a", [node("b", [node("c")])]), node("d")];

    expect(treeMove(tree, "a", "c", "inside")).toBe(tree);
  });
});
