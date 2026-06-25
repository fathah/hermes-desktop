import { useMemo } from "react";
import { computeLineDiff } from "../../lib/diff";

/**
 * Inline unified diff for a file-edit tool call (idea A1 / Phase 0d). Renders
 * the line diff between `oldText` and `newText` with add/remove/context rows.
 * Degenerate states (no change, binary, truncated) get a compact note instead
 * of a misleading empty diff. Styling lives in main.css under `.chat-tool-diff`.
 */
export function ToolDiff({
  oldText,
  newText,
  fileName,
  maxLines,
}: {
  oldText: string;
  newText: string;
  fileName?: string;
  maxLines?: number;
}): React.JSX.Element {
  const diff = useMemo(
    () => computeLineDiff(oldText, newText, { maxLines }),
    [oldText, newText, maxLines],
  );

  if (diff.binary) {
    return (
      <div className="chat-tool-diff chat-tool-diff--note">
        Binary content — diff not shown
      </div>
    );
  }

  if (diff.unchanged) {
    return (
      <div className="chat-tool-diff chat-tool-diff--note">
        No changes{fileName ? ` to ${fileName}` : ""}
      </div>
    );
  }

  return (
    <div className="chat-tool-diff">
      <div className="chat-tool-diff-head">
        {fileName ? (
          <span className="chat-tool-diff-file">{fileName}</span>
        ) : null}
        <span className="chat-tool-diff-stat chat-tool-diff-stat--add">
          +{diff.added}
        </span>
        <span className="chat-tool-diff-stat chat-tool-diff-stat--remove">
          −{diff.removed}
        </span>
      </div>
      <pre className="chat-tool-diff-body">
        {diff.lines.map((line, i) => {
          const sign =
            line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
          return (
            <div
              key={i}
              className={`chat-tool-diff-line chat-tool-diff-line--${line.type}`}
            >
              <span className="chat-tool-diff-gutter">{sign}</span>
              <span className="chat-tool-diff-text">{line.text || " "}</span>
            </div>
          );
        })}
      </pre>
      {diff.truncated ? (
        <div className="chat-tool-diff-truncated">Diff truncated</div>
      ) : null}
    </div>
  );
}
