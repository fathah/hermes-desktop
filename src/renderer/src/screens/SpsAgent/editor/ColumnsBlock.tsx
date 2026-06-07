// ColumnsBlock.tsx — a side-by-side layout block (2–3 columns of rich text).
//
// Columns are stored in `block.columns` (one HTML string per column). This is a
// "special" block like image/bookmark/button: it is NOT in the markdown
// serializer's cleanTypes, so it round-trips losslessly through the generic
// Tier-2 `<!-- sps:… -->` meta comment with ZERO serializer changes.
//
// Each column is an independent contentEditable region. We mirror Editable's
// cursor-safe pattern: initialise the DOM from `columns[i]` once (on mount /
// when the column count changes via the React key), store raw html on input,
// and sanitise on display. Typing never resets innerHTML, so the caret holds.
import { useEffect, useRef } from "react";
import { Icon } from "../components/Icon";
import { sanitizeHtml } from "../lib/sanitize";
import { stripHtml } from "../lib/html";
import type { Block } from "../types";

const MIN_COLS = 1;
const MAX_COLS = 3;

interface Props {
  block: Block;
  setType: (id: string, patch: Partial<Block>) => void;
}

function currentColumns(block: Block): string[] {
  return block.columns && block.columns.length ? block.columns : ["", ""];
}

export function ColumnsBlock({ block, setType }: Props) {
  const cols = currentColumns(block);

  const setCol = (i: number, html: string): void => {
    const next = cols.slice();
    next[i] = html;
    setType(block.id, { columns: next });
  };

  const addColumn = (): void => {
    if (cols.length >= MAX_COLS) return;
    setType(block.id, { columns: [...cols, ""] });
  };

  const removeColumn = (i: number): void => {
    if (cols.length <= MIN_COLS) return;
    setType(block.id, { columns: cols.filter((_, j) => j !== i) });
  };

  return (
    <div
      className="b-columns"
      style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}
    >
      {cols.map((html, i) => (
        <Column
          // count is in the key so add/remove remounts and re-seeds every column
          // from its committed html; a same-key column never re-seeds on keypress.
          key={`${block.id}:${i}:${cols.length}`}
          html={html}
          onInput={(h) => setCol(i, h)}
          onRemove={cols.length > MIN_COLS ? () => removeColumn(i) : undefined}
        />
      ))}
      {cols.length < MAX_COLS && (
        <button
          className="b-col-add"
          title="Add column"
          onMouseDown={(e) => {
            e.preventDefault();
            addColumn();
          }}
        >
          <Icon name="plus" size={15} />
        </button>
      )}
    </div>
  );
}

function Column({
  html,
  onInput,
  onRemove,
}: {
  html: string;
  onInput: (html: string) => void;
  onRemove?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Seed the DOM once. Sanitise on the way in so a hostile vault file can't
  // resurrect a script/img-onerror payload stored in a column.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const want = sanitizeHtml(html || "");
    if (el.innerHTML !== want) el.innerHTML = want;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const empty = !stripHtml(html || "").trim();

  return (
    <div className="b-col">
      {onRemove && (
        <button
          className="b-col-del"
          title="Remove column"
          onMouseDown={(e) => {
            e.preventDefault();
            onRemove();
          }}
        >
          <Icon name="x" size={12} />
        </button>
      )}
      <div
        ref={ref}
        className={`block b-col-body ${empty ? "empty" : ""}`}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        data-ph="Empty column — type here"
        onInput={(e) => onInput(e.currentTarget.innerHTML)}
        onPaste={(e) => {
          // Plain-text paste only — never inject foreign markup into a column.
          e.preventDefault();
          const data = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, data);
          onInput(e.currentTarget.innerHTML);
        }}
      />
    </div>
  );
}
