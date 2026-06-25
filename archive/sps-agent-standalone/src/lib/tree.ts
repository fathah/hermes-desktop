// tree.ts — immutable page-tree operations. Ported verbatim (semantics) from
// store.jsx. Pure functions, unit-tested in test/tree.test.ts.
import type { TreeNode } from "../types";

export type DropWhere = "before" | "after" | "inside" | "root";

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

export function treeFind(tree: TreeNode[], id: string): TreeNode | null {
  for (const n of tree) {
    if (n.id === id) return n;
    const f = treeFind(n.children, id);
    if (f) return f;
  }
  return null;
}

export function treePathIds(
  tree: TreeNode[],
  id: string,
  trail: string[] = [],
): string[] | null {
  for (const n of tree) {
    const t = [...trail, n.id];
    if (n.id === id) return t;
    const r = treePathIds(n.children, id, t);
    if (r) return r;
  }
  return null;
}

export function treeWalkIds(node: TreeNode): string[] {
  let ids = [node.id];
  (node.children || []).forEach((c) => {
    ids = ids.concat(treeWalkIds(c));
  });
  return ids;
}

export function treeRemove(
  tree: TreeNode[],
  id: string,
): [TreeNode[], TreeNode | null] {
  let removed: TreeNode | null = null;
  const rec = (arr: TreeNode[]): TreeNode[] =>
    arr.filter((n) => {
      if (n.id === id) {
        removed = n;
        return false;
      }
      n.children = rec(n.children);
      return true;
    });
  const nt = rec(clone(tree));
  return [nt, removed];
}

export function treeInsert(
  tree: TreeNode[],
  targetId: string | null,
  node: TreeNode,
  where: DropWhere,
): TreeNode[] {
  const t = clone(tree);
  if (where === "root" || !targetId) {
    t.push(node);
    return t;
  }
  const rec = (arr: TreeNode[]): boolean => {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].id === targetId) {
        if (where === "inside") arr[i].children.push(node);
        else if (where === "before") arr.splice(i, 0, node);
        else arr.splice(i + 1, 0, node);
        return true;
      }
      if (rec(arr[i].children)) return true;
    }
    return false;
  };
  if (!rec(t)) t.push(node);
  return t;
}

export function treeMove(
  tree: TreeNode[],
  dragId: string,
  targetId: string,
  where: DropWhere,
): TreeNode[] {
  if (dragId === targetId) return tree;
  const dragNode = treeFind(tree, dragId);
  if (!dragNode) return tree;
  if (treeWalkIds(dragNode).includes(targetId)) return tree; // no drop into own subtree
  const [t1] = treeRemove(tree, dragId);
  return treeInsert(t1, targetId, clone(dragNode), where);
}
