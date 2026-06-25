// CoverPicker.tsx — page cover color picker + upload/remove. Ported from pickers.jsx.
import { Icon } from "../Icon";

const COVERS: [string, string][] = [
  ["Ochre", "var(--accent)"],
  ["Navy", "#1B4F8A"],
  ["Brick", "#A1202C"],
  ["Green", "#1F6B3A"],
  ["Slate", "#44484F"],
  ["Sand", "#C9C1AE"],
  ["Plum", "#5A3A8A"],
  ["Ink", "#161511"],
];

interface Props {
  x: number;
  y: number;
  onPick: (color: string) => void;
  onImage: () => void;
  onRemove: () => void;
  onClose: () => void;
}

export function CoverPicker({
  x,
  y,
  onPick,
  onImage,
  onRemove,
  onClose,
}: Props) {
  const left = Math.min(x, window.innerWidth - 280);
  const top = Math.min(y, window.innerHeight - 200);
  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 74 }}
        onMouseDown={onClose}
      />
      <div className="emoji-pop" style={{ left, top, width: 256 }}>
        <div className="menu-label">Cover color</div>
        <div className="sw-row">
          {COVERS.map(([name, col]) => (
            <div
              key={name}
              className="sw"
              title={name}
              style={{ background: col, width: 44, height: 30 }}
              onClick={() => onPick(col)}
            ></div>
          ))}
        </div>
        <div className="emoji-foot">
          <button className="cover-btn" onClick={onImage}>
            <Icon name="doc" size={13} /> Upload image
          </button>
          <button className="cover-btn" onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
    </>
  );
}
