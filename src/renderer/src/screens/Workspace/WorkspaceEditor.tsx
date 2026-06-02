import { useEffect, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import BlockCommandMenu from "./BlockCommandMenu";
import DatabaseBlock from "./DatabaseBlock";

interface WorkspaceEditorProps {
  path: string;
  content: string;
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
  onChange,
}: WorkspaceEditorProps): React.JSX.Element {
  const [slashOpen, setSlashOpen] = useState(false);
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
      </div>
      {slashOpen && (
        <BlockCommandMenu onSelect={insertSnippet} />
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
