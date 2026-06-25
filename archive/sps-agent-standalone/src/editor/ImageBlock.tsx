// ImageBlock.tsx — image block with caption. Ported from editor.jsx ImageBlock,
// using the React ImageSlot port.
import { ImageSlot } from "../components/ImageSlot";
import type { Block } from "../types";

interface Props {
  block: Block;
  setType: (id: string, patch: Partial<Block>) => void;
}

export function ImageBlock({ block, setType }: Props) {
  return (
    <div className="b-image">
      <ImageSlot
        value={block.src}
        onChange={(src) => setType(block.id, { src })}
        shape="rounded"
        radius={8}
        placeholder="Drop an image, or click to upload"
      />
      <div
        className="cap"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onBlur={(e) =>
          setType(block.id, { caption: e.currentTarget.textContent || "" })
        }
      >
        {block.caption || ""}
      </div>
    </div>
  );
}
