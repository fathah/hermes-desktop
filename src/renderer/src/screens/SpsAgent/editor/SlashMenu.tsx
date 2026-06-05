// SlashMenu.tsx — the "/" block-insert menu. Ported from editor.jsx SlashMenu + SLASH_ITEMS.
import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import type { IconName } from "../components/iconPaths";
import type { BlockType } from "../types";

export interface SlashItem {
  type: BlockType;
  icon: IconName;
  label: string;
  desc: string;
}

export const SLASH_ITEMS: SlashItem[] = [
  { type: "p", icon: "text", label: "Text", desc: "Plain paragraph" },
  { type: "h1", icon: "h1", label: "Heading 1", desc: "Big section heading" },
  { type: "h2", icon: "h2", label: "Heading 2", desc: "Medium heading" },
  { type: "h3", icon: "h3", label: "Heading 3", desc: "Small heading" },
  {
    type: "todo",
    icon: "checkbox",
    label: "To-do list",
    desc: "Track with a checkbox",
  },
  { type: "li", icon: "bullet", label: "Bulleted list", desc: "Simple bullet" },
  {
    type: "numli",
    icon: "numlist",
    label: "Numbered list",
    desc: "Ordered item",
  },
  {
    type: "toggle",
    icon: "chevR",
    label: "Toggle list",
    desc: "Collapsible content",
  },
  { type: "quote", icon: "quote", label: "Quote", desc: "Callout a line" },
  {
    type: "callout",
    icon: "callout",
    label: "Callout",
    desc: "Highlighted note",
  },
  { type: "code", icon: "code", label: "Code", desc: "Monospaced block" },
  {
    type: "divider",
    icon: "divider",
    label: "Divider",
    desc: "Visual separator",
  },
  { type: "image", icon: "doc", label: "Image", desc: "Upload or drop a file" },
  {
    type: "audio",
    icon: "mic",
    label: "Voice / audio",
    desc: "Record or upload audio",
  },
  {
    type: "video",
    icon: "play",
    label: "Video",
    desc: "Upload or drop a video",
  },
  {
    type: "file",
    icon: "file",
    label: "File",
    desc: "Attach any file",
  },
  {
    type: "bookmark",
    icon: "share",
    label: "Web bookmark",
    desc: "Link preview card",
  },
  {
    type: "page",
    icon: "doc",
    label: "Sub-page",
    desc: "A page inside this page",
  },
  {
    type: "database",
    icon: "database",
    label: "Task board",
    desc: "Embedded database",
  },
  {
    type: "mermaid",
    icon: "pageGraph",
    label: "Mermaid diagram",
    desc: "Flowchart, sequence, ER from text",
  },
  {
    type: "excalidraw",
    icon: "wand",
    label: "Excalidraw drawing",
    desc: "Freeform sketch or whiteboard",
  },
  {
    type: "button",
    icon: "sparkle",
    label: "Agent button",
    desc: "A button that runs the co-author",
  },
];

interface Props {
  x: number;
  y: number;
  query: string;
  onPick: (item: SlashItem) => void;
  onClose: () => void;
}

export function SlashMenu({ x, y, query, onPick, onClose }: Props) {
  const [sel, setSel] = useState(0);
  const items = SLASH_ITEMS.filter(
    (it) =>
      !query ||
      it.label.toLowerCase().includes(query.toLowerCase()) ||
      it.type.includes(query.toLowerCase()),
  );
  useEffect(() => {
    setSel(0);
  }, [query]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        items[sel] && onPick(items[sel]);
      } else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [items, sel, onPick, onClose]);
  if (!items.length) return null;
  const top = Math.min(y, window.innerHeight - 340);
  const left = Math.min(x, window.innerWidth - 300);
  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 59 }}
        onMouseDown={onClose}
      />
      <div className="menu scroll" style={{ left, top }}>
        <div className="menu-label">Basic blocks</div>
        {items.map((it, i) => (
          <div
            key={it.type}
            className={`menu-item ${i === sel ? "sel" : ""}`}
            onMouseEnter={() => setSel(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(it);
            }}
          >
            <div className="menu-ic">
              <Icon name={it.icon} size={17} />
            </div>
            <div className="menu-tx">
              <b>{it.label}</b>
              <small>{it.desc}</small>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
