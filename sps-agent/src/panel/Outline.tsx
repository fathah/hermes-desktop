// Outline.tsx — heading outline of the current page. Ported from panel.jsx Outline.
import type { Block } from "../types";

interface Props {
  blocks: Block[];
  onScrollToBlock: (id: string) => void;
}

export function Outline({ blocks, onScrollToBlock }: Props) {
  const heads = blocks.filter(
    (b) => ["h1", "h2", "h3"].includes(b.type) && b.text,
  );
  if (!heads.length)
    return (
      <div className="rp-body scroll">
        <div className="outline-empty">
          No headings yet.
          <br />
          Add H1–H3 blocks to build an outline.
        </div>
      </div>
    );
  return (
    <div className="rp-body scroll">
      <div className="outline">
        {heads.map((h) => (
          <button
            key={h.id}
            className={`outline-item ${h.type === "h2" ? "lvl2" : h.type === "h3" ? "lvl3" : ""}`}
            onClick={() => onScrollToBlock(h.id)}
          >
            {h.text}
          </button>
        ))}
      </div>
    </div>
  );
}
