// AudioBlock.tsx — voice notes / audio clips. Empty state offers in-app
// recording (VoiceRecorder) or a file upload; once captured, the clip plays
// inline, streamed from the vault asset store.
import { MediaDropZone } from "../components/MediaDropZone";
import { VoiceRecorder } from "../components/VoiceRecorder";
import { assetUrl } from "../lib/assets";
import type { Block } from "../types";

interface Props {
  block: Block;
  setType: (id: string, patch: Partial<Block>) => void;
}

function mmss(total?: number): string {
  if (!total || total < 0) return "";
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export function AudioBlock({ block, setType }: Props) {
  if (!block.assetPath) {
    return (
      <div className="b-audio" contentEditable={false}>
        <div className="audio-empty">
          <VoiceRecorder
            onRecorded={(a, duration) =>
              setType(block.id, {
                assetPath: a.assetPath,
                mime: a.mime,
                name: a.name,
                size: a.size,
                duration,
              })
            }
          />
          <span className="audio-or">or</span>
          <MediaDropZone
            accept="audio/*"
            placeholder="Upload an audio file"
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
      </div>
    );
  }

  return (
    <div className="b-audio audio-player" contentEditable={false}>
      <audio src={assetUrl(block.assetPath)} controls preload="metadata" />
      {block.duration ? (
        <span className="audio-dur">{mmss(block.duration)}</span>
      ) : null}
    </div>
  );
}
