// MentionMenu.tsx — the "@" mention menu (people / pages / dates).
// Ported from pickers.jsx MentionMenu.
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../Icon";
import { TREE, flattenTree } from "../../data/seed";
import { usePersonPages } from "../../hooks/usePersonPages";
import { personMatchesQuery } from "../../../../../../shared/contacts";
import type { MentionItem } from "../../editor/selection";

interface Props {
  x: number;
  y: number;
  query: string;
  onPick: (item: MentionItem) => void;
  onClose: () => void;
  // Manual "Suggest details" — ask the AI to propose fragments/tags for this
  // contact (lands in the Review Queue). Absent ⇒ no enrich affordance.
  onProposeEnrichment?: (personId: string) => void;
}

export function MentionMenu({
  x,
  y,
  query,
  onPick,
  onClose,
  onProposeEnrichment,
}: Props) {
  const [sel, setSel] = useState(0);
  const ql = (query || "").toLowerCase();
  const { persons } = usePersonPages();
  // People are matched on name/alias/tag/fragment (reachable by any scrap),
  // so a contact surfaces even when the query never appears in their name.
  const people: MentionItem[] = useMemo(
    () =>
      persons
        .filter((p) => personMatchesQuery(p, query))
        .map((p) => ({
          kind: "person",
          id: p.id,
          label: p.name,
          initials: (p.name[0] || "?").toUpperCase(),
        })),
    [persons, query],
  );
  const pages: MentionItem[] = useMemo(
    () =>
      flattenTree(TREE)
        .map((n) => ({
          kind: "page" as const,
          id: n.id,
          label: n.label,
          emoji: n.emoji,
        }))
        .filter((i) => !ql || i.label.toLowerCase().includes(ql)),
    [ql],
  );
  const dates: MentionItem[] = useMemo(
    () =>
      (
        [
          { kind: "date", id: "today", label: "Today" },
          { kind: "date", id: "tomorrow", label: "Tomorrow" },
          { kind: "date", id: "friday", label: "Friday" },
        ] as MentionItem[]
      ).filter((i) => !ql || i.label.toLowerCase().includes(ql)),
    [ql],
  );
  const all = useMemo(
    () => [...people, ...pages, ...dates],
    [people, pages, dates],
  );
  useEffect(() => {
    setSel(0);
  }, [query]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, all.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        all[sel] && onPick(all[sel]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [all, sel, onPick, onClose]);
  if (!all.length) return null;
  const top = Math.min(
    y,
    window.innerHeight - Math.min(all.length * 40 + 30, 320) - 10,
  );
  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 59 }}
        onMouseDown={onClose}
      />
      <div className="menu scroll" style={{ left: x, top, minWidth: 250 }}>
        {people.length > 0 && !ql && <div className="menu-label">People</div>}
        {all.map((it, i) => (
          <div
            key={it.kind + it.id}
            className={`menu-mini ${i === sel ? "sel" : ""}`}
            onMouseEnter={() => setSel(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(it);
            }}
          >
            {it.kind === "person" && (
              <span
                className="mention"
                style={{ background: "transparent", padding: 0 }}
              >
                <span className="pico" style={{ background: it.color }}>
                  {it.initials?.[0]}
                </span>
              </span>
            )}
            {it.kind === "page" && <span>{it.emoji}</span>}
            {it.kind === "date" && <Icon name="calendar" size={15} />}
            <span style={{ flex: 1 }}>{it.label}</span>
            {it.kind === "person" && onProposeEnrichment && (
              <button
                type="button"
                title="Suggest details for this contact"
                aria-label={`Suggest details for ${it.label}`}
                style={{
                  marginRight: 6,
                  background: "transparent",
                  border: 0,
                  cursor: "pointer",
                  fontSize: 13,
                  lineHeight: 1,
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onProposeEnrichment(it.id);
                }}
              >
                ✨
              </button>
            )}
            <span style={{ color: "var(--tx-4)", fontSize: 11 }}>
              {it.kind}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
