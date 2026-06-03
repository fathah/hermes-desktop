/**
 * Memory timeline assembly (idea A4) — main-process IO.
 *
 * Reads MEMORY.md entries (read-only; format unchanged) and pairs each with its
 * most likely originating session via FTS, using the pure helpers in
 * `../shared/memoryTimeline`. Provenance is best-effort: a missing or empty
 * match just yields an entry with no provenance.
 */

import { readMemory } from "./memory";
import { searchSessions } from "./sessions";
import {
  type MemoryTimeline,
  type TimelineEntry,
  entryQuery,
  pickProvenance,
} from "../shared/memoryTimeline";

export function getMemoryTimeline(profile?: string): MemoryTimeline {
  const entries = readMemory(profile).memory.entries;
  const out: TimelineEntry[] = entries.map((entry) => {
    const query = entryQuery(entry.content);
    let provenance;
    if (query) {
      try {
        const hits = searchSessions(query, 5);
        provenance = pickProvenance(
          hits.map((h) => ({
            sessionId: h.sessionId,
            title: h.title,
            startedAt: h.startedAt,
          })),
        );
      } catch {
        // FTS unavailable / DB locked — entry simply has no provenance.
      }
    }
    return { index: entry.index, content: entry.content, provenance };
  });
  return { entries: out };
}
