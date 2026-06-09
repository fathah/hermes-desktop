// externalContext.ts — the renderer half of "Save an external session to KB".
//
// The main process assembles the provenance + already-redacted transcript and
// synthesizes a decision-brief changeset (READ-ONLY over the vault). This slice
// commits it through the SAME ingest path as research filing, appends a wiki log
// entry, selects the new page, and returns a one-click undo — a verbatim mirror
// of runResearch's tail (reusing the "research" WikiLogOp so the union doesn't
// have to widen in v1).
import type { StateCreator } from "zustand";
import type { Store, ExternalContextSlice } from "../storeTypes";
import { commitChangeset } from "../../inbox/ingestApply";

export const createExternalContextSlice: StateCreator<
  Store,
  [],
  [],
  ExternalContextSlice
> = (_set, get) => ({
  saveExternalSessionToKb: async (convId) => {
    try {
      const res = await window.hermesAPI?.externalContextSaveToKb?.(convId);
      if (!res?.ok || !res.changeset) {
        return { ok: false, error: res?.error ?? "Saving is unavailable." };
      }
      // Snapshot affected pages BEFORE commit so undo can reverse create
      // (→ trash) or update (→ restore prior doc + meta).
      const snapshots = res.changeset.pages.map((p) => {
        const existedBefore = !!get().docs[p.pageId] || !!get().meta[p.pageId];
        return {
          pageId: p.pageId,
          existedBefore,
          priorBlocks: get().docs[p.pageId],
          priorMeta: get().meta[p.pageId],
        };
      });
      await commitChangeset(res.changeset, get().ingestCommitPage);
      await window.hermesAPI.spsAppendWikiLog?.(
        "research",
        res.changeset.summary,
      );
      const firstPageId = res.changeset.pages[0]?.pageId;
      if (firstPageId) get().selectPage(firstPageId);
      const undo = (): void => {
        for (const snap of snapshots) {
          if (!snap.existedBefore) {
            get().deletePage(snap.pageId); // created → move to trash
          } else if (snap.priorBlocks) {
            get().setPageDoc(snap.pageId, snap.priorBlocks); // update → restore
            if (snap.priorMeta) get().setPageMeta(snap.pageId, snap.priorMeta);
          }
        }
      };
      return {
        ok: true,
        summary: res.changeset.summary,
        pageId: firstPageId,
        undo,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "external-save error",
      };
    }
  },
});
