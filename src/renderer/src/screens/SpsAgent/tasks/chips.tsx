// chips.tsx — Avatar / StatusChip / PrioChip / KanbanStatusBadge. Ported from tasks.jsx.
import { PEOPLE, STATUS, PRIO } from "../data/seed";
import { kanbanStatusToBadge } from "./kanbanBadge";
import type { PersonKey, PrioKey, StatusKey } from "../types";

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFromId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360} 45% 38%)`;
}

// Resolve a `who` id to an avatar. Seeded people (e.g. "you") keep their fixed
// color/initials; a contact person id derives a stable color, and initials from
// the optional display name (falling back to the id).
export function Avatar({
  who,
  name,
  size = 18,
}: {
  who: PersonKey;
  name?: string;
  size?: number;
}) {
  const seeded = PEOPLE[who];
  const color = seeded?.color ?? colorFromId(who);
  const initials = seeded?.initials ?? initialsFromName(name ?? who);
  return (
    <span
      className="av"
      style={{ background: color, width: size, height: size }}
    >
      {initials}
    </span>
  );
}

export function StatusChip({ s }: { s: StatusKey }) {
  const st = STATUS[s];
  return (
    <span className={`chip ${st.cls}`}>
      <span className="pdot" style={{ background: st.dot }}></span>
      {st.label}
    </span>
  );
}

export function PrioChip({ p }: { p: PrioKey }) {
  const pr = PRIO[p];
  return <span className={`chip ${pr.cls}`}>{pr.label}</span>;
}

// Read-only live agent status for a row delegated to the Hermes agent. The 🤖
// marks it as the *agent's* Kanban state, distinct from the row's own vault
// StatusChip; the chip class carries the color. Hidden when the status is
// unknown — non-delegated rows and an unreachable Kanban both render nothing.
export function KanbanStatusBadge({
  status,
}: {
  status: string | null | undefined;
}) {
  const badge = kanbanStatusToBadge(status);
  if (!badge) return null;
  return (
    <span
      className={`chip ${badge.cls}`}
      title={`Agent status: ${badge.label}`}
    >
      🤖 {badge.label}
    </span>
  );
}
