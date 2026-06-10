import { useEffect, useState, useCallback } from "react";
import { Clock, Trash2, MessageSquare } from "lucide-react";
import type {
  MemoryTimeline as Timeline,
  TimelineEntry,
} from "../../../../../shared/memoryTimeline";

/**
 * Agent-curated memory timeline (idea A4). Lists memory entries in file order
 * (≈ chronological) with the originating session's provenance (found via FTS),
 * a link to open that session, and a reject (remove) action. Edits/removes
 * reuse the existing memory IPC — no new storage format.
 */
export function MemoryTimeline({
  profile,
  onRefresh,
  onOpenSession,
}: {
  profile?: string;
  onRefresh: () => void;
  onOpenSession?: (sessionId: string) => void;
}): React.JSX.Element {
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    window.hermesAPI
      .getMemoryTimeline(profile)
      .then(setTimeline)
      .catch(() => setTimeline({ entries: [] }))
      .finally(() => setLoading(false));
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRemove = useCallback(
    async (index: number) => {
      await window.hermesAPI.removeMemoryEntry(index, profile);
      load();
      onRefresh();
    },
    [profile, load, onRefresh],
  );

  if (loading) {
    return <div className="memory-timeline-empty">Loading…</div>;
  }

  const entries = timeline?.entries ?? [];
  if (entries.length === 0) {
    return (
      <div className="memory-timeline-empty">
        No memory entries yet. The agent writes here as it learns about you.
      </div>
    );
  }

  return (
    <div className="memory-timeline">
      {entries.map((entry) => (
        <TimelineRow
          key={entry.index}
          entry={entry}
          onRemove={() => handleRemove(entry.index)}
          onOpenSession={onOpenSession}
        />
      ))}
    </div>
  );
}

function TimelineRow({
  entry,
  onRemove,
  onOpenSession,
}: {
  entry: TimelineEntry;
  onRemove: () => void;
  onOpenSession?: (sessionId: string) => void;
}): React.JSX.Element {
  const prov = entry.provenance;
  return (
    <div className="memory-timeline-row">
      <div className="memory-timeline-rail">
        <Clock size={13} />
        <span className="memory-timeline-line" />
      </div>
      <div className="memory-timeline-card">
        <div className="memory-timeline-content">{entry.content}</div>
        <div className="memory-timeline-meta">
          {prov ? (
            <button
              type="button"
              className="memory-timeline-source"
              onClick={() => onOpenSession?.(prov.sessionId)}
              title="Open the session this was likely learned from"
            >
              <MessageSquare size={12} />
              {prov.title || `Session ${prov.sessionId.slice(-6)}`}
              <span className="memory-timeline-date">
                {new Date(prov.startedAt * 1000).toLocaleDateString()}
              </span>
            </button>
          ) : (
            <span className="memory-timeline-source memory-timeline-source--none">
              Origin unknown
            </span>
          )}
          <button
            type="button"
            className="memory-timeline-remove"
            onClick={onRemove}
            title="Reject / remove this memory"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
