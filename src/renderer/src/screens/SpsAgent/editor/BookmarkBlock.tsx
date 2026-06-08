// BookmarkBlock.tsx — link preview card / URL entry. Ported from editor.jsx
// BookmarkBlock, routed through the UnfurlProvider (mock now, real endpoint later).
import { useState } from "react";
import { Icon } from "../components/Icon";
import { unfurl } from "../unfurl";
import type { Block } from "../types";

interface Props {
  block: Block;
  setType: (id: string, patch: Partial<Block>) => void;
}

export function BookmarkBlock({ block, setType }: Props) {
  const [url, setUrl] = useState("");

  const bm = block.bm;
  if (bm) {
    return (
      <a
        className="b-bookmark"
        href={bm.url}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => {
          e.preventDefault();
          void window.hermesAPI.openExternal(bm.url);
        }}
      >
        <div className="bm-main">
          <div className="bm-title">{bm.title}</div>
          <div className="bm-desc">{bm.desc}</div>
          <div className="bm-url">
            <span className="fav"></span>
            {bm.url}
          </div>
        </div>
        <div className="bm-thumb">
          <Icon name="share" size={22} />
        </div>
      </a>
    );
  }

  const commit = async () => {
    if (!url.trim()) return;
    const bm = await unfurl.fetch(url.trim());
    setType(block.id, { bm });
  };

  return (
    <div className="st-link-pop" style={{ padding: 0, margin: "4px 0" }}>
      <input
        autoFocus
        placeholder="Paste a link to bookmark…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
        }}
        style={{ width: 320 }}
      />
      <button className="pa-btn pa-accept" onClick={() => void commit()}>
        Create
      </button>
    </div>
  );
}
