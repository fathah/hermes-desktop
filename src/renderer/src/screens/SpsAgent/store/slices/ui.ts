// ui.ts — transient UI state: panel, palette, modals, popovers, toast, focus.
// Ported from the UI useState calls in app.jsx.
import type { StateCreator } from "zustand";
import type { Store, UiSlice } from "../storeTypes";

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const createUiSlice: StateCreator<Store, [], [], UiSlice> = (set) => ({
  panelOpen: true,
  rightTab: "assistant",
  surface: "doc",
  paletteOpen: false,
  templatesOpen: null,
  trashOpen: false,
  tweaksOpen: false,
  openTask: null,
  emojiPick: null,
  coverPick: null,
  toast: null,
  focusReq: null,
  activeChatSession: null,
  pendingChatPrompt: null,
  chatNonce: 0,

  setPanelOpen: (v) => set({ panelOpen: v }),
  setRightTab: (t) => set({ rightTab: t }),
  openPanelTab: (t) => set({ panelOpen: true, rightTab: t }),
  setSurface: (s) => set({ surface: s }),
  setPaletteOpen: (v) => set({ paletteOpen: v }),
  setTemplatesOpen: (v) => set({ templatesOpen: v }),
  setTrashOpen: (v) => set({ trashOpen: v }),
  setTweaksOpen: (v) => set({ tweaksOpen: v }),
  setOpenTask: (t) => set({ openTask: t }),
  setEmojiPick: (v) => set({ emojiPick: v }),
  setCoverPick: (v) => set({ coverPick: v }),
  setFocusReq: (id) => set({ focusReq: id }),
  setActiveChatSession: (id) =>
    set((s) => ({ activeChatSession: id, chatNonce: s.chatNonce + 1 })),
  setPendingChatPrompt: (text) => set({ pendingChatPrompt: text }),

  startNewChat: (prompt) =>
    set((s) => ({
      surface: "chats",
      activeChatSession: null,
      pendingChatPrompt: prompt ?? null,
      chatNonce: s.chatNonce + 1,
    })),

  flash: (text, opts) => {
    set({ toast: { text, ...(opts?.tone ? { tone: opts.tone } : {}) } });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), opts?.ms ?? 2200);
  },
});
