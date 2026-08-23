// @lat: [[chat-commands#Slash command execution#Completion text reconciliation]]

/**
 * A CJK "word" is usually 1-2 characters, so a fixed 3-character run is
 * much weaker evidence of genuine continuity there than in English (where
 * it is often most of a word): the small effective alphabet per position
 * lets an unrelated run recur by coincidence. `DENSE_SCRIPT_MIN_RUN` asks
 * for a longer, exponentially rarer run once dense-script text is involved.
 */
const DENSE_SCRIPT_RANGES: Array<[number, number]> = [
  [0x3040, 0x30ff], // Hiragana + Katakana
  [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xac00, 0xd7a3], // Hangul syllables
];
const DENSE_SCRIPT_MIN_RUN = 6;

function isDenseScriptChar(codePoint: number): boolean {
  return DENSE_SCRIPT_RANGES.some(
    ([start, end]) => codePoint >= start && codePoint <= end,
  );
}

function isDenseScriptHeavy(s: string): boolean {
  const chars = [...s];
  if (chars.length === 0) return false;
  const denseCount = chars.filter((c) =>
    isDenseScriptChar(c.codePointAt(0)!),
  ).length;
  return denseCount / chars.length > 0.3;
}

/**
 * Detect whether `partial` looks like a chunk-dropped copy of `full`.
 *
 * A stream assembled with dropped delta chunks is a concatenation of
 * **contiguous substrings** of the canonical text, in order — e.g.
 * "! What are we working on?" for "Hey! What are we working on today?", or
 * "Sat planet from the Sun" for "Saturn is the sixth planet from the Sun".
 *
 * A plain character-subsequence test is too loose: unrelated English
 * sentences often embed as scattered 1–2 character fragments, which would
 * make a genuine pre-tool-call segment (or a distinct short reasoning
 * segment) look like a damaged copy and get erased. So the match is greedy
 * over runs: every matched segment must be at least `minRun` characters
 * (the last segment may be shorter — a trailing "?" survives chunking), with
 * arbitrary gaps between runs. On top of the shape test, callers get
 * coverage guards: the partial must be non-trivial (≥ `minLength`) and cover
 * a substantial share of the full text (≥ `minCoverage`), so a tiny
 * fragment can never cancel a long canonical text.
 *
 * Inputs are expected to be whitespace-normalized by the caller.
 */
export function isLossyChunkCopy(
  partial: string,
  full: string,
  {
    minRun,
    minLength = 12,
    minCoverage = 0.3,
  }: { minRun?: number; minLength?: number; minCoverage?: number } = {},
): boolean {
  if (!partial || !full) return false;
  if (partial.length < minLength) return false;
  if (partial.length >= full.length) return false;
  if (partial.length < minCoverage * full.length) return false;

  const run =
    minRun ??
    (isDenseScriptHeavy(partial) || isDenseScriptHeavy(full)
      ? DENSE_SCRIPT_MIN_RUN
      : 3);

  let i = 0; // position in partial
  let j = 0; // position in full
  while (i < partial.length) {
    const remaining = partial.length - i;
    const probeLen = Math.min(run, remaining);
    const probe = partial.slice(i, i + probeLen);
    const at = full.indexOf(probe, j);
    if (at < 0) return false;
    // A short trailing probe (the final run) may be under `run`; any other
    // run must anchor with at least `run` matching characters.
    if (probeLen < run && remaining > probeLen) return false;
    // Extend the run as far as the two texts agree.
    let len = probeLen;
    while (
      i + len < partial.length &&
      at + len < full.length &&
      partial[i + len] === full[at + len]
    ) {
      len++;
    }
    i += len;
    j = at + len;
  }
  return true;
}
