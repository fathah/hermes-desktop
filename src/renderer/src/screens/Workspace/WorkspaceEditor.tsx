import { useEffect, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import BlockHandleBar, { type BlockHandleAction } from "./BlockHandleBar";
import BlockCommandMenu from "./BlockCommandMenu";
import DatabaseBlock from "./DatabaseBlock";
import PageMentionMenu from "./PageMentionMenu";
import {
  colorBlockById,
  deleteBlockById,
  duplicateBlockById,
  ensureMarkdownBlockIds,
  moveBlockById,
  turnBlockInto,
} from "./blockExtensions";

interface WorkspaceEditorProps {
  path: string;
  content: string;
  pages?: Array<{ path: string; title: string }>;
  onChange: (content: string) => void;
}

function isDatabasePath(path: string): boolean {
  return /\.(ya?ml)$/i.test(path);
}

function markdownFromEditor(editor: unknown): string {
  const storage = (
    editor as { storage?: { markdown?: { getMarkdown?: () => string } } }
  ).storage;
  return storage?.markdown?.getMarkdown?.() ?? "";
}

export default function WorkspaceEditor({
  path,
  content,
  pages = [],
  onChange,
}: WorkspaceEditorProps): React.JSX.Element {
  const [slashOpen, setSlashOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content,
    editorProps: {
      attributes: {
        class: "workspace-editor-prosemirror",
        role: "textbox",
        "aria-label": "Workspace editor",
      },
    },
    onUpdate: ({ editor: updatedEditor }) => {
      onChange(markdownFromEditor(updatedEditor));
    },
  });

  function insertSnippet(snippet: string): void {
    if (!editor) return;
    editor.commands.insertContent(snippet);
    setSlashOpen(false);
    setMentionOpen(false);
  }

  function firstBlockId(): string {
    const withIds = ensureMarkdownBlockIds(content);
    const match = withIds.match(/^<!-- hermes-block:([a-zA-Z0-9_-]+) -->/m);
    return match?.[1] ?? "block-1";
  }

  function applyBlockAction(action: BlockHandleAction): void {
    const withIds = ensureMarkdownBlockIds(content);
    let next = withIds;
    if (action.type === "duplicate") {
      next = duplicateBlockById(withIds, action.blockId);
    } else if (action.type === "delete") {
      next = deleteBlockById(withIds, action.blockId);
    } else if (action.type === "move-up") {
      next = moveBlockById(withIds, action.blockId, "up");
    } else if (action.type === "move-down") {
      next = moveBlockById(withIds, action.blockId, "down");
    } else if (action.type === "turn") {
      next = turnBlockInto(withIds, action.blockId, action.blockType);
    } else if (action.type === "color") {
      next = colorBlockById(withIds, action.blockId, action.color);
    }
    onChange(next);
    editor?.commands.setContent(next, { emitUpdate: false });
  }

  useEffect(() => {
    if (!editor || isDatabasePath(path)) return;
    const current = markdownFromEditor(editor);
    if (current !== content) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [content, editor, path]);

  if (isDatabasePath(path)) {
    return <DatabaseBlock content={content} onChange={onChange} />;
  }

  return (
    <div
      className="workspace-editor"
      onKeyDown={(event) => {
        if (event.key === "/") setSlashOpen(true);
        if (event.key === "@" || event.key === "[") setMentionOpen(true);
        if (event.key === "Escape") setSlashOpen(false);
      }}
      onInputCapture={(event) => {
        const text = (event.target as HTMLElement).textContent;
        if (text !== null && text !== "") onChange(text);
      }}
    >
      <div className="workspace-editor-toolbar" aria-label="Block commands">
        <button type="button" onClick={() => setSlashOpen((open) => !open)}>
          /
        </button>
        <button type="button" onClick={() => insertSnippet("- [ ] Task\n")}>
          Todo
        </button>
        <button type="button" onClick={() => insertSnippet("### Toggle\n\n")}>
          Toggle
        </button>
        <button type="button" onClick={() => insertSnippet("> Callout\n\n")}>
          Callout
        </button>
        <button type="button" onClick={() => insertSnippet("---\n")}>
          Divider
        </button>
        <button type="button" onClick={() => setMentionOpen((open) => !open)}>
          @
        </button>
      </div>
      <BlockHandleBar blockId={firstBlockId()} onAction={applyBlockAction} />
      {slashOpen && <BlockCommandMenu onSelect={insertSnippet} />}
      {mentionOpen && (
        <PageMentionMenu query="" pages={pages} onSelect={insertSnippet} />
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
