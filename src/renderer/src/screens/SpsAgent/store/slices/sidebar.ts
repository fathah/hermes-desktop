// sidebar.ts — named, toggleable, collapsible rail sections (Notion 3.1 grammar).
// Persisted to localStorage, separately from the workspace document and Tweaks,
// exactly like tweaks.ts. The "hide complexity" default: only recents/agents/
// private are shown; meetings/shared/apps are off until the user enables them.
import type { StateCreator } from "zustand";
import type { SectionId, SidebarSlice, Store } from "../storeTypes";

const SIDEBAR_KEY = "sps-agent-sidebar-v1";

interface SidebarPersist {
  sectionsEnabled: Record<SectionId, boolean>;
  sectionsOpen: Record<SectionId, boolean>;
}

const ENABLED_DEFAULTS: Record<SectionId, boolean> = {
  meetings: false,
  recents: true,
  agents: true,
  shared: false,
  private: true,
  apps: false,
  aiAssistant: true,
  workspaceTools: true,
};

const OPEN_DEFAULTS: Record<SectionId, boolean> = {
  meetings: true,
  recents: true,
  agents: true,
  shared: true,
  private: true,
  apps: true,
  aiAssistant: true,
  workspaceTools: true,
};

function loadSidebar(): SidebarPersist {
  const fallback: SidebarPersist = {
    sectionsEnabled: { ...ENABLED_DEFAULTS },
    sectionsOpen: { ...OPEN_DEFAULTS },
  };
  try {
    const raw = localStorage.getItem(SIDEBAR_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SidebarPersist>;
    return {
      sectionsEnabled: { ...ENABLED_DEFAULTS, ...parsed.sectionsEnabled },
      sectionsOpen: { ...OPEN_DEFAULTS, ...parsed.sectionsOpen },
    };
  } catch {
    return fallback;
  }
}

export function saveSidebar(s: SidebarPersist): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export const createSidebarSlice: StateCreator<Store, [], [], SidebarSlice> = (
  set,
) => {
  const initial = loadSidebar();
  return {
    sectionsEnabled: initial.sectionsEnabled,
    sectionsOpen: initial.sectionsOpen,
    setSectionEnabled: (id, v) =>
      set((s) => ({
        sectionsEnabled: { ...s.sectionsEnabled, [id]: v },
      })),
    toggleSection: (id) =>
      set((s) => ({
        sectionsOpen: { ...s.sectionsOpen, [id]: !s.sectionsOpen[id] },
      })),
  };
};
