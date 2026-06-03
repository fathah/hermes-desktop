// MentionMenu.tsx — the "@" mention menu (people / pages / dates).
// Ported from pickers.jsx MentionMenu.
import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import { PEOPLE, TREE, flattenTree } from "../../data/seed";
import type { MentionItem } from "../../editor/selection";

interface Props {
  x: number;
  y: number;
  query: string;
  onPick: (item: MentionItem) => void;
  onClose: () => void;
}

export function MentionMenu({ x, y, query, onPick, onClose }: Props) {
  const [sel, setSel] = useState(0);
  const ql = (query || "").toLowerCase();
  const people: MentionItem[] = Object.entries(PEOPLE).map(([k, p]) => ({
    kind: "person",
    id: k,
    label: p.name,
    color: p.color,
    initials: p.initials,
  }));
  const pages: MentionItem[] = flattenTree(TREE).map((n) => ({
    kind: "page",
    id: n.id,
    label: n.label,
    emoji: n.emoji,
  }));
  const dates: MentionItem[] = [
    { kind: "date", id: "today", label: "Today (Jun 2, 2026)" },
    { kind: "date", id: "tomorrow", label: "Tomorrow (Jun 3, 2026)" },
    { kind: "date", id: "friday", label: "Friday (Jun 5, 2026)" },
  ];
  const all = [...people, ...pages, ...dates].filter(
    (i) => !ql || i.label.toLowerCase().includes(ql),
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
            <span style={{ color: "var(--tx-4)", fontSize: 11 }}>
              {it.kind}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
