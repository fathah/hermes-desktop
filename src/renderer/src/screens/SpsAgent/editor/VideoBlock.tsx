// VideoBlock.tsx — inline video, streamed from the vault asset store over the
// sps-asset:// protocol (range requests → seeking works without loading the
// whole file into memory).
import { MediaDropZone } from "../components/MediaDropZone";
import { assetUrl } from "../lib/assets";
import type { Block } from "../types";

interface Props {
  block: Block;
  setType: (id: string, patch: Partial<Block>) => void;
}

export function VideoBlock({ block, setType }: Props) {
  if (!block.assetPath) {
    return (
      <div className="b-video">
        <MediaDropZone
          accept="video/*"
          placeholder="Drop a video, or click to upload"
          onUpload={(a) =>
            setType(block.id, {
              assetPath: a.assetPath,
              mime: a.mime,
              name: a.name,
              size: a.size,
            })
          }
        />
      </div>
    );
  }
  return (
    <div className="b-video" contentEditable={false}>
      <video
        src={assetUrl(block.assetPath)}
        controls
        preload="metadata"
        style={{ display: "block", maxWidth: "100%", borderRadius: 8 }}
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
