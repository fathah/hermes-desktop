// BlockMenu.tsx — block context menu (turn-into / color / duplicate / copy link /
// delete / comment). Ported from blockmenu.jsx.
import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import type { IconName } from "../components/iconPaths";
import type { Block, BlockType } from "../types";

interface TurnIntoItem {
  type: BlockType;
  icon: IconName;
  label: string;
}

export const TURN_INTO: TurnIntoItem[] = [
  { type: "p", icon: "text", label: "Text" },
  { type: "h1", icon: "h1", label: "Heading 1" },
  { type: "h2", icon: "h2", label: "Heading 2" },
  { type: "h3", icon: "h3", label: "Heading 3" },
  { type: "todo", icon: "checkbox", label: "To-do list" },
  { type: "li", icon: "bullet", label: "Bulleted list" },
  { type: "numli", icon: "numlist", label: "Numbered list" },
  { type: "toggle", icon: "chevR", label: "Toggle list" },
  { type: "quote", icon: "quote", label: "Quote" },
  { type: "callout", icon: "callout", label: "Callout" },
  { type: "code", icon: "code", label: "Code" },
];

const TEXT_COLOR_SWATCHES: [string, string | null, string][] = [
  ["default", null, "var(--tx-1)"],
  ["gray", "gray", "#6B7079"],
  ["brown", "brown", "#8a6a4a"],
  ["red", "red", "#A1202C"],
  ["orange", "orange", "#9a6212"],
  ["green", "green", "#1F6B3A"],
  ["blue", "blue", "#1B4F8A"],
  ["purple", "purple", "#5A3A8A"],
];
const BG_SWATCHES: [string, string | null, string][] = [
  ["none", null, "transparent"],
  ["gray", "gray", "var(--sunk)"],
  ["yellow", "yellow", "rgba(242,183,5,0.18)"],
  ["green", "green", "rgba(31,107,58,0.13)"],
  ["blue", "blue", "rgba(27,79,138,0.12)"],
  ["red", "red", "rgba(161,32,44,0.10)"],
];

interface Props {
  x: number;
  y: number;
  block: Block;
  onClose: () => void;
  onTurnInto: (id: string, type: BlockType) => void;
  onColor: (
    id: string,
    patch: { color?: string | null; bg?: string | null },
  ) => void;
  onDuplicate: (id: string) => void;
  onCopyLink: (id: string) => void;
  onDelete: (id: string) => void;
  onComment: (id: string) => void;
}

export function BlockMenu({
  x,
  y,
  block,
  onClose,
  onTurnInto,
  onColor,
  onDuplicate,
  onCopyLink,
  onDelete,
  onComment,
}: Props) {
  const [view, setView] = useState<"root" | "turn" | "color">("root");
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 260);
  const top = Math.min(y, window.innerHeight - 360);

  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 63 }}
        onMouseDown={onClose}
      />
      <div
        className="menu scroll"
        style={{ left, top, width: 232, zIndex: 64 }}
      >
        {view === "root" && (
          <>
            <div className="menu-mini" onClick={() => setView("turn")}>
              <Icon name="text" size={16} /> Turn into{" "}
              <span className="menu-sub-arrow">
                <Icon name="chevR" size={14} />
              </span>
            </div>
            <div className="menu-mini" onClick={() => setView("color")}>
              <Icon name="callout" size={16} /> Color{" "}
              <span className="menu-sub-arrow">
                <Icon name="chevR" size={14} />
              </span>
            </div>
            <div className="menu-divider"></div>
            <div
              className="menu-mini"
              onClick={() => {
                onComment(block.id);
                onClose();
              }}
            >
              <Icon name="comment" size={16} /> Comment
            </div>
            <div
              className="menu-mini"
              onClick={() => {
                onDuplicate(block.id);
                onClose();
              }}
            >
              <Icon name="doc" size={16} /> Duplicate{" "}
              <span className="kbd-r kbd">⌘D</span>
            </div>
            <div
              className="menu-mini"
              onClick={() => {
                onCopyLink(block.id);
                onClose();
              }}
            >
              <Icon name="share" size={16} /> Copy link to block
            </div>
            <div className="menu-divider"></div>
            <div
              className="menu-mini danger"
              onClick={() => {
                onDelete(block.id);
                onClose();
              }}
            >
              <Icon name="trash" size={16} /> Delete{" "}
              <span className="kbd-r kbd">Del</span>
            </div>
          </>
        )}

        {view === "turn" && (
          <>
            <div
              className="menu-mini"
              onClick={() => setView("root")}
              style={{ color: "var(--tx-3)" }}
            >
              <Icon
                name="chevR"
                size={14}
                style={{ transform: "rotate(180deg)" }}
              />{" "}
              Turn into
            </div>
            <div className="menu-divider"></div>
            {TURN_INTO.map((it) => (
              <div
                key={it.type}
                className={`menu-mini ${block.type === it.type ? "sel" : ""}`}
                onClick={() => {
                  onTurnInto(block.id, it.type);
                  onClose();
                }}
              >
                <Icon name={it.icon} size={16} /> {it.label}
                {block.type === it.type && (
                  <span className="menu-sub-arrow">
                    <Icon name="check" size={14} />
                  </span>
                )}
              </div>
            ))}
          </>
        )}

        {view === "color" && (
          <>
            <div
              className="menu-mini"
              onClick={() => setView("root")}
              style={{ color: "var(--tx-3)" }}
            >
              <Icon
                name="chevR"
                size={14}
                style={{ transform: "rotate(180deg)" }}
              />{" "}
              Color
            </div>
            <div className="menu-label">Text</div>
            <div className="sw-row">
              {TEXT_COLOR_SWATCHES.map(([name, key, col]) => (
                <div
                  key={name}
                  className="sw"
                  title={name}
                  style={{ color: col }}
                  onClick={() => {
                    onColor(block.id, { color: key });
                    onClose();
                  }}
                >
                  A
                </div>
              ))}
            </div>
            <div className="menu-label">Background</div>
            <div className="sw-row">
              {BG_SWATCHES.map(([name, key, col]) => (
                <div
                  key={name}
                  className="sw"
                  title={name}
                  style={{ background: col }}
                  onClick={() => {
                    onColor(block.id, { bg: key });
                    onClose();
                  }}
                ></div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
