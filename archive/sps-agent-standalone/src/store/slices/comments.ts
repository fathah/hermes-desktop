// comments.ts — comment threads. DOM anchor wrapping lives in components; this
// slice owns the data. Ported from app.jsx commentApi.
import type { StateCreator } from "zustand";
import { uid } from "../../lib/ids";
import { initialWorkspace } from "../initial";
import type { Store, CommentsSlice } from "../storeTypes";

export const createCommentsSlice: StateCreator<Store, [], [], CommentsSlice> = (
  set,
  get,
) => ({
  comments: initialWorkspace.comments,

  addComment: (c) => {
    set((s) => ({ comments: [...s.comments, c] }));
  },

  // Block comment: wrap the block's html in a cmt-anchor span (so the highlight
  // shows in the document) and record the thread. Ported from app.jsx addBlockComment.
  addBlockComment: (blockId, text) => {
    const cid = uid("cmt");
    const el = document.querySelector(`#bw-${blockId} .block`);
    if (el) {
      el.innerHTML = `<span class="cmt-anchor" data-cmt="${cid}">${el.innerHTML}</span>`;
      get().setBlocks((bs) =>
        bs.map((b) =>
          b.id === blockId
            ? { ...b, html: el.innerHTML, text: el.textContent || "" }
            : b,
        ),
      );
    }
    set((s) => ({
      comments: [
        ...s.comments,
        {
          id: cid,
          quote: (text || "").slice(0, 80),
          blockId,
          page: get().page,
          resolved: false,
          messages: [],
        },
      ],
    }));
    get().openPanelTab("comments");
  },

  // Selection comment (the cmt-anchor span is inserted by SelectionToolbar in Phase 5).
  addSelectionComment: (cid, text) => {
    set((s) => ({
      comments: [
        ...s.comments,
        {
          id: cid,
          quote: text,
          blockId: null,
          page: get().page,
          resolved: false,
          messages: [],
        },
      ],
    }));
    get().openPanelTab("comments");
    get().flash("Comment thread started");
  },

  replyComment: (id, text) =>
    set((s) => ({
      comments: s.comments.map((c) =>
        c.id === id
          ? {
              ...c,
              messages: [
                ...c.messages,
                {
                  name: "Maya Rao",
                  initials: "MR",
                  color: get().t.accent,
                  time: "just now",
                  text,
                },
              ],
            }
          : c,
      ),
    })),

  resolveComment: (id) =>
    set((s) => ({
      comments: s.comments.map((c) =>
        c.id === id ? { ...c, resolved: !c.resolved } : c,
      ),
    })),

  removeComment: (id) => {
    // unwrap any cmt-anchor span left in the document
    document
      .querySelectorAll(`[data-cmt="${id}"]`)
      .forEach((n) => n.replaceWith(...n.childNodes));
    set((s) => ({ comments: s.comments.filter((c) => c.id !== id) }));
  },
});
