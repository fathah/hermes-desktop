// useJournalEntries.ts — derive the list of journal entries from the live
// store. Entries are root-level pages flagged `journal: true`; deriving from the
// tree (not raw meta) means trashed entries — removed from the tree — drop out
// automatically. No note-index dependency, so the calendar works offline.
import { useMemo } from "react";
import { useStore } from "../store";

export interface JournalEntry {
  id: string;
  date: string; // "YYYY-MM-DD" ("" when unstamped)
  time: string; // "HH:mm" ("" when unstamped)
  title: string;
  icon: string;
  mood?: string;
}

export function useJournalEntries(): JournalEntry[] {
  const tree = useStore((s) => s.tree);
  const meta = useStore((s) => s.meta);
  return useMemo(() => {
    const out: JournalEntry[] = [];
    for (const node of tree) {
      const m = meta[node.id];
      if (!m?.journal) continue;
      out.push({
        id: node.id,
        date: m.date ?? "",
        time: m.time ?? "",
        title: m.title || "Untitled entry",
        icon: m.icon || "📔",
        mood: m.mood,
      });
    }
    return out;
  }, [tree, meta]);
}

/** Group entries by their "YYYY-MM-DD" date key. */
export function groupByDate(
  entries: JournalEntry[],
): Map<string, JournalEntry[]> {
  const map = new Map<string, JournalEntry[]>();
  for (const e of entries) {
    if (!e.date) continue;
    const bucket = map.get(e.date);
    if (bucket) bucket.push(e);
    else map.set(e.date, [e]);
  }
  return map;
}
