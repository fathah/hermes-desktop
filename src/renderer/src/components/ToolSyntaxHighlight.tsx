import { memo, useEffect, useState } from "react";

let highlighterModule: typeof import("react-syntax-highlighter") | null = null;
let oneDarkStyle: Record<string, React.CSSProperties> | null = null;
let highlighterPromise: Promise<void> | null = null;

function loadHighlighter(): Promise<void> {
  if (highlighterModule && oneDarkStyle) return Promise.resolve();
  if (highlighterPromise) return highlighterPromise;

  highlighterPromise = Promise.all([
    import("react-syntax-highlighter"),
    import("react-syntax-highlighter/dist/esm/styles/prism/one-dark"),
  ]).then(([module, style]) => {
    highlighterModule = module;
    oneDarkStyle = style.default;
  });

  return highlighterPromise;
}

/** Detect common source formats without coloring ordinary terminal logs. */
export function detectToolCodeLanguage(source: string): string | null {
  const code = source.trim();
  if (!code) return null;

  if (code.startsWith("{") || code.startsWith("[")) {
    try {
      JSON.parse(code);
      return "json";
    } catch {
      // A JavaScript object or array can still be detected below.
    }
  }

  if (/^#!.*\b(?:python|python3)\b/m.test(code)) return "python";
  if (
    /^(?:from\s+[\w.]+\s+import\s+|import\s+[\w.]+(?:\s+as\s+\w+)?\s*$|(?:async\s+)?def\s+\w+\s*\(|class\s+\w+(?:\([^)]*\))?\s*:)/m.test(
      code,
    )
  ) {
    return "python";
  }

  if (
    /\b(?:interface|type|enum|namespace)\s+\w+|\b(?:as|satisfies)\s+const\b/.test(
      code,
    )
  ) {
    return "typescript";
  }
  if (
    /^(?:import\s+.+\s+from\s+|export\s+(?:default\s+)?|(?:const|let|var)\s+\w+\s*=|(?:async\s+)?function\s+\w+\s*\()/m.test(
      code,
    ) ||
    /=>|\bconsole\.(?:log|warn|error)\s*\(/.test(code)
  ) {
    return "javascript";
  }

  if (/^<!doctype\s+html|^<[a-z][\s\S]*<\/[a-z][^>]*>$/i.test(code)) {
    return "markup";
  }
  if (
    /^(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|WITH)\b[\s\S]+\b(?:FROM|INTO|TABLE|SET|AS)\b/i.test(
      code,
    )
  ) {
    return "sql";
  }
  if (/^#!.*\b(?:sh|bash|zsh)\b/m.test(code)) return "bash";

  return null;
}

export const ToolSyntaxHighlight = memo(function ToolSyntaxHighlight({
  source,
  scroll = false,
}: {
  source: string;
  scroll?: boolean;
}): React.JSX.Element {
  const language = detectToolCodeLanguage(source);
  const [ready, setReady] = useState(
    () => highlighterModule !== null && oneDarkStyle !== null,
  );

  useEffect(() => {
    if (language && !ready) {
      void loadHighlighter().then(() => setReady(true));
    }
  }, [language, ready]);

  const className = `chat-history-pre ${
    scroll ? "chat-history-pre--scroll" : "chat-history-pre--code"
  }`;

  if (!language || !ready || !highlighterModule || !oneDarkStyle) {
    return <pre className={className}>{source}</pre>;
  }

  return (
    <highlighterModule.Prism
      className={className}
      language={language}
      style={oneDarkStyle}
      PreTag="pre"
      customStyle={{
        margin: 0,
        padding: 0,
        background: "transparent",
        fontSize: "12px",
        lineHeight: 1.5,
        maxHeight: scroll ? "600px" : undefined,
        overflowX: "auto",
        overflowY: scroll ? "auto" : undefined,
      }}
      codeTagProps={{
        style: {
          fontFamily:
            "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
        },
      }}
    >
      {source}
    </highlighterModule.Prism>
  );
});
