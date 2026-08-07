import { useEffect, useMemo, useRef } from "react";
import { indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { basicSetup, EditorView } from "codemirror";

interface CodeEditorProps {
  value: string;
  fileName: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}

function extensionOf(fileName: string): string {
  const baseName = fileName.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (baseName === "dockerfile") return "dockerfile";
  const dot = baseName.lastIndexOf(".");
  return dot >= 0 ? baseName.slice(dot + 1) : "";
}

export type EditorLanguage =
  | "javascript"
  | "jsx"
  | "typescript"
  | "tsx"
  | "json"
  | "css"
  | "html"
  | "markdown"
  | "python"
  | "plain";

export function languageIdForFile(fileName: string): EditorLanguage {
  switch (extensionOf(fileName)) {
    case "js":
    case "mjs":
    case "cjs":
      return "javascript";
    case "jsx":
      return "jsx";
    case "ts":
    case "mts":
    case "cts":
      return "typescript";
    case "tsx":
      return "tsx";
    case "json":
    case "jsonc":
      return "json";
    case "css":
    case "scss":
    case "less":
      return "css";
    case "html":
    case "htm":
    case "vue":
    case "svelte":
      return "html";
    case "md":
    case "mdx":
    case "markdown":
      return "markdown";
    case "py":
    case "pyw":
      return "python";
    default:
      return "plain";
  }
}

export function languageForFile(fileName: string): Extension {
  switch (languageIdForFile(fileName)) {
    case "javascript":
      return javascript();
    case "jsx":
      return javascript({ jsx: true });
    case "typescript":
      return javascript({ typescript: true });
    case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "json":
      return json();
    case "css":
      return css();
    case "html":
      return html();
    case "markdown":
      return markdown();
    case "python":
      return python();
    case "plain":
      return [];
  }
}

const hermesEditorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "var(--bg-primary)",
      color: "var(--text-primary)",
      fontSize: "13px",
    },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily: "var(--font-mono)",
      lineHeight: "1.58",
    },
    ".cm-content": {
      minHeight: "100%",
      padding: "10px 0 40px",
      caretColor: "var(--text-primary)",
    },
    ".cm-line": {
      padding: "0 18px",
    },
    ".cm-gutters": {
      minWidth: "48px",
      border: "0",
      borderRight:
        "1px solid color-mix(in srgb, var(--text-primary) 6%, transparent)",
      backgroundColor: "var(--bg-primary)",
      color: "var(--text-muted)",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      minWidth: "46px",
      padding: "0 12px 0 6px",
    },
    ".cm-activeLine, .cm-activeLineGutter": {
      backgroundColor:
        "color-mix(in srgb, var(--text-primary) 4%, transparent)",
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection":
      {
        backgroundColor: "color-mix(in srgb, var(--accent) 34%, transparent)",
      },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--text-primary)",
    },
    ".cm-foldGutter": {
      width: "14px",
    },
    ".cm-panels": {
      borderColor: "var(--border)",
      backgroundColor: "var(--bg-secondary)",
      color: "var(--text-primary)",
    },
    ".cm-tooltip": {
      borderColor: "var(--border-bright)",
      borderRadius: "8px",
      backgroundColor: "var(--bg-elevated)",
      color: "var(--text-primary)",
      overflow: "hidden",
    },
  },
  { dark: true },
);

// @lat: [[code-editor#Project code workspace#Editing engine]]
export function CodeEditor({
  value,
  fileName,
  readOnly = false,
  onChange,
  onSave,
}: CodeEditorProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const initialConfigRef = useRef({ value, fileName, readOnly });
  const languageCompartment = useMemo(() => new Compartment(), []);
  const readOnlyCompartment = useMemo(() => new Compartment(), []);

  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!hostRef.current) return;
    const initialConfig = initialConfigRef.current;

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialConfig.value,
        extensions: [
          basicSetup,
          oneDark,
          hermesEditorTheme,
          languageCompartment.of(languageForFile(initialConfig.fileName)),
          readOnlyCompartment.of([
            EditorState.readOnly.of(initialConfig.readOnly),
            EditorView.editable.of(!initialConfig.readOnly),
          ]),
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                onSaveRef.current();
                return true;
              },
            },
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [languageCompartment, readOnlyCompartment]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: languageCompartment.reconfigure(languageForFile(fileName)),
    });
  }, [fileName, languageCompartment]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly, readOnlyCompartment]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

  return <div className="code-editor-host" ref={hostRef} />;
}
