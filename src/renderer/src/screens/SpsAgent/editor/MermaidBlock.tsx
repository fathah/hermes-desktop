// MermaidBlock.tsx — a diagram block whose source is mermaid text.
//
// The source lives in `block.text`, so it round-trips as a clean ```mermaid
// fence in the vault markdown (Obsidian and GitHub render it natively). mermaid
// is heavy, so it is lazy-imported on first render and shared across blocks.
//
// Safety: we rely on mermaid's own `securityLevel: "strict"` (html-encodes
// labels, blocks click/script) rather than an inline-html sanitiser, which
// would destroy the SVG markup. The diagram is the user's own local content.
import { useEffect, useRef, useState } from "react";
import type { Block } from "../types";

type Mermaid = (typeof import("mermaid"))["default"];

let mermaidPromise: Promise<Mermaid> | null = null;

/** Load and initialise mermaid once, shared by every MermaidBlock. */
function loadMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "default",
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

// Each render needs a DOM id that never collides with a prior one.
let renderSeq = 0;

interface Props {
  block: Block;
  setType: (id: string, patch: Partial<Block>) => void;
}

export function MermaidBlock({ block, setType }: Props) {
  const source = block.text || "";
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(source.trim() === "");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const code = source.trim();
    if (!code) {
      setSvg("");
      setError(null);
      return;
    }
    let cancelled = false;
    const renderId = `mmd-${renderSeq++}`;
    loadMermaid()
      .then((mermaid) => mermaid.render(renderId, code))
      .then((result) => {
        if (cancelled) return;
        setSvg(result.svg);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  if (editing) {
    return (
      <div className="b-mermaid editing">
        <textarea
          ref={textareaRef}
          className="b-mermaid-src"
          value={source}
          spellCheck={false}
          placeholder={"graph TD;\n  A[Start] --> B[End]"}
          onChange={(e) => setType(block.id, { text: e.target.value })}
          onBlur={() => {
            if (source.trim()) setEditing(false);
          }}
        />
        {error && <div className="b-mermaid-error">⚠ {error}</div>}
      </div>
    );
  }

  return (
    <div
      className="b-mermaid"
      onClick={() => setEditing(true)}
      title="Click to edit diagram"
    >
      {error ? (
        <div className="b-mermaid-error">⚠ {error}</div>
      ) : (
        // mermaid output is trusted (securityLevel: strict); see file header.
        <div
          className="b-mermaid-preview"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </div>
  );
}
