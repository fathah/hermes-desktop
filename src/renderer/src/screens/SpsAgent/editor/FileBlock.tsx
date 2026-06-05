// FileBlock.tsx — arbitrary file attachment shown as a chip. New files are
// written to the vault asset store; "Save" copies the original out via a save
// dialog (saveMediaFile reads the streamed asset URL).
import { MediaDropZone } from "../components/MediaDropZone";
import { Icon } from "../components/Icon";
import { assetUrl, prettySize } from "../lib/assets";
import type { Block } from "../types";

interface Props {
  block: Block;
  setType: (id: string, patch: Partial<Block>) => void;
}

export function FileBlock({ block, setType }: Props) {
  if (!block.assetPath) {
    return (
      <div className="b-file">
        <MediaDropZone
          accept="*/*"
          placeholder="Drop a file, or click to upload"
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

  const save = (): void => {
    const api = window.hermesAPI;
    if (!api?.saveMediaFile || !block.assetPath) return;
    void api.saveMediaFile(assetUrl(block.assetPath), block.name || "file");
  };

  return (
    <div className="b-file file-chip" contentEditable={false}>
      <span className="file-chip-ic">
        <Icon name="file" size={18} />
      </span>
      <span className="file-chip-body">
        <span className="file-chip-name">{block.name || "Attachment"}</span>
        <span className="file-chip-meta">{prettySize(block.size)}</span>
      </span>
      <button className="file-chip-btn" title="Save a copy" onClick={save}>
        <Icon
          name="arrowUp"
          size={15}
          style={{ transform: "rotate(180deg)" }}
        />
      </button>
    </div>
  );
}
