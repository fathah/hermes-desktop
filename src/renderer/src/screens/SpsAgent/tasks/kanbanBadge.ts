// kanbanBadge.ts — pure mapping from a delegated task's live Kanban status to the
// read-only badge shown on its row. The agent's state lives in Kanban (the row
// only stores `delegatedTo`); this turns that raw status string into a chip def,
// reusing the existing SPS status palette (no new CSS). Unknown/absent → null so
// a row never shows a broken or misleading badge.

export interface KanbanBadge {
  label: string;
  /** Existing `.chip` modifier class from the SPS status palette (data/seed)
   *  — it carries the chip's background/foreground tint on its own. */
  cls: string;
}

// Raw Kanban status (snake_case from the Python CLI) → palette-aligned badge.
// Grouped: queued states collapse to "Queued", terminal to "Done".
const BADGES: Record<string, KanbanBadge> = {
  triage: { label: "Queued", cls: "s-todo" },
  todo: { label: "Queued", cls: "s-todo" },
  ready: { label: "Queued", cls: "s-todo" },
  running: { label: "Running", cls: "s-doing" },
  blocked: { label: "Blocked", cls: "s-blocked" },
  done: { label: "Done", cls: "s-done" },
};

/**
 * Map a raw Kanban status to a badge definition, or `null` when the status is
 * absent or unrecognized (the badge is then hidden rather than mislabeled).
 */
export function kanbanStatusToBadge(
  status: string | null | undefined,
): KanbanBadge | null {
  if (!status) return null;
  const key = status.trim().toLowerCase();
  return BADGES[key] ?? null;
}
