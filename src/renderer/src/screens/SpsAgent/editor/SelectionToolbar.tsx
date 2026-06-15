// SelectionToolbar.tsx — floating text-selection toolbar (bold/italic/underline/
// strike/code/link/color/highlight/comment/Ask-AI). Ported from richtext.jsx.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { escapeHtml } from "../lib/html";
import { safeLinkHref } from "../lib/sanitize";
import { uid } from "../lib/ids";
import type { AiActionKind } from "../assistant/prompts";

/** Inline co-author actions offered in the toolbar's AI menu (Milestone 1D). */
const AI_ACTIONS: { kind: AiActionKind; label: string }[] = [
  { kind: "tldr", label: "TLDR" },
  { kind: "eli5", label: "Explain like I'm 5" },
  { kind: "rewrite", label: "Rewrite clearer" },
  { kind: "summarize", label: "Summarize" },
  { kind: "why", label: "Why this approach" },
  { kind: "cleanup", label: "AI Note Cleanup" },
];

const TEXT_COLORS: [string, string][] = [
  ["default", "inherit"],
  ["gray", "#6B7079"],
  ["brown", "#8a6a4a"],
  ["red", "#A1202C"],
  ["orange", "#9a6212"],
  ["green", "#1F6B3A"],
  ["blue", "#1B4F8A"],
  ["purple", "#5A3A8A"],
];
const HILITES: [string, string][] = [
  ["yellow", "rgba(242,183,5,0.32)"],
  ["green", "rgba(31,107,58,0.22)"],
  ["blue", "rgba(27,79,138,0.20)"],
  ["red", "rgba(161,32,44,0.18)"],
  ["purple", "rgba(90,58,138,0.20)"],
];

function inEditableBlock(node: Node | null): HTMLElement | null {
  let el: HTMLElement | null =
    node && node.nodeType === 3
      ? node.parentElement
      : (node as HTMLElement | null);
  while (el) {
    if (
      el.classList &&
      (el.classList.contains("block") || el.classList.contains("cap"))
    )
      return el;
    if (el.classList && el.classList.contains("doc-title")) return el;
    el = el.parentElement;
  }
  return null;
}

interface Props {
  onComment: (cid: string, text: string) => void;
  onAsk: (text: string) => void;
  onAiAction: (kind: AiActionKind, text: string) => void;
}

export function SelectionToolbar({ onComment, onAsk, onAiAction }: Props) {
  const [box, setBox] = useState<{ x: number; y: number } | null>(null);
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [pop, setPop] = useState<"color" | "link" | "ai" | null>(null);
  const [linkVal, setLinkVal] = useState("");
  const savedRange = useRef<Range | null>(null);

  const toolbarRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (box) {
      const topVal = Math.max(box.y - 46, 8);
      if (toolbarRef.current) {
        toolbarRef.current.style.left = `${box.x}px`;
        toolbarRef.current.style.top = `${topVal}px`;
      }
      if (popRef.current) {
        if (pop === "ai") {
          popRef.current.style.left = `${box.x - 80}px`;
          popRef.current.style.top = `${topVal + 38}px`;
        } else if (pop === "color") {
          popRef.current.style.left = `${box.x - 90}px`;
          popRef.current.style.top = `${topVal + 38}px`;
        } else if (pop === "link") {
          popRef.current.style.left = `${box.x - 120}px`;
          popRef.current.style.top = `${topVal + 38}px`;
        }
      }
    }
  }, [box, pop]);

  useEffect(() => {
    const update = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setBox(null);
        setPop(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const blkEl = inEditableBlock(sel.anchorNode);
      if (!blkEl || !blkEl.isContentEditable || !sel.toString().trim()) {
        setBox(null);
        setPop(null);
        return;
      }
      const r = range.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) {
        setBox(null);
        return;
      }
      savedRange.current = range.cloneRange();
      setBox({ x: r.left + r.width / 2, y: r.top });
      setMarks({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        strike: document.queryCommandState("strikeThrough"),
      });
    };
    const onScroll = () => setBox(null);
    document.addEventListener("selectionchange", update);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, []);

  const restore = () => {
    if (!savedRange.current) return;
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(savedRange.current);
  };
  const exec = (cmd: string) => {
    restore();
    document.execCommand(cmd, false);
    const key = cmd === "strikeThrough" ? "strike" : cmd;
    setMarks((m) => ({ ...m, [key]: !m[key] }));
  };
  const wrapCode = () => {
    restore();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const txt = sel.toString();
    document.execCommand(
      "insertHTML",
      false,
      `<code>${escapeHtml(txt)}</code>`,
    );
  };
  const applyColor = (hex: string) => {
    restore();
    document.execCommand("foreColor", false, hex);
    setPop(null);
    setBox(null);
  };
  const applyHilite = (rgba: string) => {
    restore();
    document.execCommand("hiliteColor", false, rgba);
    setPop(null);
    setBox(null);
  };
  const applyLink = () => {
    if (!linkVal) return;
    // Only http(s)/mailto — reject javascript:/data:/file: etc. so a malicious
    // href can never enter (and persist in) the document HTML.
    const href = safeLinkHref(linkVal);
    if (!href) {
      setPop(null);
      setLinkVal("");
      return;
    }
    restore();
    document.execCommand("createLink", false, href);
    setPop(null);
    setBox(null);
    setLinkVal("");
  };
  const doComment = () => {
    restore();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const txt = sel.toString();
    const cid = uid("cmt");
    document.execCommand(
      "insertHTML",
      false,
      `<span class="cmt-anchor" data-cmt="${cid}">${escapeHtml(txt)}</span>`,
    );
    onComment(cid, txt);
    setBox(null);
  };
  const doAsk = () => {
    const txt = savedRange.current ? savedRange.current.toString() : "";
    setBox(null);
    window.getSelection()?.removeAllRanges();
    if (onAsk && txt) onAsk(txt);
  };
  const doAi = (kind: AiActionKind) => {
    const txt = savedRange.current ? savedRange.current.toString() : "";
    setPop(null);
    setBox(null);
    window.getSelection()?.removeAllRanges();
    if (txt) onAiAction(kind, txt);
  };

  if (!box) return null;
  return (
    <>
      <div
        ref={toolbarRef}
        className="sel-toolbar"
        onMouseDown={(e) => e.preventDefault()}
      >
        <button
          className={`st-btn ${marks.bold ? "on" : ""}`}
          onClick={() => exec("bold")}
        >
          <b>B</b>
        </button>
        <button
          className={`st-btn ${marks.italic ? "on" : ""}`}
          onClick={() => exec("italic")}
        >
          <i>i</i>
        </button>
        <button
          className={`st-btn ${marks.underline ? "on" : ""}`}
          onClick={() => exec("underline")}
        >
          <u>U</u>
        </button>
        <button
          className={`st-btn ${marks.strike ? "on" : ""}`}
          onClick={() => exec("strikeThrough")}
        >
          <s>S</s>
        </button>
        <button
          className="st-btn st-btn-mono"
          onClick={wrapCode}
          title="Inline code"
        >
          {"<>"}
        </button>
        <span className="st-sep"></span>
        <button
          className="st-btn"
          onClick={() => setPop(pop === "link" ? null : "link")}
          title="Link"
        >
          <Icon name="share" size={15} />
        </button>
        <button
          className="st-btn"
          onClick={() => setPop(pop === "color" ? null : "color")}
          title="Color"
        >
          <span className="st-btn-bold-a">A</span>
          <Icon name="chevD" size={11} />
        </button>
        <span className="st-sep"></span>
        <button className="st-btn" onClick={doAsk} title="Ask My Assistant">
          <Icon name="sparkle" size={15} /> Ask
        </button>
        <button
          className="st-btn"
          onClick={() => setPop(pop === "ai" ? null : "ai")}
          title="AI actions"
        >
          <Icon name="chevD" size={11} />
        </button>
        <button className="st-btn" onClick={doComment} title="Add note">
          <Icon name="comment" size={15} />
        </button>
      </div>

      {pop === "ai" && (
        <div
          ref={popRef}
          className="st-pop"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="menu-label">AI</div>
          {AI_ACTIONS.map((a) => (
            <div
              key={a.kind}
              className="menu-item"
              onMouseDown={(e) => {
                e.preventDefault();
                doAi(a.kind);
              }}
            >
              <div className="menu-tx">
                <b>{a.label}</b>
              </div>
            </div>
          ))}
        </div>
      )}
      {pop === "color" && (
        <div
          ref={popRef}
          className="st-pop"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="menu-label">Text</div>
          <div className="sw-row">
            {TEXT_COLORS.map(([name, hex]) => (
              <div
                key={name}
                className="sw"
                title={name}
                data-color={name}
                onClick={() => applyColor(hex === "inherit" ? "#1B1D21" : hex)}
              >
                A
              </div>
            ))}
          </div>
          <div className="menu-label">Highlight</div>
          <div className="sw-row">
            {HILITES.map(([name, rgba]) => (
              <div
                key={name}
                className="sw"
                title={name}
                data-bg={name}
                onClick={() => applyHilite(rgba)}
              ></div>
            ))}
          </div>
        </div>
      )}
      {pop === "link" && (
        <div
          ref={popRef}
          className="st-pop"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="st-link-pop">
            <input
              autoFocus
              placeholder="Paste a link…"
              value={linkVal}
              onChange={(e) => setLinkVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyLink();
                if (e.key === "Escape") setPop(null);
              }}
            />
            <button
              className="pa-btn pa-accept"
              onMouseDown={(e) => {
                e.preventDefault();
                applyLink();
              }}
            >
              Link
            </button>
          </div>
        </div>
      )}
    </>
  );
}
