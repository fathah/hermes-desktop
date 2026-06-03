/**
 * Minimal line-level diff (idea A1 / Phase 0d).
 *
 * Produces a unified-style line diff for rendering inline file-edit previews in
 * the chat tool feed. Pure and dependency-free (no `diff` npm dep) so it can be
 * unit tested and run in the renderer. Uses an LCS DP for small inputs and a
 * cheap replace-all fallback for very large ones (a tool diff doesn't need to
 * be optimal for a 50k-line file — it needs to be bounded and never hang).
 */

export type DiffLineType = "context" | "add" | "remove";

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface DiffResult {
  lines: DiffLine[];
  added: number;
  removed: number;
  /** old === new — nothing to show. */
  unchanged: boolean;
  /** Either side looked binary (contained a NUL) — diffing was skipped. */
  binary: boolean;
  /** Output was capped at maxLines. */
  truncated: boolean;
}

export interface DiffOptions {
  /** Max emitted diff lines before truncation (default 400). */
  maxLines?: number;
  /** Above this many lines on either side, skip LCS and replace-all (default 1500). */
  lcsLineCap?: number;
}

const DEFAULT_MAX_LINES = 400;
const DEFAULT_LCS_CAP = 1500;

/** A NUL byte is the classic binary-content signal; real source never has one. */
function looksBinary(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 0) return true;
  }
  return false;
}

/** Split into lines without a trailing empty element for a final newline. */
function splitLines(s: string): string[] {
  if (s === "") return [];
  const lines = s.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Replace-all fallback: every old line removed, every new line added. */
function replaceAll(oldLines: string[], newLines: string[]): DiffLine[] {
  const out: DiffLine[] = [];
  for (const l of oldLines) out.push({ type: "remove", text: l });
  for (const l of newLines) out.push({ type: "add", text: l });
  return out;
}

/** LCS-based line diff producing remove/add/context in original order. */
function lcsDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const n = oldLines.length;
  const m = newLines.length;
  // dp[i][j] = LCS length of oldLines[i:] and newLines[j:]
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        oldLines[i] === newLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      out.push({ type: "context", text: oldLines[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "remove", text: oldLines[i] });
      i++;
    } else {
      out.push({ type: "add", text: newLines[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: "remove", text: oldLines[i++] });
  while (j < m) out.push({ type: "add", text: newLines[j++] });
  return out;
}

export function computeLineDiff(
  oldText: string,
  newText: string,
  opts?: DiffOptions,
): DiffResult {
  const maxLines = opts?.maxLines ?? DEFAULT_MAX_LINES;
  const lcsCap = opts?.lcsLineCap ?? DEFAULT_LCS_CAP;

  if (oldText === newText) {
    return {
      lines: [],
      added: 0,
      removed: 0,
      unchanged: true,
      binary: false,
      truncated: false,
    };
  }

  if (looksBinary(oldText) || looksBinary(newText)) {
    return {
      lines: [],
      added: 0,
      removed: 0,
      unchanged: false,
      binary: true,
      truncated: false,
    };
  }

  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  const tooBig = oldLines.length > lcsCap || newLines.length > lcsCap;
  let lines = tooBig
    ? replaceAll(oldLines, newLines)
    : lcsDiff(oldLines, newLines);

  let truncated = tooBig;
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    truncated = true;
  }

  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.type === "add") added++;
    else if (l.type === "remove") removed++;
  }

  return { lines, added, removed, unchanged: false, binary: false, truncated };
}
