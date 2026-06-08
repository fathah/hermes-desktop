// ui.ts — transient UI state: panel, palette, modals, popovers, toast, focus.
// Ported from the UI useState calls in app.jsx.
import type { StateCreator } from "zustand";
import type { Store, UiSlice, RightTab } from "../storeTypes";
import { loadTweaks } from "./tweaks";

let toastTimer: ReturnType<typeof setTimeout> | null = null;

// The active right-panel tab is the one bit of "transient" UI worth persisting:
// users expect Outline/Comments/Info to still be selected after a reload, not to
// silently snap back to Assistant. panelOpen stays transient (defaults open).
const RIGHT_TAB_KEY = "sps-agent-righttab-v1";
const RIGHT_TABS: RightTab[] = ["assistant", "outline", "comments", "info"];

function loadRightTab(): RightTab {
  try {
    const v = localStorage.getItem(RIGHT_TAB_KEY) as RightTab | null;
    if (v && RIGHT_TABS.includes(v)) return v;
  } catch {
    /* localStorage unavailable — fall through to default */
  }
  return "assistant";
}

function saveRightTab(t: RightTab): void {
  try {
    localStorage.setItem(RIGHT_TAB_KEY, t);
  } catch {
    /* non-fatal: persistence is a nicety, not a correctness requirement */
  }
}

export const createUiSlice: StateCreator<Store, [], [], UiSlice> = (set) => ({
  panelOpen: true,
  rightTab: loadRightTab(),
  surface: loadTweaks().homeSurface ?? "doc",
  paletteOpen: false,
  templatesOpen: null,
  trashOpen: false,
  researchOpen: false,
  tweaksOpen: false,
  openTask: null,
  emojiPick: null,
  coverPick: null,
  toast: null,
  focusReq: null,
  activeChatSession: null,
  pendingChatPrompt: null,
  chatNonce: 0,
  activeObsidianPath: null,

  setPanelOpen: (v) => set({ panelOpen: v }),
  setRightTab: (t) => {
    saveRightTab(t);
    set({ rightTab: t });
  },
  // Always opens the panel AND selects the tab — never closes. Closing the panel
  // is the dedicated X button's / ⌘J's job, so the tab buttons stay predictable.
  openPanelTab: (t) => {
    saveRightTab(t);
    set({ panelOpen: true, rightTab: t });
  },
  setSurface: (s) => set({ surface: s }),
  setPaletteOpen: (v) => set({ paletteOpen: v }),
  setTemplatesOpen: (v) => set({ templatesOpen: v }),
  setTrashOpen: (v) => set({ trashOpen: v }),
  setResearchOpen: (v) => set({ researchOpen: v }),
  setTweaksOpen: (v) => set({ tweaksOpen: v }),
  setOpenTask: (t) => set({ openTask: t }),
  setEmojiPick: (v) => set({ emojiPick: v }),
  setCoverPick: (v) => set({ coverPick: v }),
  setFocusReq: (id) => set({ focusReq: id }),
  setActiveChatSession: (id) =>
    set((s) => ({ activeChatSession: id, chatNonce: s.chatNonce + 1 })),
  setPendingChatPrompt: (text) => set({ pendingChatPrompt: text }),
  setActiveObsidianPath: (path) => set({ activeObsidianPath: path }),

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
