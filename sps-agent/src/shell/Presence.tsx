// Presence.tsx — collaborator avatars in the topbar. Static in this build; this is
// the render seam where real presence (Yjs awareness) would plug in later.
import { PEOPLE } from "../data/seed";
import type { PersonKey } from "../types";

const PRESENCE: [PersonKey, string][] = [
  ["theo", "#1F6B3A"],
  ["priya", "#1B4F8A"],
  ["sam", "#5A3A8A"],
];

export function Presence() {
  return (
    <div className="presence">
      {PRESENCE.map(([who, color]) => (
        <span
          key={who}
          className="pres-av"
          style={{ background: color }}
          title={PEOPLE[who].name}
        >
          {PEOPLE[who].initials}
        </span>
      ))}
    </div>
  );
}
