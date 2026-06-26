// BlockInner.tsx — renders one block by type. Ported from editor.jsx BlockInner.
// The 'database' case is a placeholder until Phase 6 swaps in <TasksDB>.
import type { RefObject } from "react";
import { Icon } from "../components/Icon";
import { Editable } from "./Editable";
import { DiffBlock } from "./DiffBlock";
import { ImageBlock } from "./ImageBlock";
import { AudioBlock } from "./AudioBlock";
import { VideoBlock } from "./VideoBlock";
import { FileBlock } from "./FileBlock";
import { BookmarkBlock } from "./BookmarkBlock";
import { ButtonBlock } from "./ButtonBlock";
import { ColumnsBlock } from "./ColumnsBlock";
import { PageLinkBlock } from "./PageLinkBlock";
import { EmbedBlock } from "./EmbedBlock";
import { MermaidBlock } from "./MermaidBlock";
import { ExcalidrawBlock } from "./ExcalidrawBlock";
import { TasksDB } from "../tasks/TasksDB";
import { QueryDatabase } from "../tasks/QueryDatabase";
import type { Block, BlockType, DbView, PageMeta, Task } from "../types";

export interface BlockInnerProps {
  block: Block;
  updateBlock: (id: string, html: string, text: string) => void;
  onEnter: (id: string, el: HTMLElement) => void;
  onBackspaceEmpty: (id: string) => void;
  onIndent: (id: string, dir: number) => void;
  onArrow: (id: string, dir: number, el: HTMLElement) => boolean;
  toggleTodo: (id: string) => void;
  toggleCollapse: (id: string) => void;
  registerRef: (id: string, ref: RefObject<HTMLDivElement | null>) => void;
  setView: (id: string, view: DbView) => void;
  onOpenTask: (task: Task) => void;
  setType: (id: string, patch: Partial<Block>) => void;
  onInputFromDom: (id: string) => void;
  onDecision: (proposalId: string, accept: boolean) => void;
  onOpenPage?: (id: string) => void;
  pageMeta?: Record<string, PageMeta>;
}

export function BlockInner(props: BlockInnerProps) {
  const { block } = props;
  if (block.diff)
    return <DiffBlock block={block} onDecision={props.onDecision} />;

  const common = {
    block,
    onInput: props.updateBlock,
    onEnter: props.onEnter,
    onBackspaceEmpty: props.onBackspaceEmpty,
    onIndent: props.onIndent,
    onArrow: props.onArrow,
    registerRef: props.registerRef,
    color: block.color,
  };

  switch (block.type) {
    case "h1":
      return <Editable {...common} cls="b-h1" placeholder="Heading 1" />;
    case "h2":
      return <Editable {...common} cls="b-h2" placeholder="Heading 2" />;
    case "h3":
      return <Editable {...common} cls="b-h3" placeholder="Heading 3" />;
    case "quote":
      return <Editable {...common} cls="b-quote" placeholder="Quote" />;
    case "code":
      return <Editable {...common} cls="b-code" placeholder="Code" />;
    case "divider":
      return (
        <div className="b-divider-wrap">
          <hr className="b-divider" />
        </div>
      );
    case "toggle":
      return (
        <div className="b-toggle-row">
          <span
            className={`toggle-tri ${block.collapsed ? "" : "open"}`}
            onClick={() => props.toggleCollapse(block.id)}
          >
            <Icon name="chevR" size={14} />
          </span>
          <Editable {...common} cls="" placeholder="Toggle" />
        </div>
      );
    case "callout":
      return (
        <div className="b-callout">
          <span className="emoji">{block.emoji || "💡"}</span>
          <Editable {...common} cls="" placeholder="Type something…" />
        </div>
      );
    case "todo":
      return (
        <div className={`b-todo ${block.done ? "done" : ""}`}>
          <div
            className={`check ${block.done ? "done" : ""}`}
            onClick={() => props.toggleTodo(block.id)}
          >
            {block.done && <Icon name="check" size={13} stroke={2.4} />}
          </div>
          <Editable {...common} cls="" placeholder="To-do" />
        </div>
      );
    case "li":
      return (
        <div className="b-li">
          <span className="marker bullet">•</span>
          <Editable {...common} cls="" placeholder="List item" />
        </div>
      );
    case "numli":
      return (
        <div className="b-li">
          <span className="marker num">1.</span>
          <Editable {...common} cls="" placeholder="List item" />
        </div>
      );
    case "image":
      return <ImageBlock block={block} setType={props.setType} />;
    case "mermaid":
      return <MermaidBlock block={block} setType={props.setType} />;
    case "excalidraw":
      return <ExcalidrawBlock block={block} setType={props.setType} />;
    case "audio":
      return <AudioBlock block={block} setType={props.setType} />;
    case "video":
      return <VideoBlock block={block} setType={props.setType} />;
    case "file":
      return <FileBlock block={block} setType={props.setType} />;
    case "bookmark":
      return <BookmarkBlock block={block} setType={props.setType} />;
    case "button":
      return <ButtonBlock block={block} setType={props.setType} />;
    case "columns":
      return <ColumnsBlock block={block} setType={props.setType} />;
    case "page":
      return (
        <PageLinkBlock
          block={block}
          pageMeta={props.pageMeta}
          onOpenPage={props.onOpenPage}
        />
      );
    case "embed":
      return (
        <EmbedBlock
          block={block}
          pageMeta={props.pageMeta}
          onOpenPage={props.onOpenPage}
        />
      );
    case "database":
      // A `source` opts the block into the folder-backed query database (S4);
      // otherwise it stays the classic embedded-rows board (unchanged).
      return block.source ? (
        <QueryDatabase
          block={block}
          update={(patch) => props.setType(block.id, patch)}
        />
      ) : (
        <TasksDB
          block={block}
          update={(patch) => props.setType(block.id, patch)}
          onOpenTask={props.onOpenTask}
        />
      );
    default:
      return (
        <Editable
          {...common}
          cls=""
          placeholder="Write something, or press '/' for commands…"
        />
      );
  }
}

// re-export for type sharing
export type { BlockType };
