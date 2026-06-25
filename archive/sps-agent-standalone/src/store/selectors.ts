// selectors.ts — derived reads over the store.
import { treePathIds } from "../lib/tree";
import type { Block, PageMeta, TreeNode } from "../types";
import type { Store } from "./storeTypes";

const FALLBACK_META: PageMeta = { icon: "📄", title: "Untitled", cover: null };

// NOTE: only return *stable* references from store selectors. Selectors that
// build a new array/object each call (e.g. .filter()) cause infinite re-renders
// with useSyncExternalStore — derive those in-component with useMemo instead.
export const selectCurrentBlocks = (s: Store): Block[] => s.docs[s.page] || [];
export const selectPmeta = (s: Store): PageMeta =>
  s.meta[s.page] || FALLBACK_META;

/** Breadcrumb id trail to the active page (home is always a single segment). */
export function computePathIds(tree: TreeNode[], page: string): string[] {
  if (page === "home") return ["home"];
  return treePathIds(tree, page) || [page];
}
