// templates.ts — user-saved page templates (localStorage). The built-in starter
// templates live in TemplatesModal; these are the ones the user saves from their
// own pages so they can stamp out the same structure again. localStorage mirrors
// the tweaks/sidebar pattern: this is a UI convenience layer, not workspace data
// (the PAGES a template creates are markdown-on-disk; the template recipe is not).
import type { StateCreator } from "zustand";
import { uid } from "../../lib/ids";
import type { Store, TemplatesSlice, UserTemplate } from "../storeTypes";

const KEY = "sps-agent-templates-v1";

export function loadUserTemplates(): UserTemplate[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is UserTemplate =>
        !!t &&
        typeof t.id === "string" &&
        typeof t.name === "string" &&
        Array.isArray(t.blocks),
    );
  } catch {
    return [];
  }
}

export function saveUserTemplates(list: UserTemplate[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* non-fatal: templates are a convenience, not a correctness requirement */
  }
}

export const createTemplatesSlice: StateCreator<
  Store,
  [],
  [],
  TemplatesSlice
> = (set, get) => ({
  userTemplates: loadUserTemplates(),

  saveAsTemplate: (pageId) => {
    const s = get();
    const blocks = s.docs[pageId] ?? [];
    if (!blocks.length) {
      s.flash("Nothing to save — the page is empty");
      return;
    }
    const meta = s.meta[pageId];
    const tpl: UserTemplate = {
      id: uid("tpl"),
      emoji: meta?.icon || "📄",
      name: meta?.title || "Untitled",
      desc: "Saved from your page",
      // Detach from the live page blocks so later edits don't mutate the recipe.
      blocks: blocks.map((b) => ({ ...b })),
    };
    set({ userTemplates: [...s.userTemplates, tpl] });
    s.flash("Saved as template");
  },

  removeUserTemplate: (id) =>
    set((s) => ({
      userTemplates: s.userTemplates.filter((t) => t.id !== id),
    })),
});
