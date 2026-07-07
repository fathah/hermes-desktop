// cockpit.ts — the customizable home "cockpit" dashboard layout (localStorage).
// The cockpit is an ordered list of widgets, each spanning 1 or 2 columns. Like
// tweaks/sidebar/templates this is per-machine UI config, not workspace content,
// so it lives in localStorage rather than the workspace.json substrate.
import type { StateCreator } from "zustand";
import type {
  CockpitSlice,
  CockpitWidget,
  Store,
  WidgetKind,
} from "../storeTypes";

const KEY = "sps-agent-cockpit-v1";
const ALL_KINDS: WidgetKind[] = [
  "quick",
  "glance",
  "notes",
  "pages",
  "ask",
  "recentChats",
  "today",
  "agent",
  "guide",
  "operatorTasks",
  "operatorInbox",
  "operatorBrief",
  "operatorApprovals",
  "operatorUpdates",
  "equityAlerts",
  "pulse",
  "piping",
];

const DEFAULT_COCKPIT: CockpitWidget[] = [
  { kind: "operatorTasks", span: 2 },
  { kind: "operatorInbox", span: 1 },
  { kind: "operatorBrief", span: 1 },
  { kind: "operatorApprovals", span: 1 },
  { kind: "operatorUpdates", span: 2 },
  { kind: "equityAlerts", span: 1 },
  { kind: "quick", span: 2 },
  { kind: "agent", span: 1 },
  { kind: "today", span: 1 },
  { kind: "glance", span: 1 },
  { kind: "ask", span: 1 },
  { kind: "guide", span: 2 },
  { kind: "pulse", span: 2 },
  { kind: "piping", span: 2 },
  { kind: "recentChats", span: 2 },
  { kind: "notes", span: 1 },
  { kind: "pages", span: 1 },
];

function isKind(v: unknown): v is WidgetKind {
  return typeof v === "string" && (ALL_KINDS as string[]).includes(v);
}

export function loadCockpit(): CockpitWidget[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_COCKPIT;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_COCKPIT;
    const clean = parsed
      .filter((w) => w && isKind(w.kind))
      .map((w) => ({
        kind: w.kind as WidgetKind,
        span: w.span === 2 ? 2 : 1,
      })) as CockpitWidget[];
    return clean.length ? clean : DEFAULT_COCKPIT;
  } catch {
    return DEFAULT_COCKPIT;
  }
}

export function saveCockpit(list: CockpitWidget[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* non-fatal: the cockpit layout is a convenience, not workspace data */
  }
}

export const createCockpitSlice: StateCreator<Store, [], [], CockpitSlice> = (
  set,
) => ({
  cockpit: loadCockpit(),

  reorderCockpit: (from, to) =>
    set((s) => {
      if (from === to || from < 0 || to < 0) return {};
      const next = s.cockpit.slice();
      const [moved] = next.splice(from, 1);
      if (!moved) return {};
      next.splice(to, 0, moved);
      return { cockpit: next };
    }),

  setCockpitSpan: (index, span) =>
    set((s) => ({
      cockpit: s.cockpit.map((w, i) => (i === index ? { ...w, span } : w)),
    })),

  removeCockpitWidget: (index) =>
    set((s) => ({ cockpit: s.cockpit.filter((_, i) => i !== index) })),

  addCockpitWidget: (kind) =>
    set((s) => ({ cockpit: [...s.cockpit, { kind, span: 1 }] })),

  resetCockpit: () => set({ cockpit: DEFAULT_COCKPIT }),
});
