// store/index.ts — composes all slices into one store and wires side-effects:
//   • apply Tweaks to the .sps-scope element on change (initial apply happens in
//     SpsAgent.tsx once the scope element + theme target exist)
//   • persist Tweaks immediately (localStorage); persist the workspace document to
//     the main process (debounced 350ms)
//   • hydrateWorkspace(): load the persisted workspace from main and apply it
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { applyTweaks } from "../lib/theme";
import {
  loadWorkspace,
  saveWorkspace,
  mirrorPage,
  mirrorAllPages,
} from "../lib/persistence";
import { getStorageMode } from "../lib/storageMode";
import { readVaultWorkspace, saveVaultPage } from "../lib/vaultStore";
import { gcOrphanAssets } from "../lib/assets";
import type { Workspace } from "../types";
import type { Store } from "./storeTypes";
import { createWorkspaceSlice } from "./slices/workspace";
import { createCommentsSlice } from "./slices/comments";
import { createUiSlice } from "./slices/ui";
import { createSidebarSlice, saveSidebar } from "./slices/sidebar";
import { createTweaksSlice, saveTweaks } from "./slices/tweaks";
import { createTemplatesSlice, saveUserTemplates } from "./slices/templates";
import { createCockpitSlice, saveCockpit } from "./slices/cockpit";
import { createAssistantSlice } from "./slices/assistant";
import { createJournalSlice } from "./slices/journal";
import { createExternalContextSlice } from "./slices/externalContext";

export const useStore = create<Store>()(
  subscribeWithSelector((...a) => ({
    ...createWorkspaceSlice(...a),
    ...createCommentsSlice(...a),
    ...createUiSlice(...a),
    ...createSidebarSlice(...a),
    ...createTweaksSlice(...a),
    ...createTemplatesSlice(...a),
    ...createCockpitSlice(...a),
    ...createAssistantSlice(...a),
    ...createJournalSlice(...a),
    ...createExternalContextSlice(...a),
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

// ---- persist sidebar section visibility/collapse (localStorage) ----
useStore.subscribe(
  (s) => [s.sectionsEnabled, s.sectionsOpen] as const,
  ([sectionsEnabled, sectionsOpen]) =>
    saveSidebar({ sectionsEnabled, sectionsOpen }),
);

// ---- persist user-saved templates (localStorage) ----
useStore.subscribe(
  (s) => s.userTemplates,
  (userTemplates) => saveUserTemplates(userTemplates),
);

// ---- persist the cockpit dashboard layout (localStorage) ----
useStore.subscribe(
  (s) => s.cockpit,
  (cockpit) => saveCockpit(cockpit),
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
    saveTimer = setTimeout(() => {
      const s = useStore.getState();
      const ws = snapshotWorkspace(s);
      if (getStorageMode() === "vault") {
        // Vault is authoritative (S6): write the current page + manifest. The
        // blob is intentionally left untouched as the rollback safety net.
        void saveVaultPage(ws, s.page);
      } else {
        saveWorkspace(ws); // blob authoritative
        mirrorPage(s.page, s.meta[s.page] ?? {}, s.docs[s.page] ?? []); // mirror
      }
    }, 350);
  },
  { equalityFn: (a, b) => a.every((v, i) => v === b[i]) },
);

let hydrated = false;

function applyWorkspace(ws: Workspace): void {
  useStore.setState({
    tree: ws.tree,
    meta: ws.meta,
    docs: ws.docs,
    comments: ws.comments ?? [],
    trash: ws.trash ?? [],
    page: ws.page in (ws.docs || {}) ? ws.page : "home",
  });
}

/** Load the authoritative workspace and apply it (once). */
export async function hydrateWorkspace(): Promise<void> {
  if (hydrated) return;
  hydrated = true;

  if (getStorageMode() === "vault") {
    // Markdown vault is authoritative (S6): load from it; no mirror needed.
    const vault = await readVaultWorkspace();
    if (vault && vault.docs && vault.tree) {
      applyWorkspace(vault);
      gcOrphanAssets(vault.docs);
      return;
    }
    // Vault not populated yet — fall back to the blob (and mirror) so the user
    // isn't stranded; migration happens explicitly via the storage switch.
  }

  const ws = await loadWorkspace();
  if (!ws || !ws.docs || !ws.tree) return;
  applyWorkspace(ws);
  // Materialize the markdown substrate for every page once on load (S2b).
  mirrorAllPages(snapshotWorkspace(useStore.getState()));
  // Reclaim vault assets no page references any more (best-effort).
  gcOrphanAssets(useStore.getState().docs);
}
