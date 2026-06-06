// ImageBlock.tsx — image block with caption. New images are written to the
// vault asset store (streamed via sps-asset://); legacy data-URL images in
// `src` still render for backward compatibility.
import { MediaDropZone } from "../components/MediaDropZone";
import { assetUrl } from "../lib/assets";
import type { Block } from "../types";

interface Props {
  block: Block;
  setType: (id: string, patch: Partial<Block>) => void;
}

export function ImageBlock({ block, setType }: Props) {
  const displaySrc = block.assetPath ? assetUrl(block.assetPath) : block.src;

  return (
    <div className="b-image">
      {displaySrc ? (
        <img
          className="image-slot-img"
          src={displaySrc}
          alt={block.caption || ""}
          style={{ display: "block", maxWidth: "100%", borderRadius: 8 }}
        />
      ) : (
        <MediaDropZone
          accept="image/*"
          placeholder="Drop an image, or click to upload"
          onUpload={(a) =>
            setType(block.id, {
              assetPath: a.assetPath,
              mime: a.mime,
              name: a.name,
              size: a.size,
              src: null,
            })
          }
        />
      )}
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
