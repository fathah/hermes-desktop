// EmojiPicker.tsx — page-icon emoji picker with search + random + remove.
// Ported from pickers.jsx EmojiPicker.
import { Fragment, useState } from "react";
import { Icon } from "../Icon";

const EMOJI: Record<string, string[]> = {
  Suggested: [
    "📄",
    "🏠",
    "🎯",
    "🚀",
    "📌",
    "✅",
    "💡",
    "🔥",
    "⭐",
    "📊",
    "🗓️",
    "🧭",
    "🛠️",
    "📝",
    "🔔",
    "🧪",
  ],
  Objects: [
    "📁",
    "📦",
    "📈",
    "📉",
    "💼",
    "🔖",
    "📎",
    "🗂️",
    "📋",
    "🗒️",
    "📌",
    "✏️",
    "🖊️",
    "📐",
    "🔑",
    "🧱",
    "⚙️",
    "🔧",
    "🧰",
    "💾",
  ],
  Symbols: [
    "✅",
    "❇️",
    "⚡",
    "💠",
    "🔷",
    "🔶",
    "🟢",
    "🟡",
    "🔴",
    "🔵",
    "🟣",
    "⬛",
    "⬜",
    "♻️",
    "🆕",
    "🔝",
  ],
  Nature: [
    "🌱",
    "🌿",
    "🍃",
    "🌲",
    "🌳",
    "⛰️",
    "🌊",
    "☀️",
    "🌙",
    "⭐",
    "🔥",
    "❄️",
    "🌸",
    "🍂",
    "🌼",
    "🪴",
  ],
  People: [
    "👥",
    "🧑‍💻",
    "👩‍💼",
    "🧑‍🔧",
    "🙋",
    "🤝",
    "💬",
    "🧠",
    "👀",
    "✋",
    "👍",
    "🙌",
  ],
  Travel: [
    "🚢",
    "✈️",
    "🗺️",
    "🧭",
    "🏗️",
    "🏢",
    "🏠",
    "🚀",
    "🛰️",
    "🛣️",
    "🏁",
    "📍",
  ],
};

function randomEmoji(): string {
  const all = Object.values(EMOJI).flat();
  return all[Math.floor(Math.random() * all.length)];
}

interface Props {
  x: number;
  y: number;
  onPick: (e: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

export function EmojiPicker({ x, y, onPick, onRemove, onClose }: Props) {
  const [q, setQ] = useState("");
  const left = Math.min(x, window.innerWidth - 336);
  const top = Math.min(y, window.innerHeight - 320);
  const cats = Object.entries(EMOJI);
  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 74 }}
        onMouseDown={onClose}
      />
      <div className="emoji-pop" style={{ left, top }}>
        <input
          className="emoji-search"
          autoFocus
          placeholder="Filter…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="emoji-grid scroll">
          {q
            ? cats
                .flatMap(([, arr]) => arr)
                .filter((e, i, a) => a.indexOf(e) === i)
                .map((e, i) => (
                  <div key={i} className="emoji-cell" onClick={() => onPick(e)}>
                    {e}
                  </div>
                ))
            : cats.map(([cat, arr]) => (
                <Fragment key={cat}>
                  <div className="emoji-cat">{cat}</div>
                  {arr.map((e, i) => (
                    <div
                      key={cat + i}
                      className="emoji-cell"
                      onClick={() => onPick(e)}
                    >
                      {e}
                    </div>
                  ))}
                </Fragment>
              ))}
        </div>
        <div className="emoji-foot">
          <button
            className="cover-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(randomEmoji())}
          >
            <Icon name="sparkle" size={13} /> Random
          </button>
          <button className="cover-btn" onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
    </>
  );
}
