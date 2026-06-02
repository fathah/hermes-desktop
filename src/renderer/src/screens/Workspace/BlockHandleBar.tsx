import { Copy, Palette, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import type {
  WorkspaceBlockColor,
  WorkspaceBlockType,
} from "./blockExtensions";

export type BlockHandleAction =
  | { type: "duplicate"; blockId: string }
  | { type: "delete"; blockId: string }
  | { type: "move-up"; blockId: string }
  | { type: "move-down"; blockId: string }
  | { type: "turn"; blockId: string; blockType: WorkspaceBlockType }
  | { type: "color"; blockId: string; color: WorkspaceBlockColor };

interface BlockHandleBarProps {
  blockId: string;
  onAction: (action: BlockHandleAction) => void;
}

export default function BlockHandleBar({
  blockId,
  onAction,
}: BlockHandleBarProps): React.JSX.Element {
  return (
    <div className="workspace-block-handle-bar" aria-label="Block controls">
      <button
        type="button"
        aria-label="Duplicate block"
        onClick={() => onAction({ type: "duplicate", blockId })}
      >
        <Copy size={14} />
      </button>
      <button
        type="button"
        aria-label="Delete block"
        onClick={() => onAction({ type: "delete", blockId })}
      >
        <Trash2 size={14} />
      </button>
      <button
        type="button"
        aria-label="Move block up"
        onClick={() => onAction({ type: "move-up", blockId })}
      >
        <ArrowUp size={14} />
      </button>
      <button
        type="button"
        aria-label="Move block down"
        onClick={() => onAction({ type: "move-down", blockId })}
      >
        <ArrowDown size={14} />
      </button>
      <label>
        <span>Turn block into</span>
        <select
          defaultValue=""
          onChange={(event) => {
            if (!event.target.value) return;
            onAction({
              type: "turn",
              blockId,
              blockType: event.target.value as WorkspaceBlockType,
            });
            event.target.value = "";
          }}
        >
          <option value="" disabled>
            Turn into
          </option>
          <option value="paragraph">Text</option>
          <option value="heading">Heading</option>
          <option value="todo">Todo</option>
          <option value="toggle">Toggle</option>
          <option value="callout">Callout</option>
          <option value="quote">Quote</option>
          <option value="code">Code</option>
        </select>
      </label>
      <label>
        <span>Block color</span>
        <Palette size={13} />
        <select
          defaultValue="default"
          onChange={(event) =>
            onAction({
              type: "color",
              blockId,
              color: event.target.value as WorkspaceBlockColor,
            })
          }
        >
          <option value="default">Default</option>
          <option value="gray">Gray</option>
          <option value="yellow">Yellow</option>
          <option value="green">Green</option>
          <option value="blue">Blue</option>
          <option value="red">Red</option>
        </select>
      </label>
    </div>
  );
}
