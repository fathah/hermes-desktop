import { useEffect, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
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
        <div className="workspace-slash-menu" role="menu">
          <button type="button" onClick={() => insertSnippet("# New page\n")}>
            Page
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
          <button type="button" onClick={() => insertSnippet("```\n\n```\n")}>
            Code
          </button>
          <button type="button" onClick={() => insertSnippet("[[Page]]")}>
            Page link
          </button>
          <button
            type="button"
            onClick={() =>
              insertSnippet(
                "\n```yaml\nhermesType: database\nversion: 1\ntitle: Tasks\nproperties:\n  name: { type: title }\nviews:\n  - id: view-1\n    name: Table\n    type: table\nitems: []\nrowPages: {}\n```\n",
              )
            }
          >
            Database
          </button>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
