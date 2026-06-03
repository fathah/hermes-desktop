// chips.tsx — Avatar / StatusChip / PrioChip. Ported from tasks.jsx.
import { PEOPLE, STATUS, PRIO } from "../data/seed";
import type { PersonKey, PrioKey, StatusKey } from "../types";

export function Avatar({ who, size = 18 }: { who: PersonKey; size?: number }) {
  const p = PEOPLE[who] || { color: "#888", initials: "?" };
  return (
    <span
      className="av"
      style={{ background: p.color, width: size, height: size }}
    >
      {p.initials}
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
