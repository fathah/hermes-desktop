// store/index.ts — composes all slices into one store and wires side-effects:
//   • apply Tweaks to the .sps-scope element on change (initial apply happens in
//     SpsAgent.tsx once the scope element + theme target exist)
//   • persist Tweaks immediately (localStorage); persist the workspace document to
//     the main process (debounced 350ms)
//   • hydrateWorkspace(): load the persisted workspace from main and apply it
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { applyTweaks } from "../lib/theme";
import { loadWorkspace, saveWorkspace } from "../lib/persistence";
import type { Workspace } from "../types";
import type { Store } from "./storeTypes";
import { createWorkspaceSlice } from "./slices/workspace";
import { createCommentsSlice } from "./slices/comments";
import { createUiSlice } from "./slices/ui";
import { createTweaksSlice, saveTweaks } from "./slices/tweaks";
import { createAssistantSlice } from "./slices/assistant";

export const useStore = create<Store>()(
  subscribeWithSelector((...a) => ({
    ...createWorkspaceSlice(...a),
    ...createCommentsSlice(...a),
    ...createUiSlice(...a),
    ...createTweaksSlice(...a),
    ...createAssistantSlice(...a),
  })),
);

// ---- persist Tweaks (apply happens in SpsAgent.tsx + on change) ----
useStore.subscribe(
  (s) => s.t,
  (t) => {
    applyTweaks(t);
    saveTweaks(t);
  },
);

// ---- debounced workspace persistence (to the main process) ----
function snapshotWorkspace(s: Store): Workspace {
  return {
    tree: s.tree,
    meta: s.meta,
    docs: s.docs,
    comments: s.comments,
    trash: s.trash,
    page: s.page,
  };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
useStore.subscribe(
  // a stable-ish projection: identity of the persisted fields
  (s) => [s.tree, s.meta, s.docs, s.comments, s.trash, s.page] as const,
  () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(
      () => saveWorkspace(snapshotWorkspace(useStore.getState())),
      350,
    );
  },
  { equalityFn: (a, b) => a.every((v, i) => v === b[i]) },
);

let hydrated = false;
/** Load the persisted workspace from main and apply it (once). */
export async function hydrateWorkspace(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  const ws = await loadWorkspace();
  if (!ws || !ws.docs || !ws.tree) return;
  useStore.setState({
    tree: ws.tree,
    meta: ws.meta,
    docs: ws.docs,
    comments: ws.comments ?? [],
    trash: ws.trash ?? [],
    page: ws.page in (ws.docs || {}) ? ws.page : "home",
  });
}
