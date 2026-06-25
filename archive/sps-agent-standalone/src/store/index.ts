// store/index.ts — composes all slices into one store and wires side-effects:
//   • apply Tweaks to <html> whenever they change (and once at boot)
//   • persist Tweaks immediately; persist the workspace document (debounced 350ms)
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { applyTweaks } from "../lib/theme";
import { persistence } from "../lib/persistence";
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

// ---- apply + persist Tweaks ----
applyTweaks(useStore.getState().t);
useStore.subscribe(
  (s) => s.t,
  (t) => {
    applyTweaks(t);
    saveTweaks(t);
  },
);

// ---- debounced workspace persistence ----
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
      () => persistence.save(snapshotWorkspace(useStore.getState())),
      350,
    );
  },
  { equalityFn: (a, b) => a.every((v, i) => v === b[i]) },
);
