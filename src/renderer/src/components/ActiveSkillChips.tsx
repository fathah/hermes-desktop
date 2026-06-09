import { X } from "lucide-react";
import type { ActiveSkill } from "../lib/useChatSkills";

interface ActiveSkillChipsProps {
  skills: ActiveSkill[];
  onUnload: (name: string) => void;
}

/**
 * Row of chips for skills loaded via `/skill-name`, shown above the composer so
 * the user can see (and remove) what is currently steering the conversation.
 * Inline styles only — this renders inside both the Hermes renderer and the
 * `.sps-scope` container, so it must not depend on either's stylesheet.
 */
export function ActiveSkillChips({
  skills,
  onUnload,
}: ActiveSkillChipsProps): React.JSX.Element | null {
  if (skills.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        padding: "4px 8px",
        alignItems: "center",
      }}
    >
      {skills.map((skill) => (
        <span
          key={skill.path}
          title={`Skill loaded — its instructions are active. Click × to unload.`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 6px 2px 8px",
            fontSize: 12,
            lineHeight: 1.4,
            borderRadius: 999,
            border: "1px solid var(--bd-1, rgba(120,120,140,0.35))",
            background: "var(--bg-2, rgba(120,120,140,0.12))",
            color: "var(--fg-1, inherit)",
          }}
        >
          <Slash />
          {skill.name}
          <button
            type="button"
            aria-label={`Unload ${skill.name}`}
            onClick={() => onUnload(skill.name)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              padding: 0,
              margin: 0,
              color: "inherit",
              opacity: 0.7,
            }}
          >
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}

/** Tiny inline glyph so the chip reads as a skill/command, no extra import weight. */
function Slash(): React.JSX.Element {
  return (
    <span aria-hidden style={{ opacity: 0.5, fontWeight: 600 }}>
      /
    </span>
  );
}
